from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Supabase
    supabase_url: str = ""
    supabase_service_key: str = ""

    # Service auth
    service_hmac_secret: str = ""

    # Analytics tuning
    min_cohort_size: int = 50
    min_shards_per_round: int = 3
    default_epsilon: float = 1.0
    default_delta: float = 1e-5
    default_total_budget: float = 10.0
    round_trigger_interval_minutes: int = 30

    # DuckDB
    duckdb_path: str = "/data/analytics.duckdb"

    # OpenTelemetry
    otel_exporter_otlp_endpoint: str = "http://otel-collector:4317"
    otel_service_name: str = "analytics-service"

    # Environment
    environment: str = "development"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
