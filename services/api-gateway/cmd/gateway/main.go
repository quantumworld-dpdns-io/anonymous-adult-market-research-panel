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

	"github.com/quantumworld/panel/api-gateway/internal/auth"
	"github.com/quantumworld/panel/api-gateway/internal/clients"
	"github.com/quantumworld/panel/api-gateway/internal/config"
	"github.com/quantumworld/panel/api-gateway/internal/handlers"
	"github.com/quantumworld/panel/api-gateway/internal/middleware"
	tlsconfig "github.com/quantumworld/panel/api-gateway/internal/tls"
)

func main() {
	cfg := config.Load()

	log, err := zap.NewProduction()
	if err != nil {
		panic(err)
	}
	defer log.Sync()

	zkClient := clients.NewZKProvingClient(cfg.ZKProvingAddr)
	analyticsClient := clients.NewAnalyticsClient(cfg.AnalyticsAddr).WithHMACSecret(cfg.ServiceHMACSecret)
	quantumClient := clients.NewQuantumClient(cfg.QuantumAddr)
	supabaseClient := clients.NewSupabaseClient(cfg.SupabaseURL, cfg.SupabaseServiceKey)

	supabaseVerifier := auth.NewSupabaseJWTVerifier(cfg.SupabaseJWTSecret)
	zkVerifier := auth.NewZKTokenVerifier(cfg.ZKTokenSecret)

	r := chi.NewRouter()

	// Global middleware stack
	r.Use(middleware.Recover(log))
	r.Use(middleware.RequestID())
	r.Use(middleware.Logger(log))
	r.Use(middleware.Telemetry())
	r.Use(middleware.CORS(cfg.AllowedOrigins))

	// Health check (unauthenticated)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Public routes — participant ZK flow, 20 req/min
	r.Group(func(r chi.Router) {
		r.Use(middleware.RateLimit(cfg.Redis, "public", 20, time.Minute))
		r.Post("/zk/verify-age", handlers.VerifyAge(zkClient))
		r.Post("/zk/issue-credential", handlers.IssueCredential(zkClient))
		r.Get("/zk/date-attestation", handlers.DateAttestation(zkClient))
		r.Get("/studies", handlers.ListPublicStudies(analyticsClient))
		r.Get("/studies/{studyId}/questions", handlers.GetStudyQuestions(supabaseClient))
	})

	// Participant routes — ZK session token required, 5 req/min
	r.Group(func(r chi.Router) {
		r.Use(middleware.RateLimit(cfg.Redis, "participant", 5, time.Minute))
		r.Use(middleware.AuthenticateZKToken(zkVerifier))
		r.Post("/responses", handlers.SubmitResponse(supabaseClient))
	})

	// Researcher routes — Supabase JWT required, 60 req/min
	r.Group(func(r chi.Router) {
		r.Use(middleware.RateLimit(cfg.Redis, "researcher", 60, time.Minute))
		r.Use(middleware.AuthenticateResearcher(supabaseVerifier))
		r.Post("/studies", handlers.CreateStudy(supabaseClient))
		r.Get("/studies/{studyId}", handlers.GetStudy(supabaseClient))
		r.Put("/studies/{studyId}", handlers.UpdateStudy(supabaseClient))
		r.Get("/analytics/{studyId}/results", handlers.GetResults(analyticsClient))
		r.Post("/quantum/sample", handlers.QuantumSample(quantumClient))
	})

	// Internal service-to-service routes — HMAC required
	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthenticateServiceHMAC(cfg.ServiceHMACSecret))
		r.Get("/internal/analytics/{studyId}/results", handlers.InternalResults(analyticsClient))
	})

	var tlsCfg = tlsconfig.NewHybridTLSConfig(cfg.CertFile, cfg.KeyFile)
	server := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      r,
		TLSConfig:    tlsCfg,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Info("API Gateway starting", zap.String("addr", cfg.ListenAddr))
		if err := server.ListenAndServeTLS("", ""); err != http.ErrServerClosed {
			log.Fatal("server error", zap.Error(err))
		}
	}()

	<-ctx.Done()
	log.Info("Shutting down gracefully")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Error("shutdown error", zap.Error(err))
	}
}
