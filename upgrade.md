# aMACI Operator v2.2.0 Upgrade Guide

This guide is for operators upgrading an existing aMACI operator deployment to `v2.2.0`.

It covers:

1. Install `rapidsnark`
2. Install `@dorafactory/maci-operator@2.2.0`
3. Upgrade `config.toml` with minimal manual editing
4. Download the latest zkey bundles, including the new v4 bundles
5. Restart the operator service

## Assumptions

- Existing operator workspace already exists, for example `/home/ubuntu/my-operator`
- Existing config file already exists at `/home/ubuntu/my-operator/config.toml`

Set your workspace path first:

```bash
export WORK_DIR=/home/ubuntu/my-operator
export CONFIG_FILE=$WORK_DIR/config.toml
```

Check prerequisites:

```bash
node -v
npm -v
test -f "$CONFIG_FILE" && echo "config.toml found" || echo "config.toml missing"
```

## 1. Install rapidsnark

Check server architecture first:

```bash
uname -m
```

- `x86_64`: use `make host`
- `aarch64` or `arm64`: use `make arm64`

Install dependencies:

```bash
sudo apt-get update
sudo apt-get install -y build-essential cmake libgmp-dev libsodium-dev nasm curl m4 git
```

Clone and build:

```bash
cd ~
git clone https://github.com/iden3/rapidsnark.git
cd ~/rapidsnark

git submodule update --init --recursive
```

For `x86_64`:

```bash
./build_gmp.sh host
make host
```

For `aarch64` / `arm64`:

```bash
./build_gmp.sh aarch64
make host_arm64
```

Install the binary into `/usr/local/bin`:

```bash
sudo cp package/bin/prover /usr/local/bin/rapidsnark
sudo chmod +x /usr/local/bin/rapidsnark
```

Verify:

```bash
rapidsnark --help
which rapidsnark
```

Set the binary path that will be written into `config.toml`:

```bash
export RAPIDSNARK_PATH=$(which rapidsnark)
echo "$RAPIDSNARK_PATH"
```

Official reference:

- https://github.com/iden3/rapidsnark

## 2. Install aMACI Operator v2.2.0

Upgrade the CLI:

```bash
npm install -g @dorafactory/maci-operator@2.2.0
```

Verify:

```bash
maci --version
```

Expected output:

```bash
maci-operator v2.2.0
```

## 3. Upgrade config.toml

`v2.2.0` introduces these config changes:

- New `[witnessCalc]` section
- New `prover.backend`
- New `prover.rapidsnarkPath`
- New `9-4-3-125` entry under `[prover.concurrencyByCircuit]`
- `zkeyPath` now needs to contain both v3 and v4 bundles
- `indexerEndpoint` should be updated to `https://maci-graphql.dorafactory.org/`

The following script:

- Backs up the old config
- Preserves existing values such as `rpcEndpoint`, `registryContract`, `identity`, `mnemonic`, `coordinatorPrivKey`, `metricsPort`, `zkeyPath`
- Rewrites the config into the `v2.2.0` format
- Sets the prover backend to `rapidsnark`
- Replaces the old `indexerEndpoint` with `https://maci-graphql.dorafactory.org/`

This is a config migration script for existing operators. It upgrades an old `config.toml` to the `v2.2.0` format while keeping the operator's current RPC, registry, identity, mnemonic, MACI private key, and zkey path settings. The `indexerEndpoint` is intentionally updated to the new production GraphQL endpoint: `https://maci-graphql.dorafactory.org/`.

The old config is not deleted. It is first copied to a timestamped backup file such as `config.toml.bak.2026-03-25-143000`, and then the original `config.toml` is rewritten in the new `v2.2.0` format.

Run this migration script with `bash` rather than pasting it directly into an interactive `zsh` session:

