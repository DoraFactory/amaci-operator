declare global {
  namespace NodeJS {
    type ProcessEnv = {
      COORDINATOR_PRI_KEY: string

      RPC_ENDPOINT: string
      IND_ENDPOINT: string
      DEACTIVATE_RECORDER: string
      DEACTIVATE_INTERVAL: string
      CODE_IDS: string[]
      PROVER_CONCURRENCY: string
      PROVER_SAVE_CHUNK: string

      WORK_PATH: string
      LOG_LEVEL: string
      MNEMONIC: string
      PRIVATE: string
      METRICS_PORT: string
    }
  }
}

export {}
