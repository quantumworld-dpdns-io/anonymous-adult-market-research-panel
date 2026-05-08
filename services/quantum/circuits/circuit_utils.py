from qiskit import QuantumCircuit, transpile
from qiskit.qasm3 import dumps as qasm3_dumps


def transpile_for_backend(circuit: QuantumCircuit, backend, optimization_level: int = 2) -> QuantumCircuit:
    """Transpile circuit for a specific Qiskit backend."""
    return transpile(circuit, backend=backend, optimization_level=optimization_level)


def to_qasm3(circuit: QuantumCircuit) -> str:
    """Serialize circuit to OpenQASM 3 string."""
    return qasm3_dumps(circuit)


def circuit_summary(circuit: QuantumCircuit) -> dict:
    """Return a human-readable summary of circuit properties."""
    return {
        "n_qubits": circuit.num_qubits,
        "n_clbits": circuit.num_clbits,
        "depth": circuit.depth(),
        "gate_counts": dict(circuit.count_ops()),
        "n_parameters": circuit.num_parameters,
    }
