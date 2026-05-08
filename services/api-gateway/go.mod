module github.com/quantumworld/panel/api-gateway

go 1.23

require (
	github.com/go-chi/chi/v5 v5.1.0
	github.com/cloudflare/circl v1.3.9
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/go-redis/redis/v8 v8.11.5
	github.com/ulule/limiter/v3 v3.11.2
	github.com/spf13/viper v1.19.0
	go.uber.org/zap v1.27.0
	google.golang.org/grpc v1.64.0
	google.golang.org/protobuf v1.34.1
	go.opentelemetry.io/otel v1.27.0
	go.opentelemetry.io/otel/trace v1.27.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.27.0
	go.opentelemetry.io/otel/sdk v1.27.0
	github.com/google/uuid v1.6.0
)
