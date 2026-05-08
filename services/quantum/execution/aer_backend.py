import logging

from qiskit import QuantumCircuit, transpile

logger = logging.getLogger(__name__)


class AerBackend:
    """
    Local Qiskit Aer simulator. Attempts GPU acceleration; falls back to CPU.
    """

    def __init__(self) -> None:
        from qiskit_aer import AerSimulator

        try:
            self.sim = AerSimulator(device="GPU")
            logger.info("AerBackend: using GPU device")
        except Exception:
            self.sim = AerSimulator(device="CPU")
            logger.info("AerBackend: using CPU device (GPU unavailable)")

    def run(self, circuit: QuantumCircuit, shots: int) -> dict[str, int]:
        transpiled = transpile(circuit, self.sim, optimization_level=2)
        job = self.sim.run(transpiled, shots=shots)
        return job.result().get_counts()
