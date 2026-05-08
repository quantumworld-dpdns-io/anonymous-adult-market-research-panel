package middleware

import (
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

func Telemetry() func(http.Handler) http.Handler {
	tracer := otel.Tracer("api-gateway")
	propagator := propagation.TraceContext{}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := propagator.Extract(r.Context(), propagation.HeaderCarrier(r.Header))
			ctx, span := tracer.Start(ctx, r.Method+" "+r.URL.Path,
				trace.WithSpanKind(trace.SpanKindServer),
				trace.WithAttributes(
					semconv.HTTPRequestMethodKey.String(r.Method),
					semconv.URLPathKey.String(r.URL.Path),
					// Intentionally omit Authorization, X-ZK-Token, request body, RemoteAddr
				),
			)
			defer span.End()

			rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rw, r.WithContext(ctx))
			span.SetAttributes(semconv.HTTPResponseStatusCodeKey.Int(rw.status))
		})
	}
}
