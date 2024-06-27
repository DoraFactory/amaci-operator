declare global {
  namespace NodeJS {
    type ProcessEnv = {
      // MONGODB_URI: string
      COORDINATOR_PRI_KEY: string

      RPC_ENDPOINT: string
      IND_ENDPOINT: string
      DEACTIVATE_RECORDER: string
      DEACTIVATE_INTERVAL: string

      WORK_PATH: string

      MNEMONIC: string
      // OPERATOR: string
    }
  }
}

export {}
