import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config import get_settings
from storage.supabase_client import get_active_studies_above_threshold, get_shard_keys_for_study

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")


@scheduler.scheduled_job("interval", minutes=30, id="auto_trigger_rounds")
async def auto_trigger_rounds() -> None:
    """
    Every 30 minutes: check active studies that have reached the response threshold
    and trigger a federated learning round for each.
    """
    settings = get_settings()

    try:
        active_studies = await get_active_studies_above_threshold(
            min_responses=settings.min_cohort_size
        )
    except Exception as exc:
        logger.error("Failed to fetch active studies: %s", exc)
        return

    for study in active_studies:
        try:
            shard_keys = await get_shard_keys_for_study(study.id)
            if len(shard_keys) < settings.min_shards_per_round:
                logger.info(
                    "Study %s: not enough shards (%d < %d), skipping",
                    study.id, len(shard_keys), settings.min_shards_per_round,
                )
                continue

            await _run_round(study.id, shard_keys, settings)
        except Exception as exc:
            logger.error("Federated round failed for study %s: %s", study.id, exc)


async def _run_round(study_id: str, shard_keys: list[bytes], settings) -> None:
    import asyncio
    from federation.server_app import make_server_app
    from federation.client_app import make_survey_client_app
    from flwr.simulation import run_simulation

    loop = asyncio.get_event_loop()
    server_app = make_server_app(study_id, num_rounds=1)
    client_app = make_survey_client_app(study_id, shard_keys[0])

    await loop.run_in_executor(
        None,
        lambda: run_simulation(
            server_app=server_app,
            client_app=client_app,
            num_supernodes=len(shard_keys),
            backend_config={"client_resources": {"num_cpus": 1, "num_gpus": 0}},
        ),
    )
    logger.info("Auto federated round completed for study %s", study_id)
