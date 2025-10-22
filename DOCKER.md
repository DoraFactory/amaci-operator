# Docker Deployment Guide for MACI Operator

This guide explains how to deploy and run the MACI operator using Docker.

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- At least 4GB RAM available for the container

## Quick Start

### 1. Install from npm

```bash
npm install -g @dorafactory/maci-operator
```

### 2. Initialize Configuration

```bash
# Create a working directory
mkdir my-operator && cd my-operator

# Initialize operator (will create config.toml and download zkeys)
maci init .
```

### 3. Configure the Operator

Edit `config.toml` and fill in the required fields:

```toml
rpcEndpoint = "https://vota-rpc.dorafactory.org"
indexerEndpoint = "https://vota-indexer.dorafactory.org/v1/graphql"
registryContract = "dora1..."
identity = "your-operator-identity"
mnemonic = "your wallet mnemonic..."
coordinatorPrivKey = "your-maci-private-key..."
```

### 4. Set Up Operator Identity (First Time Only)

```bash
# Set operator identity on-chain
maci set-operator identity .

# Set operator MACI public key on-chain
maci set-operator maciPubKey .
```

### 5. Deploy with Docker Compose

```bash
# Download the docker-compose.yml from the npm package
curl -o docker-compose.yml https://raw.githubusercontent.com/DoraFactory/amaci-operator/main/docker-compose.yml

# Start the operator
docker-compose up -d

# Check logs
docker-compose logs -f
```

## Alternative: Build from Source

If you prefer to build the Docker image yourself:

```bash
# Clone the repository
git clone https://github.com/DoraFactory/amaci-operator.git
cd amaci-operator

# Build the Docker image
npm run docker:build

# Start with docker-compose
npm run docker:run

# View logs
npm run docker:logs
```

## Docker Commands

### Using npm scripts (if in source directory):

```bash
npm run docker:build     # Build Docker image
npm run docker:run       # Start operator in background
npm run docker:stop      # Stop operator
npm run docker:logs      # View logs
npm run docker:restart   # Restart operator
```

### Using docker-compose directly:

```bash
docker-compose up -d              # Start in background
docker-compose down               # Stop and remove containers
docker-compose logs -f            # Follow logs
docker-compose restart            # Restart
docker-compose ps                 # View status
```

### Using Docker directly:

```bash
# Build image
docker build -t maci-operator .

# Run container
docker run -d \
  --name maci-operator \
  -v $(pwd)/config.toml:/app/config.toml:ro \
  -v $(pwd)/data:/data \
  -p 3001:3001 \
  maci-operator

# View logs
docker logs -f maci-operator

# Stop container
docker stop maci-operator

# Remove container
docker rm maci-operator
```

## How It Works

The Docker container mounts your entire workspace directory (`.:/workspace`), which means:

✅ **All paths in `config.toml` work as-is** - No need to adjust paths for Docker
✅ **Flexible zkey location** - Use any `zkeyPath` in your config.toml
✅ **Single source of truth** - All configuration lives in config.toml
✅ **Easy debugging** - Files are accessible both inside and outside the container

## Directory Structure

```
my-operator/
├── config.toml           # Configuration file (all settings here)
├── docker-compose.yml    # Docker Compose configuration
├── .env                  # Optional: override image version
├── cache/                # Proof and input cache
├── data/                 # Daily rotated logs
├── round/                # Per-round logs
└── zkey/                 # Circuit files (or custom path from config.toml)
    ├── 2-1-1-5_v3/
    └── 4-2-2-25_v3/
```

## Volume Mounts

The Docker container mounts your workspace:

- `.:/workspace` - Your entire operator directory is mounted
- Container reads `config.toml` from `/workspace/config.toml`
- All relative paths in config.toml work correctly

## Configuration

All configuration is managed in `config.toml`. The Docker container reads this file directly, so you don't need to set environment variables.

### Custom Image Version

Create a `.env` file to specify which image version to use:

```bash
# .env
MACI_VERSION=beta          # Use beta tag
# MACI_VERSION=latest      # Use latest stable
# MACI_VERSION=1.4.0       # Use specific version
METRICS_PORT=3001          # Should match config.toml
```

### Example config.toml with Custom Paths

```toml
workPath = "/workspace"
zkeyPath = "/workspace/my-custom-zkeys"  # Any relative path works
rpcEndpoint = "https://vota-rpc.dorafactory.org"
# ... other settings
```

## Monitoring

### Metrics Endpoint

The operator exposes Prometheus metrics at `http://localhost:3001/metrics`

### Health Check

```bash
# Check container health
docker-compose ps

# Manual health check
curl http://localhost:3001/metrics
```

### Logs

```bash
# Follow all logs
docker-compose logs -f

# View last 100 lines
docker-compose logs --tail=100

# View logs for specific time range
docker-compose logs --since 1h
```

## Resource Management

The default `docker-compose.yml` sets resource limits:

- **Limits**: 4 CPUs, 8GB RAM
- **Reservations**: 2 CPUs, 4GB RAM

Adjust these in `docker-compose.yml` based on your needs:

```yaml
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 8G
    reservations:
      cpus: '2'
      memory: 4G
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs

# Check container status
docker-compose ps

# Verify config file
cat config.toml
```

### Out of memory errors

Increase memory limits in `docker-compose.yml` or reduce `PROVER_CONCURRENCY` in `config.toml`.

### Missing zkey files

```bash
# Download zkeys using the CLI
maci zkey download . --force

# Verify zkeys are present
ls -la data/zkey/
```

### Permission issues

```bash
# Fix data directory permissions
sudo chown -R $(id -u):$(id -g) data/
```

## Updating the Operator

```bash
# Pull latest image (if using Docker Hub)
docker-compose pull

# Or rebuild from source
npm run docker:build

# Restart with new image
docker-compose down
docker-compose up -d
```

## Production Recommendations

1. **Use Docker secrets** for sensitive data (mnemonic, private keys)
2. **Set up log rotation** to prevent disk space issues
3. **Monitor resource usage** (CPU, memory, disk)
4. **Configure restart policy** (already set to `unless-stopped`)
5. **Set up Prometheus** to scrape metrics endpoint
6. **Use a reverse proxy** (nginx, traefik) for metrics endpoint
7. **Regular backups** of `data/cache` directory

## Support

- GitHub Issues: https://github.com/DoraFactory/amaci-operator/issues
- Documentation: https://github.com/DoraFactory/amaci-operator#readme