```bash
export WORK_DIR=<YOUR_AMACI_OPERATOR_WORK_DIR>
export CONFIG_FILE=$WORK_DIR/config.toml
export RAPIDSNARK_PATH=$(which rapidsnark)

bash <<'BASH'
set -euo pipefail

cp "$CONFIG_FILE" "$CONFIG_FILE.bak.$(date +%F-%H%M%S)"

get_value() {
  key="$1"
  grep -E "^[[:space:]]*$key[[:space:]]*=" "$CONFIG_FILE" | tail -n 1 | sed 's/^[^=]*=[[:space:]]*//'
}

WORK_PATH=$(get_value workPath)
RPC_ENDPOINT=$(get_value rpcEndpoint)
REGISTRY_CONTRACT=$(get_value registryContract)
IDENTITY=$(get_value identity)
CODE_IDS=$(get_value codeIds)
MNEMONIC=$(get_value mnemonic)
COORDINATOR_PRIV_KEY=$(get_value coordinatorPrivKey)
DEACTIVATE_INTERVAL=$(get_value deactivateInterval)
LOG_LEVEL=$(get_value logLevel)
METRICS_PORT=$(get_value metricsPort)
ZKEY_PATH=$(get_value zkeyPath)
PIPELINE=$(get_value pipeline)
CONCURRENCY=$(get_value concurrency)
SAVE_CHUNK=$(get_value saveChunk)
SUBMIT_MSG=$(grep -E '^[[:space:]]*msg[[:space:]]*=' "$CONFIG_FILE" | tail -n 1 | sed 's/^[^=]*=[[:space:]]*//')
SUBMIT_TALLY=$(grep -E '^[[:space:]]*tally[[:space:]]*=' "$CONFIG_FILE" | tail -n 1 | sed 's/^[^=]*=[[:space:]]*//')
SUBMIT_DEACTIVATE=$(grep -E '^[[:space:]]*deactivate[[:space:]]*=' "$CONFIG_FILE" | tail -n 1 | sed 's/^[^=]*=[[:space:]]*//')
CC_2115=$(grep -E '^[[:space:]]*"2-1-1-5"[[:space:]]*=' "$CONFIG_FILE" | tail -n 1 | sed 's/^[^=]*=[[:space:]]*//')
CC_42225=$(grep -E '^[[:space:]]*"4-2-2-25"[[:space:]]*=' "$CONFIG_FILE" | tail -n 1 | sed 's/^[^=]*=[[:space:]]*//')
CC_633125=$(grep -E '^[[:space:]]*"6-3-3-125"[[:space:]]*=' "$CONFIG_FILE" | tail -n 1 | sed 's/^[^=]*=[[:space:]]*//')

[ -n "$WORK_PATH" ] || WORK_PATH="\"$WORK_DIR\""
[ -n "$RPC_ENDPOINT" ] || RPC_ENDPOINT="\"https://vota-rpc.dorafactory.org\""
INDEXER_ENDPOINT="\"https://maci-graphql.dorafactory.org/\""
[ -n "$REGISTRY_CONTRACT" ] || REGISTRY_CONTRACT="\"\""
[ -n "$IDENTITY" ] || IDENTITY="\"\""
[ -n "$CODE_IDS" ] || CODE_IDS='[""]'
[ -n "$MNEMONIC" ] || MNEMONIC="\"\""
[ -n "$COORDINATOR_PRIV_KEY" ] || COORDINATOR_PRIV_KEY="\"\""
[ -n "$DEACTIVATE_INTERVAL" ] || DEACTIVATE_INTERVAL=60000
[ -n "$LOG_LEVEL" ] || LOG_LEVEL='"info"'
[ -n "$METRICS_PORT" ] || METRICS_PORT=3001
[ -n "$ZKEY_PATH" ] || ZKEY_PATH='"/home/ubuntu/zkey"'
[ -n "$PIPELINE" ] || PIPELINE=1
[ -n "$CONCURRENCY" ] || CONCURRENCY=2
[ -n "$SAVE_CHUNK" ] || SAVE_CHUNK=0
[ -n "$SUBMIT_MSG" ] || SUBMIT_MSG=0
[ -n "$SUBMIT_TALLY" ] || SUBMIT_TALLY=0
[ -n "$SUBMIT_DEACTIVATE" ] || SUBMIT_DEACTIVATE=0
[ -n "$CC_2115" ] || CC_2115=3
[ -n "$CC_42225" ] || CC_42225=2
[ -n "$CC_633125" ] || CC_633125=1
[ -n "${RAPIDSNARK_PATH:-}" ] || RAPIDSNARK_PATH=/usr/local/bin/rapidsnark

cat > "$CONFIG_FILE" <<EOF
# aMACI operator configuration (config.toml)
# Fill RPC/Indexer endpoints and identity. Both coordinatorPrivKey (MACI key) and mnemonic (operator wallet) must be set.

# Working directory for data, logs and caches
workPath = $WORK_PATH

# RPC endpoint of chain (e.g., https://rpc.node:26657)
rpcEndpoint = $RPC_ENDPOINT
# Indexer endpoint (GraphQL)
indexerEndpoint = $INDEXER_ENDPOINT
# Deactivate recorder contract address(registryContract)
registryContract = $REGISTRY_CONTRACT

# Operator identity (set on registry via: amaci set-operator identity <workDir>)
identity = $IDENTITY

# Blacklist of round code IDs to exclude (array of strings)
codeIds = $CODE_IDS

# aMACI operator account mnemonic on vota chain.
# Please pay special attention that this operator must be used independently for the operator.
# Otherwise it will cause sequence conflicts. It is also necessary to monitor the account balance to ensure the operator can pay the on-chain fees.
# It is recommended to set an alert if it falls below 500 DORA and replenish funds in a timely manner.
mnemonic = $MNEMONIC
# operator MACI PrivKey(generated locally when set MACI key, do not share it)
coordinatorPrivKey = $COORDINATOR_PRIV_KEY

# Interval between deactivate tasks (ms)
deactivateInterval = $DEACTIVATE_INTERVAL
# Log level: error | warn | info | debug
logLevel = $LOG_LEVEL
# Metrics server port(default: 3001)
metricsPort = $METRICS_PORT

# Path to zkey folder containing circuit packs (2-1-1-5_v3/v4, 4-2-2-25_v3/v4, 6-3-3-125_v3/v4, 9-4-3-125_v4)
zkeyPath = $ZKEY_PATH

[witnessCalc]
# witness backend: snarkjs | witnesscalc
backend = "snarkjs"
# Path to witnesscalc binary (if not in PATH)
witnesscalcPath = ""

# Prover configuration
[prover]
# Prover backend: snarkjs | rapidsnark
backend = "rapidsnark"
# Path to rapidsnark binary (if not in PATH)
rapidsnarkPath = "$RAPIDSNARK_PATH"
# Enable pipeline submission (1 to enable)
pipeline = $PIPELINE
# Number of concurrent prover workers
concurrency = $CONCURRENCY
# Persist proofs/inputs in chunks (0 = use the number of concurrency)
saveChunk = $SAVE_CHUNK

# Submission batch sizes (0 = use saveChunk if > 0, otherwise concurrency)
[prover.submitBatch]
msg = $SUBMIT_MSG
tally = $SUBMIT_TALLY
deactivate = $SUBMIT_DEACTIVATE

[prover.concurrencyByCircuit]
"2-1-1-5" = $CC_2115
"4-2-2-25" = $CC_42225
"6-3-3-125" = $CC_633125
"9-4-3-125" = 1
EOF
BASH
```

