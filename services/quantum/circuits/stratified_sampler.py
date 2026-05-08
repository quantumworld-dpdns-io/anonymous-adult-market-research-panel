import numpy as np
from qiskit import QuantumCircuit


def build_stratified_circuit(strata_weights: list[float]) -> QuantumCircuit:
    """
    Build a circuit that samples stratum indices proportional to weights.

    Uses amplitude encoding: amplitude[i] = sqrt(weight[i]) (normalised).
    A single measurement collapses to stratum i with probability weight[i].
    Run the circuit n_samples times to assign strata.

    Args:
        strata_weights: probabilities summing to 1.0, e.g. [0.3, 0.5, 0.2]

    Returns:
        QuantumCircuit with n_qubits = ceil(log2(len(strata_weights)))
    """
    if not strata_weights:
        raise ValueError("strata_weights must be non-empty")
    if abs(sum(strata_weights) - 1.0) > 1e-6:
        raise ValueError("strata_weights must sum to 1.0")

    n_strata = len(strata_weights)
    n_qubits = max(1, int(np.ceil(np.log2(n_strata))))
    n_states = 2**n_qubits

    padded = list(strata_weights) + [0.0] * (n_states - n_strata)
    amplitudes = np.sqrt(np.array(padded, dtype=float))
    norm = np.linalg.norm(amplitudes)
    if norm > 0:
        amplitudes /= norm

    qc = QuantumCircuit(n_qubits, n_qubits)
    qc.initialize(amplitudes.tolist(), list(range(n_qubits)))
    qc.measure(list(range(n_qubits)), list(range(n_qubits)))
    return qc


def sample_strata_assignments(
    strata_weights: list[float],
    n_samples: int,
    backend,
    shots: int = 4096,
) -> list[int]:
    """
    Run stratified circuit and return n_samples stratum indices.

    Indices outside len(strata_weights) are discarded (padding states).
    """
    circuit = build_stratified_circuit(strata_weights)
    n_strata = len(strata_weights)

    if hasattr(backend, "run"):
        counts: dict[str, int] = backend.run(circuit, shots)
    else:
        from qiskit.primitives import StatevectorSampler
        sampler = StatevectorSampler()
        job = sampler.run([circuit], shots=shots)
        counts = job.result()[0].data.c.get_counts()

    raw: list[int] = []
    for bitstring, count in counts.items():
        idx = int(bitstring, 2)
        if idx < n_strata:
            raw.extend([idx] * count)

    rng = np.random.default_rng()
    rng.shuffle(raw)
    result = raw[:n_samples]

    # If not enough valid samples, pad with classical random to maintain size
    if len(result) < n_samples:
        extras = rng.choice(n_strata, size=n_samples - len(result), p=strata_weights).tolist()
        result.extend(extras)

    return result
