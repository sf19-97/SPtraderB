# Dockerfile for SPtraderB API

# Build stage - use bookworm variant to match runtime GLIBC
FROM rust:bookworm as builder

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests
COPY Cargo.toml Cargo.lock ./

# Copy source
COPY src ./src

# Build release binary
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies including Python
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip3 install --no-cache-dir pandas numpy --break-system-packages

# Copy binary from builder
COPY --from=builder /app/target/release/sptraderb-api /app/sptraderb-api

# Copy workspace directory (Python components)
COPY workspace /app/workspace

# Expose port
EXPOSE 3001

# Set environment variables
ENV PORT=3001
ENV RUST_LOG=info

# Run the binary
CMD ["/app/sptraderb-api"]
