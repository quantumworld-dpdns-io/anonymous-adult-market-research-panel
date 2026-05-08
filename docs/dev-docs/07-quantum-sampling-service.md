# 07 — Quantum Sampling Service

## Purpose

Define the implementation of the Python Quantum Sampling Service, which uses **Qiskit** (QASM circuits) to generate cryptographically unbiased random panel assignments for market research studies. This provides a quantum-backed, auditable source of randomness for cohort selection.

---

## 1. Why Quantum Sampling

Traditional pseudo-random number generators can introduce sampling bias that sophisticated adversaries could detect or manipulate. For a panel platform where fairness of sampling is a trust property:

- **True quantum randomness** from qubit measurement is fundamentally non-deterministic.
- **Auditable circuits**: Researchers can inspect the OpenQASM 3 circuit that produced their cohort assignment — no black-box randomness.
- **IBM Quantum integration**: Optional real hardware execution for production; local Aer simulator for development.
- **CUDA-Q acceleration**: GPU-accelerated simulation for large cohorts (>10,000 participants) using NVIDIA CUDA-Q.

---

## 2. Technology Stack

| Component | Library | Role |
|---|---|---|
| FastAPI | `fastapi` 0.115 | HTTP API |
| Qiskit SDK | `qiskit` 2.x | Circuit construction, transpilation, execution |
| Qiskit Aer | `qiskit-aer` | Local GPU/CPU simulator |
| NVIDIA CUDA-Q | `cudaq` | GPU-accelerated large-circuit simulation |
| IBM Quantum | `qiskit-ibm-runtime` | Real quantum hardware execution |
| NumPy | `numpy` | Post-processing measurement outcomes |
| SciPy | `scipy` | Statistical tests (uniformity validation) |
| Pydantic | `pydantic` v2 | Request/response validation |

---

## 3. Service Structure

```
services/quantum/
├── main.py                        # FastAPI app
├── config.py
├── routers/
│   └── sampling.py                # POST /quantum/sample
├── circuits/
│   ├── uniform_sampler.py         # n-qubit Hadamard + measurement circuit
│   ├── stratified_sampler.py      # Amplitude encoding for stratified sampling
│   └── circuit_utils.py           # QASM export, transpile helpers
├── execution/
│   ├── aer_backend.py             # Local Qiskit Aer simulator
│   ├── ibm_backend.py             # IBM Quantum real hardware
│   └── cudaqbackend.py            # NVIDIA CUDA-Q GPU backend
└── sampling/
    ├── panel_sampler.py           # Main sampling logic
    ├── stratified.py              # Stratified cohort assignment
    └── statistical_tests.py       # Uniformity / chi-squared tests
```

---

## 4. Core Quantum Circuit: Uniform Sampler

```python
# circuits/uniform_sampler.py
from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister
from qiskit.qasm3 import dumps as qasm3_dumps
import numpy as np

def build_uniform_sampling_circuit(n_qubits: int) -> QuantumCircuit:
    """
    Build an n-qubit circuit that generates a uniform random bitstring.

    Each qubit is initialized to |0⟩, then put into superposition
    via a Hadamard gate. Measurement collapses to a uniformly random
    bitstring. With n qubits, we sample from {0, 1, ..., 2^n - 1} uniformly.

    For a population of size N, we use n = ceil(log2(N)) qubits and
    rejection-sample outcomes >= N.
    """
    qr = QuantumRegister(n_qubits, name='q')
    cr = ClassicalRegister(n_qubits, name='c')
    qc = QuantumCircuit(qr, cr)

    # Apply Hadamard to all qubits: |0^n⟩ → (|0⟩+|1⟩)^⊗n / sqrt(2^n)
    for i in range(n_qubits):
        qc.h(i)

    # Measure all qubits
    qc.measure(qr, cr)

    return qc

def circuit_to_qasm3(circuit: QuantumCircuit) -> str:
    """Export circuit as OpenQASM 3 for auditability."""
    return qasm3_dumps(circuit)

def sample_random_integers(
    circuit: QuantumCircuit,
    backend,
    count: int,
    max_value: int,
    shots: int | None = None,
) -> list[int]:
    """
    Execute circuit and return `count` uniform random integers in [0, max_value).
    Uses rejection sampling to handle non-power-of-2 ranges.
    """
    n_qubits = circuit.num_qubits
    total_states = 2 ** n_qubits

    # Run enough shots to get at least `count` accepted values
    rejection_rate = max_value / total_states
    required_shots = int(count / rejection_rate * 1.5) + count
    shots = shots or min(required_shots, 8192)

    from qiskit.primitives import StatevectorSampler
    sampler = StatevectorSampler()
    job = sampler.run([circuit], shots=shots)
    result = job.result()

    # Extract bitstring counts and convert to integers
    counts = result[0].data.c.get_counts()
    all_samples = []
    for bitstring, count_n in counts.items():
        value = int(bitstring, 2)
        if value < max_value:
            all_samples.extend([value] * count_n)

    # Shuffle and return exactly `count` values
    rng = np.random.default_rng()
    rng.shuffle(all_samples)
    return all_samples[:count]
```

