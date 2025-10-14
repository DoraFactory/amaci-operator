# aMACI operator

The aMACI operator service is a unique feature offered by the Dora Factory Anonymous MACI protocol (aMACI). Running an aMACI operator means that you will run and tally an aMACI round for a community, and validate the round with zero-knowledge proofs.
From the protocol's [frontend](https://vota.dorafactory.org/), users will be able to create aMACI rounds and select an aMACI operator.

## Installation

```bash
npm install -g @dorafactory/maci-operator
```

## Quick Start

### Option 1: Run with Node.js (Traditional)

```bash
# 1. Initialize operator workspace
maci init ./my-operator

# 2. Configure the operator
cd my-operator
vim config.toml  # Edit configuration file

# 3. Set operator identity (first time only)
maci set-operator identity .
maci set-operator maciPubKey .

# 4. Start the operator
maci start .
```

### Option 2: Run with Docker (Recommended)

```bash
# 1. Initialize operator workspace
maci init ./my-operator

# 2. Configure the operator
cd my-operator
vim config.toml  # Edit configuration file

# 3. Set operator identity (first time only)
maci set-operator identity .
maci set-operator maciPubKey .

# 4. Start with Docker Compose
docker-compose up -d

# 5. View logs
docker-compose logs -f
```

For detailed Docker deployment instructions, see [DOCKER.md](./DOCKER.md).

## Available Commands

```bash
maci init <dir>                    # Initialize operator workspace
maci start <dir>                   # Start the operator
maci set-operator identity <dir>   # Set operator identity on-chain
maci set-operator maciPubKey <dir> # Set operator MACI public key on-chain
maci zkey download <dir>           # Download circuit files
maci --help                        # Show help
```

## Configuration

After running `maci init`, edit `config.toml` to configure:

- `rpcEndpoint` - Chain RPC endpoint
- `indexerEndpoint` - GraphQL indexer endpoint
- `registryContract` - Registry contract address
- `identity` - Your operator identity
- `mnemonic` - Operator wallet mnemonic
- `coordinatorPrivKey` - MACI coordinator private key
- `zkeyPath` - Path to circuit files
- Other prover and logging settings

## Documentation

For the most up to date documentation, please visit [how to run aMACI operator service](https://docs.dorafactory.org/docs/vota-devops/amaci)

## Explanation

- aMACI operator(support `2-1-1-5` and `4-2-2-25` circuit power): `main` branch
- MACI operator(support `9-4-3-625` circuit power): `maci-operator` branch (attention: `1p1v` and `qv` circuit type are seperated)
- MACI operator(support `6-3-3-125` circuit power): `maci-operator-6-3-3-125`
- MACI operator(support `2-1-1-5` and `4-2-2-25` circuit power): `maci-operator-minipower`
