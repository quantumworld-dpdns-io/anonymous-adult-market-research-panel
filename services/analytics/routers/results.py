import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import get_settings
from privacy.budget_tracker import BudgetTracker
from storage.duckdb_store import ResultsStore

logger = logging.getLogger(__name__)
router = APIRouter()


class OptionResult(BaseModel):
    option_id: str
    label: str
    count: int
    percentage: float


class QuestionResult(BaseModel):
    question_id: str
    text: str
    options: list[OptionResult]


class StudyResultsResponse(BaseModel):
    study_id: str
    question_results: list[QuestionResult]
    epsilon_budget_used: float
    epsilon_budget_remaining: float
    min_cohort_size: int
    response_count: int
    last_round_at: Optional[str]


@router.get("/{study_id}/results", response_model=StudyResultsResponse)
async def get_results(study_id: str) -> StudyResultsResponse:
    settings = get_settings()
    store = ResultsStore(db_path=settings.duckdb_path)
    tracker = BudgetTracker(study_id, total_budget=settings.default_total_budget)

    row = store.get_aggregated_results(study_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail="No results available yet. Federated round not complete.",
        )

    if row["response_count"] < settings.min_cohort_size:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Minimum cohort of {settings.min_cohort_size} required. "
                f"Current: {row['response_count']}"
            ),
        )

    questions_raw = row["result_json"].get("questions", [])
    question_results = [
        QuestionResult(
            question_id=q["question_id"],
            text=q["text"],
            options=[OptionResult(**opt) for opt in q["options"]],
        )
        for q in questions_raw
    ]

    budget_used = tracker.total_budget - tracker.remaining_budget

    return StudyResultsResponse(
        study_id=study_id,
        question_results=question_results,
        epsilon_budget_used=budget_used,
        epsilon_budget_remaining=tracker.remaining_budget,
        min_cohort_size=settings.min_cohort_size,
        response_count=row["response_count"],
        last_round_at=row.get("last_round_at"),
    )
