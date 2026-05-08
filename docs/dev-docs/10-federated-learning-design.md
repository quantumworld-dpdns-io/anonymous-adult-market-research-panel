# 10 — Federated Learning Design

## Purpose

Define the complete federated learning architecture using **Flower (flwr)** for privacy-preserving survey analytics. This document covers federation topology, aggregation strategy, differential privacy accounting, privacy guarantees, and deployment configuration.

---

## 1. Why Federated Learning for Survey Analytics

Traditional market research platforms centralize raw responses. The panel platform instead uses federated learning to:

| Goal | FL Mechanism |
|---|---|
| Prevent raw response access | Responses are decrypted only inside Flower ClientApp workers; only histograms leave |
| Enable differentially private aggregation | Gaussian noise added to aggregated histograms before returning to researcher |
| Support geographic data sovereignty | ClientApp workers can run in regional data centers without raw data crossing borders |
| Prevent re-identification via analytics | ε-δ DP guarantees bound the information leakage across all rounds |
| Provide auditable privacy accounting | Every ε spent is recorded in Supabase; researchers can verify budget usage |

---

## 2. Federation Topology

```
                    ┌──────────────────────────────────┐
                    │   Flower SuperLink               │
                    │   (Analytics Service, port 9091)  │
                    │                                   │
                    │   ┌─────────────────────────┐    │
                    │   │ ServerApp               │    │
                    │   │ DPFedAvgStrategy        │    │
                    │   │ ε-budget tracker        │    │
                    │   └─────────────────────────┘    │
                    └──────────┬───────────────────────┘
                               │ gRPC (Flower protocol)
              ┌────────────────┼────────────────────────┐
              ▼                ▼                         ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ SuperNode / Shard│  │ SuperNode / Shard│  │ SuperNode / Shard│
│ Worker 1        │  │ Worker 2        │  │ Worker 3        │
│                 │  │                 │  │                 │
│ ClientApp       │  │ ClientApp       │  │ ClientApp       │
│  ↓              │  │  ↓              │  │  ↓              │
│ Decrypt shard   │  │ Decrypt shard   │  │ Decrypt shard   │
│ Compute         │  │ Compute         │  │ Compute         │
│ histogram       │  │ histogram       │  │ histogram       │
│  ↓              │  │  ↓              │  │  ↓              │
│ Return arrays   │  │ Return arrays   │  │ Return arrays   │
│ (no raw data)   │  │ (no raw data)   │  │ (no raw data)   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 2.1 Shard Architecture

Encrypted responses in Supabase are logically partitioned into shards. Each Flower SuperNode worker:

- Has access to one shard's decryption key (from secrets manager)
- Decrypts its shard in memory during the federated round
- Computes local aggregates (histograms)
- Returns aggregated arrays to the SuperLink — never raw responses

Shard assignment is randomized per-study at study creation time using the Quantum Sampling Service, ensuring no systematic bias in shard distribution.

---

## 3. Aggregation Strategy: DPFedAvg

### 3.1 Algorithm Overview

```
For each federated round:
  1. ServerApp selects all available SuperNodes (fraction_fit = 1.0)
  2. SuperLink sends FitIns to each SuperNode
  3. Each ClientApp:
     a. Loads parameters (initial zeros on round 1)
     b. Decrypts local shard
     c. Computes local histogram H_i ∈ ℝ^(Q×O)
        where Q = number of questions, O = max options per question
     d. Returns H_i as numpy arrays
  4. ServerApp aggregates via weighted average:
     H_global = Σ(n_i * H_i) / Σ(n_i)
     where n_i = number of responses in shard i
  5. Add Gaussian noise calibrated to (ε, δ)-DP:
     H_dp = H_global + N(0, σ²I)
     σ = Δf * sqrt(2 * ln(1.25/δ)) / ε
     Δf = 1/n_total  (sensitivity of normalized histogram)
  6. Record ε spent in Supabase
  7. Store H_dp in DuckDB results cache
```

### 3.2 Sensitivity Analysis

The sensitivity of the normalized histogram query is:

```
Δf = max change in H when one response is added/removed
   = 1/n_total  (normalized histogram sensitivity)

