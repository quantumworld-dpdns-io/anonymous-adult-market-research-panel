from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "quantum-sampling-service"
    environment: str = "development"
    log_level: str = "INFO"

    # IBM Quantum
    ibm_quantum_api_key: str = ""
    ibm_quantum_channel: str = "ibm_quantum"
    ibm_min_qubits: int = 10

    # Backend selection
    default_backend: Literal["aer", "ibm_quantum", "cudaq"] = "aer"
    enable_cudaq_backend: bool = False

    # Limits
    max_population_size: int = 1_000_000
    max_shots: int = 8192

    # OpenTelemetry
    otel_exporter_otlp_endpoint: str = "http://localhost:4317"
    otel_service_name: str = "quantum-sampling-service"

    # Security: seed only allowed in dev
    allow_seed_in_production: bool = False


settings = Settings()
