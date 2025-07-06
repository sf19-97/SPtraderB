.PHONY: help build run pulsar-up pulsar-down clean

help:
	@echo "Kraken Ingester - Real-time crypto data to Pulsar"
	@echo ""
	@echo "Commands:"
	@echo "  make pulsar-up   - Start Pulsar in Docker"
	@echo "  make pulsar-down - Stop Pulsar"
	@echo "  make build       - Build the ingester"
	@echo "  make run         - Run the ingester (Pulsar must be running)"
	@echo "  make demo        - Run without Pulsar (console output only)"
	@echo "  make all         - Start Pulsar and run ingester"

pulsar-up:
	@echo "Starting Apache Pulsar..."
	docker-compose up -d
	@echo "Waiting for Pulsar to be ready..."
	@sleep 10
	@echo "Pulsar is running at localhost:6650"
	@echo "Admin UI: http://localhost:8080"

pulsar-down:
	@echo "Stopping Pulsar..."
	docker-compose down

build:
	cargo build --release

run: build
	RUST_LOG=kraken_ingester=info cargo run --release

demo:
	@echo "Running in demo mode (no Pulsar)..."
	RUST_LOG=kraken_ingester=debug cargo run

all: pulsar-up
	@sleep 5
	make run

clean:
	cargo clean
	docker-compose down -v

# Check if Pulsar is running
check-pulsar:
	@curl -s http://localhost:8080/admin/v2/brokers/standalone || echo "Pulsar is not running"

# List topics
list-topics:
	@curl -s http://localhost:8080/admin/v2/persistent/public/default | jq