# 04 — Go API Gateway

## Purpose

Define the complete implementation of the Go API Gateway — the single ingress point for all external traffic, responsible for PQC TLS termination, authentication, routing, rate-limiting, and telemetry.

---

## 1. Technology Stack

| Component | Library | Version |
|---|---|---|
| HTTP Router | `go-chi/chi` | v5 |
| gRPC gateway | `grpc-gateway/v2` | v2 |
| TLS / PQC | `cloudflare/circl` | v1 |
| JWT validation | `golang-jwt/jwt` | v5 |
| Rate limiting | `ulule/limiter` + Redis | v3 |
| OpenTelemetry | `open-telemetry/otel-go` | v1 |
| Config | `spf13/viper` | v1 |
| Logger | `uber-go/zap` | v1 |
| gRPC client | `google.golang.org/grpc` | v1 |

---

## 2. Service Structure

```
services/api-gateway/
├── cmd/
│   └── gateway/
│       └── main.go              # Entry point
├── internal/
│   ├── auth/
│   │   ├── supabase_jwt.go      # Researcher JWT verification
│   │   └── zk_token.go          # Participant ZK token verification
│   ├── middleware/
│   │   ├── ratelimit.go
│   │   ├── logging.go
│   │   ├── telemetry.go
│   │   └── recover.go
│   ├── handlers/
│   │   ├── zk.go               # /zk/* routes
│   │   ├── studies.go          # /studies/* routes
│   │   ├── responses.go        # /responses route
│   │   ├── analytics.go        # /analytics/* routes
│   │   └── quantum.go          # /quantum/* routes
│   ├── clients/
│   │   ├── zk_proving.go       # gRPC client for Rust ZK service
│   │   ├── analytics.go        # HTTP client for Python analytics
│   │   └── quantum.go          # HTTP client for Python quantum service
│   ├── tls/
│   │   └── pqc.go              # ML-KEM hybrid TLS configuration
│   └── config/
│       └── config.go
├── proto/
│   └── zkproving/
│       └── v1/
│           └── service.proto   # gRPC service definition
├── Makefile
├── Dockerfile
└── go.mod
```

---

## 3. Main Entry Point

