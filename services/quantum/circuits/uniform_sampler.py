import math

import numpy as np
from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister
from qiskit.qasm3 import dumps as qasm3_dumps
from qiskit.primitives import StatevectorSampler


def build_uniform_sampling_circuit(n_qubits: int) -> QuantumCircuit:
    """
    Build an n-qubit circuit that generates a uniform random bitstring.

    Hadamard on every qubit creates equal superposition; measurement
    collapses to a uniformly random integer in [0, 2^n_qubits).
    Caller uses rejection sampling for non-power-of-2 ranges.
    """
    if n_qubits < 1:
        raise ValueError("n_qubits must be >= 1")

    qr = QuantumRegister(n_qubits, name="q")
    cr = ClassicalRegister(n_qubits, name="c")
    qc = QuantumCircuit(qr, cr)

    for i in range(n_qubits):
        qc.h(i)

    qc.measure(qr, cr)
    return qc


def circuit_to_qasm3(circuit: QuantumCircuit) -> str:
    """Export circuit as OpenQASM 3 string for auditability."""
    return qasm3_dumps(circuit)


def sample_random_integers(
    circuit: QuantumCircuit,
    backend,
    count: int,
    max_value: int,
    shots: int | None = None,
    seed: int | None = None,
) -> list[int]:
    """
    Execute circuit and return up to `count` unique integers in [0, max_value).

    Uses rejection sampling to handle non-power-of-2 ranges. Falls back to
    StatevectorSampler when backend is AerBackend for local dev.
    """
    n_qubits = circuit.num_qubits
    total_states = 2**n_qubits

    rejection_rate = max_value / total_states
    required_shots = int(count / max(rejection_rate, 1e-9) * 1.5) + count
    effective_shots = shots or min(required_shots, 8192)

    # Use backend's run() method if available; otherwise fall back to StatevectorSampler
    if hasattr(backend, "run"):
        counts: dict[str, int] = backend.run(circuit, effective_shots)
    else:
        sampler = StatevectorSampler()
        job = sampler.run([circuit], shots=effective_shots)
        counts = job.result()[0].data.c.get_counts()

    all_samples: list[int] = []
    for bitstring, n in counts.items():
        value = int(bitstring, 2)
        if value < max_value:
            all_samples.extend([value] * n)

    rng = np.random.default_rng(seed)
    rng.shuffle(all_samples)
    return all_samples[:count]


def n_qubits_for_population(population_size: int) -> int:
    """Return minimum qubits needed to address population_size states."""
    if population_size <= 1:
        return 1
    return math.ceil(math.log2(population_size))
