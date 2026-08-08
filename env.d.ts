declare global {
  namespace NodeJS {
    type ProcessEnv = {
      COORDINATOR_PRI_KEY: string

      RPC_ENDPOINT: string
      INDEXER_ENDPOINTS: string
      IND_ENDPOINT?: string
      INDEXER_REQUEST_TIMEOUT_MS?: string
      INDEXER_FAILOVER_COOLDOWN_MS?: string
      INDEXER_HEIGHT_CHECK_ENABLED?: string
      INDEXER_HEIGHT_CHECK_INTERVAL_MS?: string
      INDEXER_HEIGHT_LAG_THRESHOLD?: string
      DEACTIVATE_RECORDER: string
      DEACTIVATE_INTERVAL: string
      CODE_IDS: string
      PROVER_CONCURRENCY: string
      PROVER_CONCURRENCY_BY_CIRCUIT?: string
      PROVER_BACKEND?: string
      WITNESS_BACKEND?: string
      RAPIDSNARK_PATH?: string
      WITNESSCALC_PATH?: string
      PROVER_SAVE_CHUNK: string
      SUBMIT_BATCH_MSG: string
      SUBMIT_BATCH_TALLY: string
      SUBMIT_BATCH_DEACTIVATE: string
      PROVER_PIPELINE: string

      WORK_PATH: string
      LOG_LEVEL: string
      MNEMONIC: string
      PRIVATE: string
      METRICS_PORT: string
      ZKEY_PATH: string
      AMACI_CLI?: string
    }
  }
}

export {}
