declare global {
  namespace NodeJS {
    interface ProcessEnv {
      MONGODB_URI: string
      COORDINATOR_PRI_KEY: string

      RPC_ENDPOINT: string
      IND_ENDPOINT: string

      WORK_PATH: string

      MNEMONIC: string
      OPERATOR: string
    }
  }
}

export {}