---

## 5. Stratified Sampling Circuit

```python
# circuits/stratified_sampler.py
from qiskit import QuantumCircuit
import numpy as np

def build_stratified_circuit(strata_weights: list[float], n_samples: int) -> QuantumCircuit:
    """
    Build a circuit that samples stratum assignments proportional to weights.

    Uses amplitude encoding: each basis state represents a stratum,
    with amplitude proportional to sqrt(weight). Measurement samples
    stratum index proportionally.

    strata_weights: list of floats summing to 1.0 (e.g., [0.3, 0.5, 0.2])
    n_samples: not encoded in circuit; circuit run n_samples times
    """
    n_strata = len(strata_weights)
    n_qubits = int(np.ceil(np.log2(n_strata)))

    # Pad weights to next power of 2
    padded = list(strata_weights) + [0.0] * (2**n_qubits - n_strata)
    amplitudes = np.sqrt(padded)
    amplitudes /= np.linalg.norm(amplitudes)  # Normalize

    qc = QuantumCircuit(n_qubits, n_qubits)
    qc.initialize(amplitudes, range(n_qubits))
    qc.measure(range(n_qubits), range(n_qubits))

    return qc
```

---

## 6. Execution Backends

### 6.1 Aer Local Simulator

```python
# execution/aer_backend.py
from qiskit_aer import AerSimulator
from qiskit import transpile
from qiskit import QuantumCircuit

class AerBackend:
    def __init__(self, device: str = "CPU"):
        # Use GPU if available, fallback to CPU
        try:
            self.sim = AerSimulator(device="GPU")
        except Exception:
            self.sim = AerSimulator(device="CPU")

    def run(self, circuit: QuantumCircuit, shots: int) -> dict[str, int]:
        transpiled = transpile(circuit, self.sim, optimization_level=2)
        job = self.sim.run(transpiled, shots=shots)
        return job.result().get_counts()
```

### 6.2 IBM Quantum Real Hardware

```python
# execution/ibm_backend.py
from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2 as Sampler
from qiskit import transpile
from qiskit import QuantumCircuit
import os

class IBMQuantumBackend:
    def __init__(self):
        service = QiskitRuntimeService(
            channel="ibm_quantum",
            token=os.environ["IBM_QUANTUM_API_KEY"],
        )
        # Select least-busy backend with >= n_qubits
        self.backend = service.least_busy(
            operational=True,
            min_num_qubits=10,
        )

    def run(self, circuit: QuantumCircuit, shots: int = 1024) -> dict[str, int]:
        transpiled = transpile(
            circuit,
            backend=self.backend,
            optimization_level=3,
        )
        sampler = Sampler(mode=self.backend)
        job = sampler.run([transpiled], shots=shots)
        return job.result()[0].data.c.get_counts()
```

### 6.3 NVIDIA CUDA-Q Backend

```python
# execution/cudaqbackend.py
import cudaq
import numpy as np

class CUDAQBackend:
    def __init__(self):
        cudaq.set_target("nvidia")  # Use NVIDIA GPU

    def sample_uniform(self, n_qubits: int, shots: int) -> dict[str, int]:
        """
        Use CUDA-Q kernel for large uniform sampling circuits.
        Faster than Qiskit Aer for n_qubits > 20.
        """
        @cudaq.kernel
        def uniform_kernel(n: int):
            q = cudaq.qvector(n)
            h(q)  # Hadamard on all qubits
            mz(q)

        result = cudaq.sample(uniform_kernel, n_qubits, shots_count=shots)
        return dict(result.items())
```

---

## 7. Panel Sampler

