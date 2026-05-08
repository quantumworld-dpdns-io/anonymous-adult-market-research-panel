# 06 — Python Analytics Service (Federated Learning)

## Purpose

Define the implementation of the Python Analytics Service, which acts as the Flower federation server (`SuperLink` + `ServerApp`) for privacy-preserving survey analytics. Raw participant responses never leave the encrypted storage layer; only differentially private model updates are shared.

---

## 1. Technology Stack

| Component | Library | Version |
|---|---|---|
| HTTP API | `fastapi` | 0.115 |
| ASGI server | `uvicorn` | 0.30 |
| Federated learning | `flwr` (Flower) | 1.x |
| Differential privacy | `diffprivlib` (IBM) | 0.6 |
| Data processing | `duckdb` + `pyarrow` | latest |
| Supabase client | `supabase-py` | 2.x |
| Telemetry | `opentelemetry-sdk` | 1.x |
| Validation | `pydantic` | 2.x |
| Scheduling | `apscheduler` | 3.x |

---

## 2. Service Structure

```
services/analytics/
├── main.py                      # FastAPI app factory
├── config.py                    # Settings via pydantic-settings
├── routers/
│   ├── results.py               # GET /analytics/{study_id}/results
│   ├── rounds.py                # POST /analytics/{study_id}/trigger-round
│   └── health.py
├── federation/
│   ├── server_app.py            # Flower ServerApp definition
│   ├── client_app.py            # Flower ClientApp (runs on analytics workers)
│   ├── strategy.py              # FedAvg + DP noise strategy
│   └── aggregator.py            # Custom aggregation with ε-budget tracking
├── privacy/
│   ├── differential_privacy.py  # Gaussian mechanism, sensitivity analysis
│   └── budget_tracker.py        # Per-study ε budget accounting
├── storage/
│   ├── supabase_client.py       # Encrypted response fetcher
│   └── duckdb_store.py          # Aggregated results cache
└── tasks/
    └── scheduled_rounds.py      # APScheduler: auto-trigger rounds when n >= threshold
```

---

## 3. FastAPI Application

```python
# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from config import Settings
from routers import results, rounds, health

settings = Settings()

def create_app() -> FastAPI:
    app = FastAPI(
        title="Anonymous Panel Analytics Service",
        docs_url=None,  # Disable Swagger in production
        redoc_url=None,
    )

    app.include_router(health.router)
    app.include_router(results.router, prefix="/analytics")
    app.include_router(rounds.router, prefix="/analytics")

    # Instrument with OpenTelemetry
    FastAPIInstrumentor.instrument_app(app)

    return app

app = create_app()
```

---

## 4. Flower Federation Design

### 4.1 Data Model

Each study has a set of questions, each with a distribution of responses. The federated task is to compute a weighted histogram over encrypted response shards without centralizing raw data.

```
Study responses in Supabase (encrypted):
  { study_id, nullifier_hash, encrypted_payload, submitted_at }

Each Flower client decrypts its shard (using study-specific key from secrets manager)
and computes:
  { question_id -> { option_a: count, option_b: count, ... } }

These local histograms are aggregated server-side using FedAvg + DP noise.
```

### 4.2 ServerApp

```python
# federation/server_app.py
from flwr.server import ServerApp, ServerConfig
from flwr.server.strategy import FedAvg
from flwr.common import ndarrays_to_parameters, parameters_to_ndarrays, Metrics
import numpy as np

from federation.strategy import DPFedAvgStrategy

def make_server_app(study_id: str, num_rounds: int = 1) -> ServerApp:
    strategy = DPFedAvgStrategy(
        study_id=study_id,
        epsilon=1.0,                    # Per-round DP budget
        delta=1e-5,
        min_fit_clients=3,              # Minimum shards per round
        min_evaluate_clients=3,
        min_available_clients=3,
        fraction_fit=1.0,
        fraction_evaluate=0.0,          # Skip separate eval round
    )

    return ServerApp(
        config=ServerConfig(num_rounds=num_rounds),
        strategy=strategy,
    )
```

### 4.3 DP-Augmented FedAvg Strategy

```python
# federation/strategy.py
from flwr.server.strategy import FedAvg
from flwr.common import (
    FitRes, Parameters, Scalar,
    ndarrays_to_parameters, parameters_to_ndarrays,
)
from flwr.server.client_proxy import ClientProxy
import numpy as np
from typing import List, Tuple, Union, Optional

from privacy.differential_privacy import add_gaussian_noise
from privacy.budget_tracker import BudgetTracker

class DPFedAvgStrategy(FedAvg):
    def __init__(
        self,
        study_id: str,
        epsilon: float,
        delta: float,
        sensitivity: float = 1.0,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.study_id = study_id
        self.epsilon = epsilon
        self.delta = delta
        self.sensitivity = sensitivity
        self.budget_tracker = BudgetTracker(study_id)

    def aggregate_fit(
        self,
        server_round: int,
        results: List[Tuple[ClientProxy, FitRes]],
        failures: List[Union[Tuple[ClientProxy, FitRes], BaseException]],
    ) -> Tuple[Optional[Parameters], dict[str, Scalar]]:
        # Check ε budget before aggregating
        if not self.budget_tracker.can_run_round(self.epsilon):
            raise RuntimeError(f"ε budget exhausted for study {self.study_id}")

        # Standard FedAvg aggregation
        aggregated_params, metrics = super().aggregate_fit(
            server_round, results, failures
        )

        if aggregated_params is not None:
            # Add Gaussian noise (Gaussian mechanism, ε-δ DP)
            arrays = parameters_to_ndarrays(aggregated_params)
            noisy_arrays = [
                add_gaussian_noise(arr, self.sensitivity, self.epsilon, self.delta)
                for arr in arrays
            ]
            aggregated_params = ndarrays_to_parameters(noisy_arrays)

            # Account for ε spent
            self.budget_tracker.record_round(self.epsilon)

        return aggregated_params, metrics
```

