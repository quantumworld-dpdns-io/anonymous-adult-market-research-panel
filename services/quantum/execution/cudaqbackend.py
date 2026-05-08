import logging

logger = logging.getLogger(__name__)


class CUDAQBackend:
    """
    NVIDIA CUDA-Q GPU-accelerated backend for large circuits (n_qubits > 20).
    Requires `cudaq` package and an NVIDIA GPU with CUDA support.
    """

    def __init__(self) -> None:
        try:
            import cudaq  # noqa: F401
            self._cudaq = cudaq
            cudaq.set_target("nvidia")
            logger.info("CUDAQBackend: initialised with nvidia target")
        except ImportError as exc:
            raise ImportError(
                "cudaq package not installed. Install CUDA-Q to use this backend."
            ) from exc

    def sample_uniform(self, n_qubits: int, shots: int) -> dict[str, int]:
        """
        Sample uniform bitstrings using a CUDA-Q kernel.
        Returns counts dict keyed by binary bitstring.
        """
        cudaq = self._cudaq

        @cudaq.kernel
        def uniform_kernel(n: int) -> None:
            q = cudaq.qvector(n)
            h(q)
            mz(q)

        result = cudaq.sample(uniform_kernel, n_qubits, shots_count=shots)
        return dict(result.items())

    def run(self, circuit, shots: int) -> dict[str, int]:
        """Compatibility shim: extracts n_qubits from a Qiskit circuit and delegates."""
        return self.sample_uniform(circuit.num_qubits, shots)
