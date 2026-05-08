import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from config import get_settings
from routers import health, results, rounds

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def configure_telemetry(settings) -> None:
    resource = Resource.create({"service.name": settings.otel_service_name})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint, insecure=True)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_telemetry(settings)

    # Start APScheduler for automatic federated round triggering
    if settings.is_production:
        from tasks.scheduled_rounds import scheduler
        scheduler.start()
        logger.info("APScheduler started")

    yield

    if settings.is_production:
        from tasks.scheduled_rounds import scheduler
        if scheduler.running:
            scheduler.shutdown(wait=False)


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Anonymous Panel Analytics Service",
        version="1.0.0",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["X-Service-HMAC", "Content-Type"],
    )

    app.include_router(health.router, tags=["health"])
    app.include_router(results.router, prefix="/analytics", tags=["results"])
    app.include_router(rounds.router, prefix="/analytics", tags=["rounds"])

    FastAPIInstrumentor.instrument_app(app, excluded_urls="/health")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