### 4.4 ClientApp

```python
# federation/client_app.py
from flwr.client import ClientApp, NumPyClient
from flwr.common import NDArrays, Scalar
import numpy as np
import duckdb

from storage.supabase_client import decrypt_and_fetch_shard

class AnalyticsClient(NumPyClient):
    def __init__(self, study_id: str, shard_key: bytes):
        self.study_id = study_id
        self.shard_key = shard_key

    def fit(
        self,
        parameters: NDArrays,
        config: dict[str, Scalar],
    ) -> tuple[NDArrays, int, dict]:
        # 1. Fetch and decrypt this shard's responses
        responses = decrypt_and_fetch_shard(
            self.study_id, self.shard_key
        )

        # 2. Compute local histogram (no raw responses leave this function)
        local_histogram = self._compute_histogram(responses)

        # 3. Return as numpy arrays (histogram counts, not raw responses)
        return [local_histogram], len(responses), {}

    def _compute_histogram(self, responses: list[dict]) -> np.ndarray:
        # DuckDB in-process query over local response list
        conn = duckdb.connect()
        conn.execute("CREATE TABLE resp AS SELECT * FROM ?", [responses])
        result = conn.execute("""
            SELECT question_id, option_id, COUNT(*) as count
            FROM resp
            GROUP BY question_id, option_id
            ORDER BY question_id, option_id
        """).fetchall()
        conn.close()
        return np.array([row[2] for row in result], dtype=np.float32)

def make_client_app(study_id: str, shard_key: bytes) -> ClientApp:
    def client_fn(context):
        return AnalyticsClient(study_id, shard_key)
    return ClientApp(client_fn=client_fn)
```

---

## 5. Differential Privacy

```python
# privacy/differential_privacy.py
import numpy as np
from scipy.stats import norm

def gaussian_noise_scale(sensitivity: float, epsilon: float, delta: float) -> float:
    """Compute Gaussian mechanism noise scale σ for (ε, δ)-DP."""
    # Calibrated Gaussian mechanism: σ = sensitivity * sqrt(2 * ln(1.25/δ)) / ε
    sigma = sensitivity * np.sqrt(2 * np.log(1.25 / delta)) / epsilon
    return sigma

def add_gaussian_noise(
    array: np.ndarray,
    sensitivity: float,
    epsilon: float,
    delta: float,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    if rng is None:
        rng = np.random.default_rng()
    sigma = gaussian_noise_scale(sensitivity, epsilon, delta)
    noise = rng.normal(0, sigma, size=array.shape)
    return array + noise


# privacy/budget_tracker.py
import json
from pathlib import Path

class BudgetTracker:
    """Per-study ε budget tracker. Persists to Supabase in production."""

    def __init__(self, study_id: str, total_budget: float = 10.0):
        self.study_id = study_id
        self.total_budget = total_budget
        self._spent = self._load_spent()

    def can_run_round(self, epsilon: float) -> bool:
        return self._spent + epsilon <= self.total_budget

    def record_round(self, epsilon: float) -> None:
        self._spent += epsilon
        self._persist()

    @property
    def remaining_budget(self) -> float:
        return self.total_budget - self._spent

    def _load_spent(self) -> float:
        # Load from Supabase `study_privacy_budgets` table
        return 0.0  # Stub

    def _persist(self) -> None:
        # Upsert to Supabase `study_privacy_budgets` table
        pass
```

---

## 6. Results API

```python
# routers/results.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from storage.duckdb_store import ResultsStore
from privacy.budget_tracker import BudgetTracker

router = APIRouter()

class StudyResultsResponse(BaseModel):
    study_id: str
    question_results: list[QuestionResult]
    epsilon_budget_used: float
    epsilon_budget_remaining: float
    min_cohort_size: int
    response_count: int
    last_round_at: str | None

@router.get("/{study_id}/results", response_model=StudyResultsResponse)
async def get_results(study_id: str):
    store = ResultsStore()
    tracker = BudgetTracker(study_id)

    results = store.get_aggregated_results(study_id)
    if results is None:
        raise HTTPException(
            status_code=404,
            detail="No results available yet. Federated round not complete."
        )

    # Enforce minimum cohort size before returning results
    if results.response_count < 50:
        raise HTTPException(
            status_code=403,
            detail=f"Minimum cohort of 50 required. Current: {results.response_count}"
        )

    return StudyResultsResponse(
        study_id=study_id,
        question_results=results.questions,
        epsilon_budget_used=tracker.total_budget - tracker.remaining_budget,
        epsilon_budget_remaining=tracker.remaining_budget,
        min_cohort_size=50,
        response_count=results.response_count,
        last_round_at=results.last_round_at,
    )
```