```go
// cmd/gateway/main.go
package main

import (
    "context"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/go-chi/chi/v5"
    "go.uber.org/zap"

    "github.com/quantumworld/panel/internal/auth"
    "github.com/quantumworld/panel/internal/clients"
    "github.com/quantumworld/panel/internal/config"
    "github.com/quantumworld/panel/internal/handlers"
    "github.com/quantumworld/panel/internal/middleware"
    "github.com/quantumworld/panel/internal/tls"
)

func main() {
    cfg := config.Load()
    log, _ := zap.NewProduction()
    defer log.Sync()

    // Initialize downstream clients
    zkClient := clients.NewZKProvingClient(cfg.ZKProvingAddr)
    analyticsClient := clients.NewAnalyticsClient(cfg.AnalyticsAddr)
    quantumClient := clients.NewQuantumClient(cfg.QuantumAddr)

    // Initialize auth verifiers
    supabaseVerifier := auth.NewSupabaseJWTVerifier(cfg.SupabaseJWTSecret)
    zkVerifier := auth.NewZKTokenVerifier(cfg.ZKTokenSecret)

    // Build router
    r := chi.NewRouter()

    // Global middleware
    r.Use(middleware.Recover(log))
    r.Use(middleware.RequestID())
    r.Use(middleware.Logger(log))
    r.Use(middleware.Telemetry())
    r.Use(middleware.CORS(cfg.AllowedOrigins))

    // Public routes (participant, no researcher auth)
    r.Group(func(r chi.Router) {
        r.Use(middleware.RateLimit(cfg.Redis, "public", 20, time.Minute))
        r.Post("/zk/verify-age", handlers.VerifyAge(zkClient))
        r.Post("/zk/issue-credential", handlers.IssueCredential(zkClient))
        r.Get("/zk/date-attestation", handlers.DateAttestation(zkClient))
        r.Get("/studies", handlers.ListPublicStudies(analyticsClient))
        r.Get("/studies/{studyId}/questions", handlers.GetStudyQuestions())
    })

    // Participant routes (ZK token required)
    r.Group(func(r chi.Router) {
        r.Use(middleware.RateLimit(cfg.Redis, "participant", 5, time.Minute))
        r.Use(middleware.AuthenticateZKToken(zkVerifier))
        r.Post("/responses", handlers.SubmitResponse())
    })

    // Researcher routes (Supabase JWT required)
    r.Group(func(r chi.Router) {
        r.Use(middleware.RateLimit(cfg.Redis, "researcher", 60, time.Minute))
        r.Use(middleware.AuthenticateResearcher(supabaseVerifier))
        r.Post("/studies", handlers.CreateStudy())
        r.Get("/studies/{studyId}", handlers.GetStudy())
        r.Put("/studies/{studyId}", handlers.UpdateStudy())
        r.Get("/analytics/{studyId}/results", handlers.GetResults(analyticsClient))
        r.Post("/quantum/sample", handlers.QuantumSample(quantumClient))
    })

    // Internal routes (service-to-service HMAC)
    r.Group(func(r chi.Router) {
        r.Use(middleware.AuthenticateServiceHMAC(cfg.ServiceHMACSecret))
        r.Get("/internal/analytics/{studyId}/results", handlers.InternalResults(analyticsClient))
    })

    // Configure PQC TLS
    tlsConfig := tls.NewHybridTLSConfig(cfg.CertFile, cfg.KeyFile)

    server := &http.Server{
        Addr:         cfg.ListenAddr,
        Handler:      r,
        TLSConfig:    tlsConfig,
        ReadTimeout:  30 * time.Second,
        WriteTimeout: 60 * time.Second,
        IdleTimeout:  120 * time.Second,
    }

    // Graceful shutdown
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()

    go func() {
        log.Info("API Gateway starting", zap.String("addr", cfg.ListenAddr))
        if err := server.ListenAndServeTLS("", ""); err != http.ErrServerClosed {
            log.Fatal("server error", zap.Error(err))
        }
    }()

    <-ctx.Done()
    log.Info("Shutting down")
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    server.Shutdown(shutdownCtx)
}
```

---

## 4. PQC TLS Configuration

```go
// internal/tls/pqc.go
package tls

import (
    "crypto/tls"
    "crypto/x509"

    "github.com/cloudflare/circl/kem/hybrid"
)

// NewHybridTLSConfig configures TLS 1.3 with X25519 + ML-KEM-768 hybrid KEM.
// Falls back to classical ECDH for clients that don't support PQC.
func NewHybridTLSConfig(certFile, keyFile string) *tls.Config {
    cert, err := tls.LoadX509KeyPair(certFile, keyFile)
    if err != nil {
        panic(err)
    }

    return &tls.Config{
        Certificates: []tls.Certificate{cert},
        MinVersion:   tls.VersionTLS13,
        // Prefer X25519MLKEM768 (hybrid PQC), fall back to X25519
        CurvePreferences: []tls.CurveID{
            // CIRCL registers this curve ID when imported
            hybrid.X25519MLKEM768.TLSCurveID(),
            tls.X25519,
            tls.CurveP256,
        },
        CipherSuites: []uint16{
            tls.TLS_AES_256_GCM_SHA384,
            tls.TLS_CHACHA20_POLY1305_SHA256,
        },
    }
}
```

---

## 5. Auth Middleware

### 5.1 Supabase JWT Verification

