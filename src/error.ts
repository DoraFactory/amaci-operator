// Error types
export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

export class ContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContractError'
  }
}

export class DeactivateError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context: Record<string, any> = {},
  ) {
    super(message)
    this.name = 'DeactivateError'
  }
}

// Helper function to categorize errors
export function categorizeError(err: unknown): Error {
  const errorMessage = err instanceof Error ? err.message : String(err)
  const lowerMessage = errorMessage.toLowerCase()

  // Network related errors
  if (
    lowerMessage.includes('network') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('connection') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('econnreset') ||
    /502|503|504/.test(lowerMessage)
  ) {
    return new NetworkError(errorMessage)
  }

  // Contract related errors
  if (
    lowerMessage.includes('contract') ||
    lowerMessage.includes('execution') ||
    lowerMessage.includes('transaction') ||
    lowerMessage.includes('gas')
  ) {
    return new ContractError(errorMessage)
  }

  // Default to original error or convert to Error instance
  return err instanceof Error ? err : new Error(errorMessage)
}