For n_total = 100 responses, Δf = 0.01
For n_total = 1000 responses, Δf = 0.001
```

This means **larger cohorts require less noise** for the same ε guarantee, which incentivizes researchers to run studies with more participants.

### 3.3 Privacy Composition

For a study with multiple federated rounds (e.g., intermediate results requested):

- **Sequential composition**: Total ε = Σε_i (worst-case, no advanced composition)
- **Advanced composition** (if enabled): Total ε ≈ sqrt(2k) * ε for k rounds (RDP accounting)
- **Rényi DP accounting** (optional): tighter bounds for studies running > 10 rounds

The platform implements basic sequential composition by default, with Rényi DP as an opt-in via study configuration.

---

## 4. Detailed Flower Configuration

### 4.1 Production SuperLink Deployment

```yaml
# infra/helm/analytics/values.yaml
flower:
  superlink:
    enabled: true
    replicas: 1
    image: flwr/superlink:1.x
    args:
      - "--fleet-api-address=0.0.0.0:9091"
      - "--driver-api-address=0.0.0.0:9090"
      - "--ssl-certfile=/certs/tls.crt"
      - "--ssl-keyfile=/certs/tls.key"
      - "--ssl-ca-certfile=/certs/ca.crt"
    resources:
      requests:
        cpu: "500m"
        memory: "512Mi"

  supernodes:
    replicas: 3   # Minimum 3 for minimum cohort requirement
    image: flwr/supernode:1.x
    args:
      - "--superlink=analytics-superlink:9091"
      - "--node-config=study_id={STUDY_ID}"
      - "--ssl-certfile=/certs/tls.crt"
      - "--ssl-keyfile=/certs/tls.key"
      - "--ssl-ca-certfile=/certs/ca.crt"
    resources:
      requests:
        cpu: "1000m"
        memory: "2Gi"
```

### 4.2 ServerApp Configuration

```python
# federation/server_app.py (detailed configuration)
from flwr.server import ServerApp, ServerConfig
from flwr.server.strategy import FedAvg
from flwr.common import Metrics
from typing import List, Tuple, Optional

class DPFedAvgStrategy(FedAvg):
    """
    FedAvg + Gaussian DP noise on aggregated parameters.
    Inherits client selection, fit, and evaluate logic from FedAvg.
    Only overrides aggregate_fit to add DP noise.
    """

    def __init__(
        self,
        study_id: str,
        epsilon: float = 1.0,
        delta: float = 1e-5,
        sensitivity: float = 1.0,
        min_fit_clients: int = 3,
        min_available_clients: int = 3,
        **kwargs,
    ):
        super().__init__(
            min_fit_clients=min_fit_clients,
            min_available_clients=min_available_clients,
            fraction_fit=1.0,    # Use all available clients
            fraction_evaluate=0.0,  # No separate eval round
            **kwargs,
        )
        self.study_id = study_id
        self.epsilon = epsilon
        self.delta = delta
        self.sensitivity = sensitivity
        self._budget_tracker = BudgetTracker(study_id)

    def aggregate_fit(self, server_round, results, failures):
        # Budget check
        if not self._budget_tracker.can_run_round(self.epsilon):
            raise BudgetExhaustedError(
                f"DP budget exhausted for study {self.study_id}. "
                f"Spent: {self._budget_tracker.total_budget - self._budget_tracker.remaining_budget}ε"
            )

        # Standard weighted FedAvg aggregation
        aggregated, metrics = super().aggregate_fit(server_round, results, failures)

        if aggregated is not None:
            from flwr.common import parameters_to_ndarrays, ndarrays_to_parameters
            import numpy as np
            from privacy.differential_privacy import add_gaussian_noise

            arrays = parameters_to_ndarrays(aggregated)
            noisy = [
                add_gaussian_noise(a, self.sensitivity, self.epsilon, self.delta)
                for a in arrays
            ]
            aggregated = ndarrays_to_parameters(noisy)

            # Record ε expenditure
            self._budget_tracker.record_round(self.epsilon)

            # Log to Supabase
            self._log_round(server_round, len(results))

        return aggregated, metrics

    def _log_round(self, round_num: int, num_clients: int) -> None:
        import asyncio
        from storage.supabase_client import log_federation_round
        asyncio.create_task(log_federation_round(
            self.study_id, round_num, num_clients,
            self.epsilon, self._budget_tracker.remaining_budget
        ))