```go
// internal/auth/supabase_jwt.go
package auth

import (
    "context"
    "errors"
    "net/http"
    "strings"

    "github.com/golang-jwt/jwt/v5"
)

type SupabaseJWTVerifier struct {
    secret []byte
}

func NewSupabaseJWTVerifier(secret string) *SupabaseJWTVerifier {
    return &SupabaseJWTVerifier{secret: []byte(secret)}
}

type ResearcherClaims struct {
    jwt.RegisteredClaims
    Email string `json:"email"`
    Role  string `json:"role"`
}

func (v *SupabaseJWTVerifier) Verify(tokenStr string) (*ResearcherClaims, error) {
    token, err := jwt.ParseWithClaims(tokenStr, &ResearcherClaims{},
        func(t *jwt.Token) (interface{}, error) {
            if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, errors.New("unexpected signing method")
            }
            return v.secret, nil
        },
    )
    if err != nil {
        return nil, err
    }
    claims, ok := token.Claims.(*ResearcherClaims)
    if !ok || !token.Valid {
        return nil, errors.New("invalid claims")
    }
    return claims, nil
}
```

### 5.2 ZK Token Middleware

```go
// internal/middleware/auth.go (ZK token part)
func AuthenticateZKToken(verifier *auth.ZKTokenVerifier) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            tokenStr := r.Header.Get("X-ZK-Token")
            if tokenStr == "" {
                http.Error(w, `{"error":"missing ZK token"}`, http.StatusUnauthorized)
                return
            }

            studyID := r.URL.Query().Get("study_id")
            // Also check JSON body for study_id if not in query
            if studyID == "" {
                studyID = r.Header.Get("X-Study-ID")
            }

            payload, err := verifier.Verify(tokenStr, studyID)
            if err != nil {
                http.Error(w, `{"error":"invalid ZK token"}`, http.StatusUnauthorized)
                return
            }

            // Inject nullifier hash into context (for rate limiting, not identity)
            ctx := context.WithValue(r.Context(), contextKeyNullifierHash, payload.Sub)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

---

## 6. Rate Limiting

```go
// internal/middleware/ratelimit.go
package middleware

import (
    "net/http"
    "time"

    "github.com/go-redis/redis/v8"
    "github.com/ulule/limiter/v3"
    "github.com/ulule/limiter/v3/drivers/store/redisstore"
)