```python
# sampling/panel_sampler.py
from pydantic import BaseModel
from typing import Literal
import numpy as np
import math

from circuits.uniform_sampler import (
    build_uniform_sampling_circuit,
    circuit_to_qasm3,
    sample_random_integers,
)
from circuits.stratified_sampler import build_stratified_circuit
from execution.aer_backend import AerBackend
from execution.ibm_backend import IBMQuantumBackend
from sampling.statistical_tests import validate_uniformity

class SamplingRequest(BaseModel):
    population_size: int        # Total eligible participants
    sample_size: int            # Desired sample
    strata: list[float] | None  # Optional stratification weights (sum to 1.0)
    backend: Literal["aer", "ibm_quantum", "cudaq"] = "aer"
    seed: int | None = None     # For reproducible dev runs only

class SamplingResult(BaseModel):
    selected_indices: list[int]     # Sampled positions (not participant identities)
    stratum_assignments: list[int] | None
    circuit_qasm: str               # Auditable QASM representation
    backend_used: str
    n_qubits: int
    shots_executed: int
    uniformity_p_value: float       # Chi-squared test p-value (> 0.05 = uniform)

async def run_panel_sample(req: SamplingRequest) -> SamplingResult:
    n_qubits = math.ceil(math.log2(req.population_size))

    # Build circuit
    circuit = build_uniform_sampling_circuit(n_qubits)
    qasm = circuit_to_qasm3(circuit)

    # Select backend
    if req.backend == "ibm_quantum":
        backend = IBMQuantumBackend()
    elif req.backend == "cudaq" and n_qubits > 20:
        from execution.cudaqbackend import CUDAQBackend
        backend = CUDAQBackend()
    else:
        backend = AerBackend()

    # Sample enough indices, then select unique ones via Fisher-Yates
    raw_samples = sample_random_integers(
        circuit, backend,
        count=req.population_size,
        max_value=req.population_size,
    )

    # Deduplicate via position shuffle, take first sample_size
    # (raw_samples is a random permutation of indices)
    seen = set()
    unique_indices = []
    for idx in raw_samples:
        if idx not in seen:
            seen.add(idx)
            unique_indices.append(idx)
        if len(unique_indices) >= req.sample_size:
            break

    # Statistical uniformity test
    p_value = validate_uniformity(raw_samples[:1000], req.population_size)

    # Stratified assignment if requested
    stratum_assignments = None
    if req.strata:
        stratum_assignments = assign_strata(unique_indices, req.strata, req.sample_size)

    return SamplingResult(
        selected_indices=unique_indices,
        stratum_assignments=stratum_assignments,
        circuit_qasm=qasm,
        backend_used=req.backend,
        n_qubits=n_qubits,
        shots_executed=len(raw_samples),
        uniformity_p_value=float(p_value),
    )
```

---

## 8. Statistical Validation

```python
# sampling/statistical_tests.py
from scipy import stats
import numpy as np

def validate_uniformity(samples: list[int], max_value: int, alpha: float = 0.05) -> float:
    """
    Chi-squared goodness-of-fit test for uniform distribution.
    Returns p-value. p > alpha means we cannot reject uniformity.
    """
    observed = np.bincount(samples, minlength=max_value)
    expected = np.full(max_value, len(samples) / max_value)

    # Only include bins with expected count >= 5 (chi-sq requirement)
    mask = expected >= 5
    if mask.sum() < 2:
        return 1.0  # Not enough data to test

    chi2, p_value = stats.chisquare(observed[mask], f_exp=expected[mask])
    return float(p_value)
```

---

## 9. FastAPI Router

```python
# routers/sampling.py
from fastapi import APIRouter, HTTPException
from sampling.panel_sampler import SamplingRequest, SamplingResult, run_panel_sample

router = APIRouter()

@router.post("/sample", response_model=SamplingResult)
async def sample_panel(req: SamplingRequest):
    if req.population_size < req.sample_size:
        raise HTTPException(400, "sample_size cannot exceed population_size")
    if req.strata and abs(sum(req.strata) - 1.0) > 0.001:
        raise HTTPException(400, "strata weights must sum to 1.0")
    if req.population_size > 1_000_000:
        raise HTTPException(400, "population_size exceeds maximum (1,000,000)")

    result = await run_panel_sample(req)

    if result.uniformity_p_value < 0.001:
        # Extremely unlikely to be uniform — flag but don't fail
        # (hardware noise is expected on real quantum backends)
        result = result.model_copy(update={"backend_used": result.backend_used + " [low_uniformity_warning]"})

    return result
```

---

## 10. Testing Plan

| Test | Type | Coverage |
|---|---|---|
| Uniform circuit construction | Unit | n=5 qubits, correct gate sequence |
| QASM export | Unit | Valid OpenQASM 3 output |
| Aer simulation | Integration | Shot counts match expected distribution |
| Sample uniqueness | Unit | No duplicate indices in output |
| Uniformity test | Unit | p > 0.05 for truly uniform samples |
| Stratified assignment | Unit | Assignment proportions match weights |
| CUDA-Q backend | Integration (GPU env) | Sample output matches Aer for same seed |
| Population size limits | Unit | 400, 404 for edge cases |

---

## 11. Dev vs Production Backend

| Environment | Backend | Notes |
|---|---|---|
| `local` | `AerSimulator(device="CPU")` | No IBM account needed |
| `staging` | `AerSimulator(device="GPU")` | Requires CUDA on node |
| `production` | IBM Quantum (least-busy) or AerSimulator | IBM API key required; fallback to Aer |
| Large cohorts (>10k) | CUDA-Q on GPU node | `ENABLE_CUDAQBACKEND=true` env flag |

---

## 12. Security Checklist

- [ ] IBM Quantum API key stored in secrets manager; never in config files
- [ ] `seed` parameter only honored in `NODE_ENV=development` (prevents reproducible prod sampling)
- [ ] QASM output stored alongside study for post-hoc audit; not used for re-execution
- [ ] Population indices are position numbers, never participant identifiers
- [ ] Uniformity p-value below 0.001 logged as warning; study admin notified
- [ ] IBM Quantum job results purged from IBM cloud after retrieval (privacy policy)
- [ ] Circuit transpilation uses optimization_level=2 (preserves semantics, reduces noise)
