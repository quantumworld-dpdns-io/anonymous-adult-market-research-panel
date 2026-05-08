import logging
import os

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


class BudgetTracker:
    """Per-study ε budget tracker backed by Supabase."""

    def __init__(self, study_id: str, total_budget: float = 10.0) -> None:
        self.study_id = study_id
        self.total_budget = total_budget
        self._spent: float = self._load_spent()

    def can_run_round(self, epsilon: float) -> bool:
        return self._spent + epsilon <= self.total_budget

    def record_round(self, epsilon: float) -> None:
        self._spent += epsilon
        self._persist()

    @property
    def remaining_budget(self) -> float:
        return max(0.0, self.total_budget - self._spent)

    def _load_spent(self) -> float:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            return 0.0
        try:
            from supabase import create_client
            client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
            resp = (
                client.table("study_privacy_budgets")
                .select("spent_epsilon")
                .eq("study_id", self.study_id)
                .maybe_single()
                .execute()
            )
            if resp.data:
                return float(resp.data["spent_epsilon"])
        except Exception as exc:
            logger.warning("Failed to load DP budget for %s: %s", self.study_id, exc)
        return 0.0

    def _persist(self) -> None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            return
        try:
            from supabase import create_client
            client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
            client.table("study_privacy_budgets").upsert(
                {
                    "study_id": self.study_id,
                    "spent_epsilon": self._spent,
                    "rounds_run": self._rounds_run(),
                },
                on_conflict="study_id",
            ).execute()
        except Exception as exc:
            logger.error("Failed to persist DP budget for %s: %s", self.study_id, exc)

    def _rounds_run(self) -> int:
        if self.total_budget <= 0:
            return 0
        return round(self._spent / max(self.total_budget / 10, 1e-9))
