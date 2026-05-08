import logging
import os

from qiskit import QuantumCircuit, transpile

logger = logging.getLogger(__name__)


class IBMQuantumBackend:
    """
    IBM Quantum real-hardware backend via qiskit-ibm-runtime.
    Selects the least-busy operational backend with >= min_qubits.
    """

    def __init__(self, min_qubits: int = 10) -> None:
        from qiskit_ibm_runtime import QiskitRuntimeService

        api_key = os.environ.get("IBM_QUANTUM_API_KEY", "")
        if not api_key:
            raise EnvironmentError("IBM_QUANTUM_API_KEY environment variable not set")

        service = QiskitRuntimeService(channel="ibm_quantum", token=api_key)
        self.backend = service.least_busy(operational=True, min_num_qubits=min_qubits)
        logger.info("IBMQuantumBackend: selected backend %s", self.backend.name)

    def run(self, circuit: QuantumCircuit, shots: int = 1024) -> dict[str, int]:
        from qiskit_ibm_runtime import SamplerV2 as Sampler

        transpiled = transpile(circuit, backend=self.backend, optimization_level=3)
        sampler = Sampler(mode=self.backend)
        job = sampler.run([transpiled], shots=shots)
        result = job.result()
        counts: dict[str, int] = result[0].data.c.get_counts()
        return counts
