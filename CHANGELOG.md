# Changelog

All notable changes to this project will be documented in this file.

## [v2.2.0] - 2026-03-25

### Added

- **Benchmark Tooling**
  - Added `benchmark:calculate` to generate benchmark cost reports from benchmark inputs and pricing config.
  - Added `benchmark:proof-batches` to analyze proof batch timing from benchmark logs.
  - Added benchmark reference materials for bare-metal cost, latency, and gas estimation.

- **Code-Level Utilities**
  - Added transaction-level locking via `withTxLock()` to serialize in-flight transactions per key/address and reduce submission races.
  - Added proof-batch log parsers and report generators for MSG, TALLY, and DEACTIVATE benchmark phases.
  - Added benchmark report generation based on machine pricing config and live/cached DORA price data.

- **Deployment Documentation**
  - Added a dedicated `DOCKER.md` guide covering npm install, Docker Compose deployment, image version selection, workspace mounts, and metrics access.
  - Expanded container usage examples for both package-based deployment and local source builds.

### Changed

- **Cost Modeling Documentation**
  - Documented simplified execution-time, gas-cost, and server-cost formulas for supported circuit configurations.
  - Added clearer benchmark summaries for P50/P90 runtime and cost assumptions.

- **Proof Cache and Input Signatures**
  - Updated proof-cache handling with versioned cache records and atomic writes.
  - Extended cached input signatures to include `pollId`, processed deactivate-message count, and circuit metadata used for deterministic cache reuse.
  - Preserved cached proof arrays by selecting the longer valid proof set during merges.

- **Operator Runtime**
  - Kept operator input generation aligned with poll-aware flows in message, tally, and deactivate processing.
  - Updated package delivery and scripts around the `v2.2.0` release.

### Fixed

- **Keypair Derivation**
  - Fixed BabyJub private-key formatting to match the SDK/@zk-kit-compatible clamp and subgroup reduction flow.
  - Resolved coordinator keypair derivation mismatches that could cause the operator to derive a different public key from the configured `coordinatorPrivKey`.

## [v2.1.0] - 2026-03-10

### Added

- **v4 Circuit Support**
  - Added support for `2-1-1-5_v4`, `4-2-2-25_v4`, `6-3-3-125_v4`, and `9-4-3-125_v4`.
  - Extended default CLI/init zkey handling to include the new v4 circuit packs.

- **Poll-Aware Input Generation**
  - Added `pollId` support across MACI input generation, message validation, tallying, and deactivate flows.
  - Added compatibility handling for contracts that expose `get_poll_id`.

- **Configurable Witness Generation**
  - Added a separate `witnessCalc` configuration section.
  - Added support for `snarkjs` and `witnesscalc` witness backends.

### Changed

- **Proof Generation Workflow**
  - Updated proving flow to support `.bin`-based witness generation for v4 circuits.
  - Improved proof normalization and backend logging for `snarkjs` and `rapidsnark`.

- **Tally Robustness**
  - Added indexer sync checks before generating tally inputs.
  - Added stricter period transitions and processed-message checks before moving from processing to tallying.
  - Improved finalize handling to avoid false completion states and to record final transaction hashes.

- **High-Scale Round Handling**
  - Extended large-circuit handling to cover both `6-3-3-125` and `9-4-3-125`.
  - Improved message-store usage and proof cache tracking for large rounds.

## [v1.3.0] - 2025-05-01

### Added

- **Auto Claim Mechanism**

  - Combined `stopTally` and `claim` into a single `vota` transaction to ensure atomic reward claiming after tallying.
  - Prevents reward claim failures due to time gaps between separate transactions.

- **Metrics & Monitoring**
  - Integrated Prometheus client with Express service for real-time metrics tracking.
  - Monitors:
    - Round lifecycle (start, tally, stop)
    - Task status (active/deactivated)
    - Operator online/offline status
  - Grafana dashboard and alert rules added for observability and future failure detection.

### Changed

- **Logger System Refactored**
  - Migrated to the Winston logging framework.
  - Log files now categorized by `roundId` to simplify debugging and traceability for operators.

---
