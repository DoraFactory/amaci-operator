declare global {
  namespace NodeJS {
    type ProcessEnv = {
      COORDINATOR_PRI_KEY: string

      RPC_ENDPOINT: string
      IND_ENDPOINT: string
      CODE_IDS: string[]

      WORK_PATH: string
      SAAS_ADDRESS: string

      MNEMONIC: string
      PRIVATE: string
    }
  }
}

export {}
