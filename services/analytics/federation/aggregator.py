import asyncio
import logging

import numpy as np

logger = logging.getLogger(__name__)


async def store_federated_results(
    study_id: str,
    noisy_histogram: np.ndarray,
    total_responses: int,
    round_num: int,
) -> None:
    from storage.duckdb_store import ResultsStore
    from storage.supabase_client import get_question_schema

    schema = await get_question_schema(study_id)
    if not schema:
        logger.warning("No schema found for study %s; skipping result storage", study_id)
        return

    max_options = max((len(q.get("options", [])) for q in schema), default=1)
    question_results = []

    for qi, question in enumerate(schema):
        options = question.get("options", [])
        raw_slice = noisy_histogram[qi * max_options : qi * max_options + len(options)]

        # Denormalize: histogram was normalized by n before returning from client
        counts = np.clip(raw_slice * total_responses, 0.0, None)
        counts_int = np.round(counts).astype(int)
        denom = max(total_responses, 1)

        question_results.append({
            "question_id": question["id"],
            "text": question.get("text", ""),
            "options": [
                {
                    "option_id": opt["id"],
                    "label": opt.get("label", opt["id"]),
                    "count": int(counts_int[oi]),
                    "percentage": round(float(counts_int[oi]) / denom * 100, 2),
                }
                for oi, opt in enumerate(options)
            ],
        })

    from config import get_settings
    settings = get_settings()
    store = ResultsStore(db_path=settings.duckdb_path)
    store.store_aggregated(
        study_id,
        {"questions": question_results, "round": round_num},
        total_responses,
    )
    logger.info(
        "Stored federated results for study %s (round %d, n=%d)",
        study_id, round_num, total_responses,
    )
