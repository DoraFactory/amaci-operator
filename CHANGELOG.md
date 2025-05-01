# Changelog

All notable changes to this project will be documented in this file.

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