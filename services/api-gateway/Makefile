.PHONY: proto build test lint docker run

PROTO_DIR := proto/zkproving/v1
GO_OUT    := proto/zkproving/v1

proto:
	protoc \
		--go_out=$(GO_OUT) --go_opt=paths=source_relative \
		--go-grpc_out=$(GO_OUT) --go-grpc_opt=paths=source_relative \
		$(PROTO_DIR)/service.proto

build:
	go build -ldflags="-s -w" -o bin/gateway ./cmd/gateway

test:
	go test ./... -v -race -count=1

lint:
	golangci-lint run ./...

docker:
	docker build -t panel/api-gateway:latest .

run:
	go run ./cmd/gateway

tidy:
	go mod tidy
