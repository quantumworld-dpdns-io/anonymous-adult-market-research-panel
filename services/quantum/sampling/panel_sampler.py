import math
import logging
from typing import Literal

import numpy as np
from pydantic import BaseModel, field_validator, model_validator

from circuits.uniform_sampler import (
    build_uniform_sampling_circuit,
    circuit_to_qasm3,
    sample_random_integers,
    n_qubits_for_population,
)
from sampling.statistical_tests import validate_uniformity
from sampling.stratified import assign_strata

logger = logging.getLogger(__name__)


class SamplingRequest(BaseModel):
    population_size: int
    sample_size: int
    strata: list[float] | None = None
    backend: Literal["aer", "ibm_quantum", "cudaq"] = "aer"
    seed: int | None = None

    @field_validator("population_size")
    @classmethod
    def population_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("population_size must be >= 1")
        return v

    @field_validator("sample_size")
    @classmethod
    def sample_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("sample_size must be >= 1")
        return v

    @model_validator(mode="after")
    def sample_le_population(self) -> "SamplingRequest":
        if self.sample_size > self.population_size:
            raise ValueError("sample_size cannot exceed population_size")
        return self


class SamplingResult(BaseModel):
    selected_indices: list[int]
    stratum_assignments: list[int] | None = None
    circuit_qasm: str
    backend_used: str
    n_qubits: int
    shots_executed: int
    uniformity_p_value: float


def _get_backend(backend_name: str, n_qubits: int):
    from config import settings

    if backend_name == "ibm_quantum":
        from execution.ibm_backend import IBMQuantumBackend
        return IBMQuantumBackend(min_qubits=n_qubits)

    if backend_name == "cudaq" and n_qubits > 20:
        from execution.cudaqbackend import CUDAQBackend
        return CUDAQBackend()

    from execution.aer_backend import AerBackend
    return AerBackend()


async def run_panel_sample(req: SamplingRequest) -> SamplingResult:
    n_qubits = n_qubits_for_population(req.population_size)
    circuit = build_uniform_sampling_circuit(n_qubits)
    qasm = circuit_to_qasm3(circuit)

    backend = _get_backend(req.backend, n_qubits)

    raw_samples = sample_random_integers(
        circuit,
        backend,
        count=req.population_size * 2,  # Oversample for dedup
        max_value=req.population_size,
        seed=req.seed,
    )

    # Deduplicate while preserving quantum-random order
    seen: set[int] = set()
    unique_indices: list[int] = []
    for idx in raw_samples:
        if idx not in seen:
            seen.add(idx)
            unique_indices.append(idx)
        if len(unique_indices) >= req.sample_size:
            break

    # If quantum sampling didn't yield enough unique indices, pad with classical
    if len(unique_indices) < req.sample_size:
        logger.warning(
            "Quantum sampling yielded only %d unique indices; padding with classical RNG",
            len(unique_indices),
        )
        remaining = set(range(req.population_size)) - seen
        rng = np.random.default_rng(req.seed)
        extras = rng.choice(list(remaining), size=req.sample_size - len(unique_indices), replace=False)
        unique_indices.extend(extras.tolist())

    p_value = validate_uniformity(raw_samples[:1000], req.population_size)

    stratum_assignments: list[int] | None = None
    if req.strata:
        stratum_assignments = assign_strata(unique_indices, req.strata, req.sample_size, backend)

    return SamplingResult(
        selected_indices=unique_indices[: req.sample_size],
        stratum_assignments=stratum_assignments,
        circuit_qasm=qasm,
        backend_used=req.backend,
        n_qubits=n_qubits,
        shots_executed=len(raw_samples),
        uniformity_p_value=p_value,
    )
