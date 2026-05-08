// OpenTelemetry Web SDK initialization.
// Call initOtel() once at app startup (e.g., in a Client Component provider).

let initialized = false;

export async function initOtel(): Promise<void> {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const { WebTracerProvider } = await import('@opentelemetry/sdk-web');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
  const { Resource } = await import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions');

  const provider = new WebTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME ?? 'anonymous-panel-web',
    }),
  });

  const endpoint = process.env.NEXT_PUBLIC_OTEL_ENDPOINT;
  if (endpoint) {
    provider.addSpanProcessor(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })),
    );
  }

  provider.register();
}
