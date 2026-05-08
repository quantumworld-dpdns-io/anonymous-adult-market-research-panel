import logging

from fastapi import APIRouter, HTTPException

from config import settings
from sampling.panel_sampler import SamplingRequest, SamplingResult, run_panel_sample

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/sample", response_model=SamplingResult, summary="Generate quantum-random panel sample")
async def sample_panel(req: SamplingRequest) -> SamplingResult:
    """
    Generate a panel sample using a Qiskit quantum circuit.

    - population_size: total eligible participants (pool size)
    - sample_size: how many to select
    - strata: optional list of weights summing to 1.0 for stratified sampling
    - backend: "aer" (local), "ibm_quantum" (real hardware), "cudaq" (GPU)
    - seed: reproducible sampling (development only)
    """
    if req.population_size < req.sample_size:
        raise HTTPException(status_code=400, detail="sample_size cannot exceed population_size")

    if req.strata is not None and abs(sum(req.strata) - 1.0) > 0.001:
        raise HTTPException(status_code=400, detail="strata weights must sum to 1.0")

    if req.population_size > settings.max_population_size:
        raise HTTPException(
            status_code=400,
            detail=f"population_size exceeds maximum ({settings.max_population_size:,})",
        )

    if req.seed is not None and settings.environment == "production" and not settings.allow_seed_in_production:
        raise HTTPException(status_code=400, detail="seed parameter not allowed in production")

    if req.backend == "ibm_quantum" and not settings.ibm_quantum_api_key:
        raise HTTPException(status_code=400, detail="IBM Quantum backend requires IBM_QUANTUM_API_KEY")

    if req.backend == "cudaq" and not settings.enable_cudaq_backend:
        raise HTTPException(status_code=400, detail="CUDA-Q backend not enabled (set ENABLE_CUDAQ_BACKEND=true)")

    result = await run_panel_sample(req)

    if result.uniformity_p_value < 0.001:
        logger.warning(
            "Low uniformity p-value %.4f for backend %s — hardware noise may be affecting results",
            result.uniformity_p_value,
            result.backend_used,
        )
        result = result.model_copy(
            update={"backend_used": result.backend_used + " [low_uniformity_warning]"}
        )

    return result