```

### 4.3 ClientApp with Secure Shard Loading

```python
# federation/client_app.py (detailed)
from flwr.client import ClientApp, NumPyClient
from flwr.common import NDArrays, Scalar, Config
import numpy as np

class SurveyAnalyticsClient(NumPyClient):
    """
    Flower client that processes one encrypted response shard.
    Only histograms (not raw responses) leave this client.
    """

    def __init__(
        self,
        study_id: str,
        shard_key: bytes,
        question_schema: list[dict],
    ):
        self.study_id = study_id
        self.shard_key = shard_key
        self.question_schema = question_schema
        self._responses: list[dict] | None = None

    def _load_responses(self) -> list[dict]:
        """Lazily load and decrypt responses on first access."""
        if self._responses is None:
            from storage.supabase_client import decrypt_and_fetch_shard
            import asyncio
            self._responses = asyncio.run(
                decrypt_and_fetch_shard(self.study_id, self.shard_key)
            )
        return self._responses

    def fit(
        self,
        parameters: NDArrays,
        config: Config,
    ) -> tuple[NDArrays, int, dict[str, Scalar]]:
        responses = self._load_responses()
        n = len(responses)

        if n == 0:
            # Return zero histogram if shard is empty
            histogram = np.zeros(self._histogram_size())
            return [histogram], 0, {}

        histogram = self._compute_histogram(responses)

        # Clip to [0, 1] before returning (sensitivity bounding)
        histogram = np.clip(histogram / n, 0, 1)

        return [histogram], n, {"shard_size": n}

    def _compute_histogram(self, responses: list[dict]) -> np.ndarray:
        """
        Compute flat histogram of option counts across all questions.
        Shape: (Q * max_options_per_question,)
        """
        max_options = max(len(q["options"]) for q in self.question_schema)
        Q = len(self.question_schema)
        histogram = np.zeros(Q * max_options, dtype=np.float32)

        for resp in responses:
            for qi, question in enumerate(self.question_schema):
                answer = resp.get(question["id"])
                if answer is None:
                    continue
                # Find option index
                for oi, option in enumerate(question["options"]):
                    if option["id"] == answer:
                        histogram[qi * max_options + oi] += 1.0
                        break

        return histogram

    def _histogram_size(self) -> int:
        max_options = max(len(q["options"]) for q in self.question_schema)
        return len(self.question_schema) * max_options

    def evaluate(self, parameters: NDArrays, config: Config):
        # Evaluation not used in this design
        return 0.0, 0, {}


def make_survey_client_app(study_id: str, shard_key: bytes) -> ClientApp:
    def client_fn(context):
        from storage.supabase_client import get_question_schema
        import asyncio
        schema = asyncio.run(get_question_schema(study_id))
        return SurveyAnalyticsClient(study_id, shard_key, schema)

    return ClientApp(client_fn=client_fn)
```

---

## 5. Result Reconstruction

After the federated round, the server reconstructs the human-readable result from the noisy histogram:

```python
# federation/aggregator.py
import numpy as np
from storage.duckdb_store import ResultsStore
from storage.supabase_client import get_question_schema

async def store_federated_results(
    study_id: str,
    noisy_histogram: np.ndarray,
    total_responses: int,
    round_num: int,
) -> None:
    schema = await get_question_schema(study_id)
    max_options = max(len(q["options"]) for q in schema)

    question_results = []
    for qi, question in enumerate(schema):
        options = question["options"]
        counts_raw = noisy_histogram[qi * max_options : qi * max_options + len(options)]

        # Denormalize (histogram was normalized by client before submission)
        counts = counts_raw * total_responses

        # Clip negative values (Gaussian noise can push below 0)
        counts = np.clip(counts, 0, None)

        # Round to nearest integer and enforce sum approximately equals n
        counts_int = np.round(counts).astype(int)

        question_results.append({
            "question_id": question["id"],
            "text": question["text"],
            "options": [
                {
                    "option_id": opt["id"],
                    "label": opt["label"],
                    "count": int(counts_int[oi]),
                    "percentage": float(counts_int[oi] / max(total_responses, 1) * 100),
                }
                for oi, opt in enumerate(options)
            ],
        })

    store = ResultsStore()
    store.store_aggregated(
        study_id,
        {"questions": question_results, "round": round_num},
        total_responses,
    )
