import {
  CosmWasmClient,
  SigningCosmWasmClient,
  SigningCosmWasmClientOptions,
} from '@cosmjs/cosmwasm-stargate'
import { GasPrice } from '@cosmjs/stargate'

import { MaciClient } from './Maci.client'
import { GenerateWallet } from '../../wallet'
import { info, warn, error as logError } from '../../logger'

export const prefix = 'dora'


export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;         
    initialDelay?: number;       
    maxDelay?: number;           
    backoffFactor?: number;      
    context?: string;
    checkTxStatus?: (txId: string) => Promise<{confirmed: boolean, result: T}>;
  } = {}
): Promise<T> {
  const {
    maxRetries = 5,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    context = 'RPC',
    checkTxStatus
  } = options;

  let lastError: any;
  let delay = initialDelay;
  let pendingTxId: string | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      if (pendingTxId && checkTxStatus) {
        info(`Checking status of pending transaction ${pendingTxId} (attempt ${attempt})`, context);
        const status = await checkTxStatus(pendingTxId);
        if (status.confirmed) {
          return status.result;
        }
        throw new Error(`Transaction ${pendingTxId} still pending`);
      }
      
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      if (error.message.includes("was submitted but was not yet found on the chain")) {
        const txIdMatch = error.message.match(/Transaction with ID ([A-F0-9]+)/);
        if (txIdMatch && txIdMatch[1] && checkTxStatus) {
          pendingTxId = txIdMatch[1];
          info(`Transaction ${pendingTxId} submitted but pending, switching to status check mode`, context);
          delay = Math.max(initialDelay, 16000);
        }
      }
      
      if (attempt <= maxRetries) {
        warn(`API call failed (attempt ${attempt}/${maxRetries + 1}): ${error.message}`, context);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffFactor, maxDelay);
      } else if (attempt > maxRetries) {
        logError(`API call failed, max retries reached: ${error.message}`, context);
        throw error;
      }
    }
  }

  throw lastError;
}

const defaultSigningClientOptions: SigningCosmWasmClientOptions = {
  broadcastPollIntervalMs: 8_000,
  broadcastTimeoutMs: 16_000,
  gasPrice: GasPrice.fromString('100000000000peaka'),
}

export async function getContractSignerClient(contract: string) {
  return withRetry(async () => {
    const contractAddress = contract
    const wallet = await GenerateWallet(0)

    const signingCosmWasmClient = await SigningCosmWasmClient.connectWithSigner(
      process.env.RPC_ENDPOINT,
      wallet,
      {
        ...defaultSigningClientOptions,
      },
    )

    const [{ address }] = await wallet.getAccounts()
    return new MaciClient(signingCosmWasmClient, address, contractAddress)
  }, {
    maxRetries: 3,
    initialDelay: 2000,
    context: 'CONTRACT-CLIENT'
  });
}


export async function getAccountBalance(address: string, denom: string = 'peaka') {
  return withRetry(async () => {
    const client = await CosmWasmClient.connect(process.env.RPC_ENDPOINT)
    const balance = await client.getBalance(address, denom)
    return balance
  }, {
    maxRetries: 3,
    initialDelay: 1000,
    context: 'BALANCE-CHECK'
  });
}

