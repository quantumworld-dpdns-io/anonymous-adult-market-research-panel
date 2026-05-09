package config

import (
	"github.com/redis/go-redis/v9"
	"github.com/spf13/viper"
)

type Config struct {
	ListenAddr string
	CertFile   string
	KeyFile    string

	ZKProvingAddr string
	AnalyticsAddr string
	QuantumAddr   string

	SupabaseJWTSecret  string
	ZKTokenSecret      string
	ServiceHMACSecret  string
	SupabaseURL        string
	SupabaseServiceKey string

	AllowedOrigins []string
	OTelEndpoint   string

	Redis *redis.Client
}

func Load() *Config {
	viper.AutomaticEnv()
	viper.SetDefault("LISTEN_ADDR", ":8080")
	viper.SetDefault("ZK_PROVING_ADDR", "zk-proving:50051")
	viper.SetDefault("ANALYTICS_ADDR", "http://analytics:8001")
	viper.SetDefault("QUANTUM_ADDR", "http://quantum:8002")
	viper.SetDefault("REDIS_ADDR", "redis:6379")
	viper.SetDefault("ALLOWED_ORIGINS", []string{"https://panel.example.com"})

	redisClient := redis.NewClient(&redis.Options{
		Addr:     viper.GetString("REDIS_ADDR"),
		Password: viper.GetString("REDIS_PASSWORD"),
		DB:       0,
	})

	return &Config{
		ListenAddr:         viper.GetString("LISTEN_ADDR"),
		CertFile:           viper.GetString("TLS_CERT_FILE"),
		KeyFile:            viper.GetString("TLS_KEY_FILE"),
		ZKProvingAddr:      viper.GetString("ZK_PROVING_ADDR"),
		AnalyticsAddr:      viper.GetString("ANALYTICS_ADDR"),
		QuantumAddr:        viper.GetString("QUANTUM_ADDR"),
		SupabaseJWTSecret:  viper.GetString("SUPABASE_JWT_SECRET"),
		ZKTokenSecret:      viper.GetString("ZK_TOKEN_SECRET"),
		ServiceHMACSecret:  viper.GetString("SERVICE_HMAC_SECRET"),
		SupabaseURL:        viper.GetString("SUPABASE_URL"),
		SupabaseServiceKey: viper.GetString("SUPABASE_SERVICE_ROLE_KEY"),
		AllowedOrigins:     viper.GetStringSlice("ALLOWED_ORIGINS"),
		OTelEndpoint:       viper.GetString("OTEL_EXPORTER_OTLP_ENDPOINT"),
		Redis:              redisClient,
	}
}
