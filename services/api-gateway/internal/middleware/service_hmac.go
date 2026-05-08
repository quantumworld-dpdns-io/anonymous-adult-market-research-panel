package middleware

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"
	"strconv"
)

func AuthenticateServiceHMAC(secret string) func(http.Handler) http.Handler {
	key := []byte(secret)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sig := r.Header.Get("X-Service-HMAC")
			ts := r.Header.Get("X-Service-Timestamp")
			if sig == "" || ts == "" {
				http.Error(w, `{"error":"missing service credentials"}`, http.StatusUnauthorized)
				return
			}

			// Reject stale timestamps (replay protection, ±5 min window)
			tsInt, err := strconv.ParseInt(ts, 10, 64)
			if err != nil || absInt64(time.Now().Unix()-tsInt) > 300 {
				http.Error(w, `{"error":"stale timestamp"}`, http.StatusUnauthorized)
				return
			}

			// Expected: HMAC-SHA256(method + path + timestamp, secret)
			msg := r.Method + r.URL.Path + ts
			mac := hmac.New(sha256.New, key)
			mac.Write([]byte(msg))
			expected := hex.EncodeToString(mac.Sum(nil))

			// Constant-time comparison to prevent timing attacks
			if !hmac.Equal([]byte(sig), []byte(expected)) {
				http.Error(w, `{"error":"invalid service credentials"}`, http.StatusUnauthorized)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func absInt64(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}
