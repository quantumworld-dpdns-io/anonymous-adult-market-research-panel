import asyncio
import gc
import logging

import duckdb
import numpy as np
from flwr.client import ClientApp, NumPyClient
from flwr.common import Config, NDArrays, Scalar

logger = logging.getLogger(__name__)


class SurveyAnalyticsClient(NumPyClient):
    """
    Flower client that processes one encrypted response shard.
    Only local histograms (not raw responses) are returned to the server.
    """

    def __init__(
        self,
        study_id: str,
        shard_key: bytes,
        question_schema: list[dict],
    ) -> None:
        self.study_id = study_id
        self.shard_key = shard_key
        self.question_schema = question_schema
        self._responses: list[dict] | None = None

    def _load_responses(self) -> list[dict]:
        if self._responses is None:
            from storage.supabase_client import decrypt_and_fetch_shard
            self._responses = asyncio.run(
                decrypt_and_fetch_shard(self.study_id, self.shard_key)
            )
        return self._responses

    def _histogram_size(self) -> int:
        max_options = max((len(q.get("options", [])) for q in self.question_schema), default=1)
        return len(self.question_schema) * max_options

    def _compute_histogram(self, responses: list[dict]) -> np.ndarray:
        max_options = max((len(q.get("options", [])) for q in self.question_schema), default=1)
        Q = len(self.question_schema)
        histogram = np.zeros(Q * max_options, dtype=np.float32)

        for resp in responses:
            for qi, question in enumerate(self.question_schema):
                answer = resp.get(question["id"])
                if answer is None:
                    continue
                for oi, option in enumerate(question.get("options", [])):
                    if option["id"] == answer:
                        histogram[qi * max_options + oi] += 1.0
                        break

        return histogram

    def fit(
        self,
        parameters: NDArrays,
        config: Config,
    ) -> tuple[NDArrays, int, dict[str, Scalar]]:
        responses = self._load_responses()
        n = len(responses)

        if n == 0:
            return [np.zeros(self._histogram_size(), dtype=np.float32)], 0, {}

        histogram = self._compute_histogram(responses)
        normalized = np.clip(histogram / n, 0.0, 1.0)

        # Clear from memory after processing
        self._responses = None
        gc.collect()

        return [normalized], n, {"shard_size": float(n)}

    def evaluate(
        self,
        parameters: NDArrays,
        config: Config,
    ) -> tuple[float, int, dict[str, Scalar]]:
        return 0.0, 0, {}


def make_survey_client_app(study_id: str, shard_key: bytes) -> ClientApp:
    def client_fn(context):
        from storage.supabase_client import get_question_schema_sync
        schema = get_question_schema_sync(study_id)
        return SurveyAnalyticsClient(study_id, shard_key, schema)

    return ClientApp(client_fn=client_fn)