---

## 7. DuckDB Results Cache

```python
# storage/duckdb_store.py
import duckdb
import pyarrow as pa
import numpy as np

class ResultsStore:
    def __init__(self, db_path: str = "/data/analytics.duckdb"):
        self.conn = duckdb.connect(db_path)
        self._init_schema()

    def _init_schema(self):
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS aggregated_results (
                study_id       VARCHAR PRIMARY KEY,
                result_json    JSON,
                response_count INTEGER,
                last_round_at  TIMESTAMPTZ DEFAULT now()
            )
        """)

    def store_aggregated(
        self,
        study_id: str,
        question_histograms: dict,
        response_count: int,
    ) -> None:
        import json
        self.conn.execute("""
            INSERT OR REPLACE INTO aggregated_results
            (study_id, result_json, response_count, last_round_at)
            VALUES (?, ?, ?, now())
        """, [study_id, json.dumps(question_histograms), response_count])

    def export_arrow(self, study_id: str) -> pa.Table:
        return self.conn.execute(
            "SELECT * FROM aggregated_results WHERE study_id = ?",
            [study_id]
        ).arrow()
```

---

## 8. Scheduled Federated Rounds

```python
# tasks/scheduled_rounds.py
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from flwr.simulation import run_simulation

from federation.server_app import make_server_app
from federation.client_app import make_client_app
from storage.supabase_client import get_shard_keys_for_study

scheduler = AsyncIOScheduler()

@scheduler.scheduled_job("interval", minutes=30)
async def auto_trigger_rounds():
    """Check all active studies; trigger federated round if enough responses collected."""
    active_studies = await get_active_studies_above_threshold(min_responses=50)

    for study in active_studies:
        shard_keys = await get_shard_keys_for_study(study.id)
        if len(shard_keys) < 3:
            continue  # Need minimum 3 shards

        server_app = make_server_app(study.id, num_rounds=1)
        client_apps = [
            make_client_app(study.id, key) for key in shard_keys
        ]

        # Run simulation locally (replace with Flower SuperLink in production)
        run_simulation(
            server_app=server_app,
            client_app=client_apps[0],  # All clients use same app definition
            num_supernodes=len(shard_keys),
            backend_config={"client_resources": {"num_cpus": 1}},
        )
```

---

## 9. Supabase Encrypted Response Fetcher

```python
# storage/supabase_client.py
from supabase import create_client
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import base64
import json

async def decrypt_and_fetch_shard(
    study_id: str,
    decryption_key: bytes,  # Study-specific AES-256 key from secrets manager
) -> list[dict]:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    rows = supabase.from_("encrypted_responses") \
        .select("encrypted_payload, nonce") \
        .eq("study_id", study_id) \
        .execute()

    responses = []
    aesgcm = AESGCM(decryption_key)
    for row in rows.data:
        nonce = base64.b64decode(row["nonce"])
        ciphertext = base64.b64decode(row["encrypted_payload"])
        plaintext = aesgcm.decrypt(nonce, ciphertext, study_id.encode())
        responses.append(json.loads(plaintext))

    return responses
```

---

## 10. Testing Plan

| Test | Type | Coverage |
|---|---|---|
| Federated round (simulated) | Integration | Flower simulation with 5 virtual clients |
| DP noise calibration | Unit | σ correct for given ε, δ, sensitivity |
| Budget exhaustion | Unit | Round rejected when budget exceeded |
| Min cohort enforcement | Integration | 403 returned if < 50 responses |
| Encrypted response decryption | Unit | AES-GCM round-trip |
| DuckDB result store | Unit | Insert + Arrow export round-trip |
| Scheduled round trigger | Integration | APScheduler fires; simulation runs |
| Results API | Integration | Returns DP-noisy aggregates |

---

## 11. Security Checklist

- [ ] Study decryption keys stored in secrets manager (never in DB or config)
- [ ] Each study uses a unique AES-256-GCM key; key compromise affects only that study
- [ ] ε budget is enforced before every federated round; budget state is persistent
- [ ] Minimum cohort size (50) enforced at API layer before returning any results
- [ ] No raw responses are logged; only aggregate histograms stored in DuckDB
- [ ] Flower federation uses authenticated gRPC channels between server and workers
- [ ] DuckDB file encrypted at rest (filesystem encryption or DuckDB encryption extension)
- [ ] Swagger/OpenAPI docs disabled in production (`docs_url=None`)
- [ ] OTel spans never include response content or nullifier values