func RateLimit(redisClient *redis.Client, prefix string, requests int, window time.Duration) func(http.Handler) http.Handler {
    store, _ := redisstore.NewStoreWithOptions(redisClient, limiter.StoreOptions{
        Prefix: "ratelimit:" + prefix,
    })

    rate := limiter.Rate{Period: window, Limit: int64(requests)}
    lim := limiter.New(store, rate)

    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            // Key: nullifier hash for participants, JWT sub for researchers, IP for public
            key := rateLimitKey(r, prefix)
            ctx, err := lim.Get(r.Context(), key)
            if err != nil || ctx.Reached {
                w.Header().Set("Retry-After", "60")
                http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

---

## 7. gRPC Client for ZK Proving Service

```go
// internal/clients/zk_proving.go
package clients

import (
    "context"

    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials"

    pb "github.com/quantumworld/panel/proto/zkproving/v1"
)

type ZKProvingClient struct {
    client pb.ZKProvingServiceClient
}

func NewZKProvingClient(addr string) *ZKProvingClient {
    creds, _ := credentials.NewClientTLSFromFile("certs/zk-proving.crt", "")
    conn, _ := grpc.Dial(addr,
        grpc.WithTransportCredentials(creds),
        grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(10*1024*1024)),
    )
    return &ZKProvingClient{client: pb.NewZKProvingServiceClient(conn)}
}

func (c *ZKProvingClient) VerifyAge(ctx context.Context, req *pb.VerifyAgeRequest) (*pb.VerifyAgeResponse, error) {
    return c.client.VerifyAge(ctx, req)
}

func (c *ZKProvingClient) IssueCredential(ctx context.Context, req *pb.IssueCredentialRequest) (*pb.IssueCredentialResponse, error) {
    return c.client.IssueCredential(ctx, req)
}
```

---

## 8. OpenTelemetry Integration

```go
// internal/middleware/telemetry.go
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
                    // Never include Authorization, X-ZK-Token, or body content in spans
                ),
            )
            defer span.End()

            rw := &responseWriter{ResponseWriter: w}
            next.ServeHTTP(rw, r.WithContext(ctx))

            span.SetAttributes(semconv.HTTPResponseStatusCodeKey.Int(rw.status))
        })
    }
}
```

---

## 9. Proto Definition

```protobuf
// proto/zkproving/v1/service.proto
syntax = "proto3";
package zkproving.v1;

service ZKProvingService {
    rpc VerifyAge (VerifyAgeRequest) returns (VerifyAgeResponse);
    rpc IssueCredential (IssueCredentialRequest) returns (IssueCredentialResponse);
    rpc GetDateAttestation (DateAttestationRequest) returns (DateAttestationResponse);
}

message VerifyAgeRequest {
    bytes proof = 1;
    repeated string public_inputs = 2;
    string nullifier = 3;
    string study_id = 4;
    DateAttestation date_attestation = 5;
}

message VerifyAgeResponse {
    string zk_session_token = 1;
}

message DateAttestation {
    uint32 year = 1;
    uint32 month = 2;
    uint32 day = 3;
    int64 signed_at = 4;
    bytes signature = 5;
}
```

---

## 10. Configuration

```go
// internal/config/config.go
type Config struct {
    ListenAddr       string
    CertFile         string
    KeyFile          string

    // Downstream services
    ZKProvingAddr    string
    AnalyticsAddr    string
    QuantumAddr      string

    // Auth
    SupabaseJWTSecret string
    ZKTokenSecret     string
    ServiceHMACSecret string

    // Redis
    Redis            *redis.Client

    // Supabase
    SupabaseURL      string
    SupabaseServiceKey string

    // CORS
    AllowedOrigins   []string

    // Telemetry
    OTelEndpoint     string
}

func Load() *Config {
    viper.AutomaticEnv()
    viper.SetDefault("LISTEN_ADDR", ":8080")
    // ... etc
    return &Config{
        ListenAddr:       viper.GetString("LISTEN_ADDR"),
        CertFile:         viper.GetString("TLS_CERT_FILE"),
        KeyFile:          viper.GetString("TLS_KEY_FILE"),
        ZKProvingAddr:    viper.GetString("ZK_PROVING_ADDR"),
        AnalyticsAddr:    viper.GetString("ANALYTICS_ADDR"),
        QuantumAddr:      viper.GetString("QUANTUM_ADDR"),
        SupabaseJWTSecret: viper.GetString("SUPABASE_JWT_SECRET"),
        ZKTokenSecret:    viper.GetString("ZK_TOKEN_SECRET"),
        ServiceHMACSecret: viper.GetString("SERVICE_HMAC_SECRET"),
        AllowedOrigins:   viper.GetStringSlice("ALLOWED_ORIGINS"),
        OTelEndpoint:     viper.GetString("OTEL_EXPORTER_OTLP_ENDPOINT"),
    }
}
```

---

## 11. Testing Plan

| Test | Type | Coverage |
|---|---|---|
| PQC TLS handshake | Integration | Client connects with X25519MLKEM768 |
| JWT verification | Unit | Valid / expired / wrong secret |
| ZK token verification | Unit | Valid / expired / study mismatch |
| Rate limit enforcement | Integration | 429 after threshold with Redis |
| gRPC client retry | Integration | Retry on transient ZK service error |
| CORS preflight | Integration | Allowed origins pass; others 403 |
| OTel span creation | Unit | Span attributes present; no PII in spans |
| Service HMAC | Unit | Valid HMAC passes; invalid 401 |

---

## 12. Security Checklist

- [ ] TLS 1.3 minimum; TLS 1.2 and below disabled
- [ ] Hybrid ML-KEM-768 + X25519 KEM configured via CIRCL
- [ ] Authorization header and X-ZK-Token never logged or included in OTel spans
- [ ] IP addresses not stored; rate limit keys use nullifier hash for participants
- [ ] All downstream calls use mTLS (service-to-service)
- [ ] Error responses are generic (no stack traces in production)
- [ ] gRPC timeouts set on all downstream calls (default: 10s for ZK, 30s for analytics)
- [ ] Redis connection uses TLS + AUTH
- [ ] Service HMAC uses constant-time comparison to prevent timing attacks
- [ ] Graceful shutdown drains in-flight requests before exit
