from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

from config import settings
from routers import sampling


def configure_telemetry() -> None:
    provider = TracerProvider()
    exporter = OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)


def create_app() -> FastAPI:
    configure_telemetry()

    app = FastAPI(
        title="Quantum Sampling Service",
        description="Qiskit-backed quantum random panel sampling for anonymous market research.",
        version="0.1.0",
        docs_url=None if settings.environment == "production" else "/docs",
        redoc_url=None,
    )

    app.include_router(sampling.router, prefix="/quantum", tags=["sampling"])

    @app.get("/health", include_in_schema=False)
    async def health() -> dict:
        return {"status": "ok", "service": settings.app_name}

    FastAPIInstrumentor.instrument_app(app)
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=settings.environment == "development")