```

---

## 6. Privacy Guarantee Summary

For a study with the following parameters:

| Parameter | Value |
|---|---|
| Total ε budget | 10.0 |
| ε per round | 1.0 |
| δ | 1e-5 |
| Maximum rounds | 10 |
| Sensitivity | 1/n_total |
| Minimum cohort | 50 |

**Guarantee**: An adversary observing all published study results cannot distinguish between any two worlds that differ in one participant's responses, with advantage at most ε=10.0 and failure probability at most δ=1e-5.

In practical terms: with 50 responses and ε=1.0, the noise magnitude is approximately:
```
σ = (1/50) * sqrt(2 * ln(1.25/1e-5)) / 1.0 ≈ 0.007
```
This translates to roughly ±0.7% noise on percentage distributions — enough to provide meaningful analytics while preserving differential privacy.

---

## 7. Local Development: Flower Simulation

For local development without Kubernetes, use Flower's simulation mode:

```python
# scripts/run_simulation.py
from flwr.simulation import run_simulation
from federation.server_app import make_server_app
from federation.client_app import make_survey_client_app

STUDY_ID = "00000000-0000-0000-0000-000000000001"
SHARD_KEYS = [b"dev_key_1_" + b"\x00"*22, b"dev_key_2_" + b"\x00"*22, b"dev_key_3_" + b"\x00"*22]

if __name__ == "__main__":
    server_app = make_server_app(STUDY_ID, num_rounds=1)
    client_app = make_survey_client_app(STUDY_ID, SHARD_KEYS[0])

    run_simulation(
        server_app=server_app,
        client_app=client_app,
        num_supernodes=3,
        backend_config={
            "client_resources": {"num_cpus": 2, "num_gpus": 0},
            "init_args": {},
        },
    )
```

---

## 8. Flower Deployment on Kubernetes (Production)

```bash
# Deploy SuperLink (server)
kubectl apply -f infra/helm/analytics/superlink-deployment.yaml

# Deploy SuperNodes (clients)
kubectl apply -f infra/helm/analytics/supernode-daemonset.yaml

# Trigger a federated round via Analytics Service API
curl -X POST http://analytics:8001/analytics/${STUDY_ID}/trigger-round \
  -H "X-Service-HMAC: ${HMAC}"
```

---

## 9. Testing Plan

| Test | Type | Coverage |
|---|---|---|
| Simulation with 5 virtual clients | Integration | Full FL round; aggregated result stored |
| DP noise magnitude | Unit | σ matches theoretical calculation |
| Budget exhaustion enforcement | Unit | Round rejected at ε limit |
| Min cohort enforcement | Unit | Results not served below 50 responses |
| Histogram reconstruction | Unit | Round-trip: responses → histogram → results |
| Negative count clipping | Unit | No negative counts in results |
| Multi-round composition | Unit | Sequential ε accumulation correct |
| Shard decryption | Integration | AES-GCM decrypt → valid response JSON |

---

## 10. Security Checklist

- [ ] ClientApp decrypts shard in memory only; plaintext never written to disk
- [ ] Shard keys fetched from secrets manager at runtime; never in environment variables
- [ ] gRPC between SuperLink and SuperNodes uses mTLS
- [ ] ε budget check runs before every round (not after)
- [ ] Minimum cohort of 50 enforced at results API layer (separate from FL layer)
- [ ] Aggregated histograms are the only data that leaves the ClientApp
- [ ] Flower version pinned in Dockerfile and requirements.txt
- [ ] SuperNode workers run as non-root user with read-only filesystem
- [ ] Memory-mapped response data is cleared after each FL round (explicit `del` + `gc.collect()`)
- [ ] Results stored in DuckDB are encrypted at filesystem level
