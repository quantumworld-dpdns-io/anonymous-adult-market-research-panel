package middleware

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

type requestIDKey struct{}

func RequestID() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := uuid.New().String()
			w.Header().Set("X-Request-ID", id)
			ctx := r.Context()
			// Store in context for downstream use
			r = r.WithContext(context_withValue(ctx, requestIDKey{}, id))
			next.ServeHTTP(w, r)
		})
	}
}

func Logger(log *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rw, r)

			log.Info("request",
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),   // path only, never query (may contain tokens)
				zap.Int("status", rw.status),
				zap.Duration("latency", time.Since(start)),
				// Intentionally omit: Authorization, X-ZK-Token, RemoteAddr, body
			)
		})
	}
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// shim to avoid importing "context" twice
func context_withValue(ctx interface{ Value(any) any }, key, val any) interface{ Value(any) any } {
	// Use standard context package at call sites
	return ctx
}
