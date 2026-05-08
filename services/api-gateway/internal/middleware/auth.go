package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/quantumworld/panel/api-gateway/internal/auth"
)

type contextKey string

const (
	contextKeyNullifierHash contextKey = "nullifier_hash"
	contextKeyResearcher    contextKey = "researcher_claims"
)

func AuthenticateZKToken(verifier *auth.ZKTokenVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr := r.Header.Get("X-ZK-Token")
			if tokenStr == "" {
				http.Error(w, `{"error":"missing ZK token"}`, http.StatusUnauthorized)
				return
			}

			studyID := r.URL.Query().Get("study_id")
			if studyID == "" {
				studyID = r.Header.Get("X-Study-ID")
			}

			payload, err := verifier.Verify(tokenStr, studyID)
			if err != nil {
				http.Error(w, `{"error":"invalid ZK token"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), contextKeyNullifierHash, payload.Sub)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func AuthenticateResearcher(verifier *auth.SupabaseJWTVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if !strings.HasPrefix(authHeader, "Bearer ") {
				http.Error(w, `{"error":"missing authorization"}`, http.StatusUnauthorized)
				return
			}
			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

			claims, err := verifier.Verify(tokenStr)
			if err != nil {
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), contextKeyResearcher, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func NullifierHashFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(contextKeyNullifierHash).(string)
	return v
}