Review the new config:

```bash
sed -n '1,240p' "$CONFIG_FILE"
```


## 4. Download the latest zkey bundles

`v2.2.0` requires the latest zkey layout. Old operators usually only have v3 bundles, but `v4` bundles are also required now.

Run:

```bash
maci zkey download "$WORK_DIR" --force
```

If you want to specify the zkey directory explicitly:

```bash
maci zkey download "$WORK_DIR" --zkey /home/ubuntu/zkey --force
```

This downloads all supported bundles:

- `2-1-1-5_v3`
- `4-2-2-25_v3`
- `6-3-3-125_v3`
- `2-1-1-5_v4`
- `4-2-2-25_v4`
- `6-3-3-125_v4`
- `9-4-3-125_v4`

Check the result:

```bash
find "$(grep '^zkeyPath' "$CONFIG_FILE" | sed 's/^[^=]*=[[:space:]]*//; s/^"//; s/"$//')" -maxdepth 1 -mindepth 1 -type d | sort
```

## 5. Restart the service

### Option A: systemd

If your operator runs as a systemd service:

```bash
sudo systemctl restart amaci
sudo systemctl status amaci --no-pager
sudo journalctl -u amaci -f
```

## Post-upgrade verification

Run these checks after restart:

```bash
maci --version
rapidsnark --help >/dev/null && echo "rapidsnark ok"
curl -s http://127.0.0.1:3001/metrics | head
```

Expected checks:

- `maci --version` shows `v2.2.0`
- `rapidsnark` is available in `PATH`
- zkey directory contains v4 bundles
- operator process starts without missing-config or missing-zkey errors

## Notes

- Keep the backup config file created in step 3 until the new version is stable.
- The config rewrite step preserves the existing mnemonic and MACI private key.
- `zkeyPath` should point to a directory that contains both old v3 bundles and new v4 bundles.
- For Docker users, the compose file expects `VERSION`, not `MACI_VERSION`.
