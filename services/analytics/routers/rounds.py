import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Header
from pydantic import BaseModel

from config import get_settings
from storage.supabase_client import get_shard_keys_for_study

logger = logging.getLogger(__name__)
router = APIRouter()


class TriggerRoundResponse(BaseModel):
    study_id: str
    status: str
    message: str


async def _run_federated_round(study_id: str) -> None:
    from federation.server_app import make_server_app
    from federation.client_app import make_survey_client_app
    from flwr.simulation import run_simulation

    settings = get_settings()
    shard_keys = await get_shard_keys_for_study(study_id)

    if len(shard_keys) < settings.min_shards_per_round:
        logger.warning(
            "Not enough shards for study %s: %d < %d",
            study_id, len(shard_keys), settings.min_shards_per_round,
        )
        return

    server_app = make_server_app(study_id, num_rounds=1)
    client_app = make_survey_client_app(study_id, shard_keys[0])

    run_simulation(
        server_app=server_app,
        client_app=client_app,
        num_supernodes=len(shard_keys),
        backend_config={"client_resources": {"num_cpus": 1, "num_gpus": 0}},
    )
    logger.info("Federated round completed for study %s", study_id)


@router.post("/{study_id}/trigger-round", response_model=TriggerRoundResponse)
async def trigger_round(
    study_id: str,
    background_tasks: BackgroundTasks,
    x_service_hmac: str = Header(..., alias="X-Service-HMAC"),
) -> TriggerRoundResponse:
    import hashlib, hmac
    settings = get_settings()

    expected = hmac.new(
        settings.service_hmac_secret.encode(),
        study_id.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(x_service_hmac, expected):
        raise HTTPException(status_code=401, detail="Invalid service HMAC")

    background_tasks.add_task(_run_federated_round, study_id)

    return TriggerRoundResponse(
        study_id=study_id,
        status="accepted",
        message="Federated round scheduled in background.",
    )
