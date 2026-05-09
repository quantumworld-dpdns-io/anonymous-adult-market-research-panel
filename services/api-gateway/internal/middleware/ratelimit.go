package middleware

import (
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/ulule/limiter/v3"
	sredis "github.com/ulule/limiter/v3/drivers/store/redis"
)

func RateLimit(redisClient *redis.Client, prefix string, requests int, window time.Duration) func(http.Handler) http.Handler {
	store, err := sredis.NewStoreWithOptions(redisClient, limiter.StoreOptions{
		Prefix:   "ratelimit:" + prefix,
		MaxRetry: 3,
	})
	if err != nil {
		panic("ratelimit store init: " + err.Error())
	}

	rate := limiter.Rate{Period: window, Limit: int64(requests)}
	lim := limiter.New(store, rate)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := rateLimitKey(r, prefix)
			ctx, err := lim.Get(r.Context(), key)
			if err != nil || ctx.Reached {
				w.Header().Set("Retry-After", "60")
				w.Header().Set("Content-Type", "application/json")
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func rateLimitKey(r *http.Request, prefix string) string {
	switch prefix {
	case "participant":
		if h := NullifierHashFromCtx(r.Context()); h != "" {
			return "nh:" + h
		}
	case "researcher":
		if auth := r.Header.Get("Authorization"); len(auth) > 20 {
			return "res:" + auth[len(auth)-20:]
		}
	}
	// Public: use forwarded IP (not stored, only used as rate-limit key)
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.RemoteAddr
	}
	return "ip:" + ip
}
