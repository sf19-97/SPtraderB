.PHONY: help build run test clean docker-up docker-down

help:
	@echo "Available commands:"
	@echo "  make build       - Build the project"
	@echo "  make run         - Run the service"
	@echo "  make test        - Run tests"
	@echo "  make clean       - Clean build artifacts"
	@echo "  make docker-up   - Start Pulsar in Docker"
	@echo "  make docker-down - Stop Pulsar in Docker"

build:
	cargo build

release:
	cargo build --release

run:
	cargo run

test:
	cargo test

clean:
	cargo clean

docker-up:
	docker-compose up -d
	@echo "Pulsar is starting..."
	@echo "Admin UI will be available at http://localhost:8080"
	@echo "Pulsar Manager at http://localhost:9527"

docker-down:
	docker-compose down

logs:
	docker-compose logs -f

# Development helpers
dev: docker-up
	RUST_LOG=oanda_ingester=debug cargo run

check:
	cargo check
	cargo clippy
	cargo fmt -- --check