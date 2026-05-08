import json
import logging
from typing import Any, Optional

import duckdb
import pyarrow as pa

logger = logging.getLogger(__name__)


class ResultsStore:
    def __init__(self, db_path: str = "/data/analytics.duckdb") -> None:
        self.db_path = db_path
        self.conn = duckdb.connect(db_path)
        self._init_schema()

    def _init_schema(self) -> None:
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS aggregated_results (
                study_id        VARCHAR PRIMARY KEY,
                result_json     JSON NOT NULL,
                response_count  INTEGER NOT NULL DEFAULT 0,
                last_round_at   TIMESTAMPTZ DEFAULT now()
            )
        """)

    def store_aggregated(
        self,
        study_id: str,
        question_histograms: dict,
        response_count: int,
    ) -> None:
        result_json = json.dumps(question_histograms)
        self.conn.execute(
            """
            INSERT INTO aggregated_results (study_id, result_json, response_count, last_round_at)
            VALUES (?, ?, ?, now())
            ON CONFLICT (study_id) DO UPDATE SET
                result_json    = excluded.result_json,
                response_count = excluded.response_count,
                last_round_at  = now()
            """,
            [study_id, result_json, response_count],
        )
        logger.info("Stored results for study %s (n=%d)", study_id, response_count)

    def get_aggregated_results(self, study_id: str) -> Optional[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT result_json, response_count, last_round_at FROM aggregated_results WHERE study_id = ?",
            [study_id],
        ).fetchall()

        if not rows:
            return None

        result_json, response_count, last_round_at = rows[0]
        return {
            "result_json": json.loads(result_json) if isinstance(result_json, str) else result_json,
            "response_count": response_count,
            "last_round_at": str(last_round_at) if last_round_at else None,
        }

    def export_arrow(self, study_id: str) -> pa.Table:
        return self.conn.execute(
            "SELECT * FROM aggregated_results WHERE study_id = ?",
            [study_id],
        ).arrow()

    def close(self) -> None:
        self.conn.close()
