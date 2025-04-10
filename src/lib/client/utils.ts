import {
  CosmWasmClient,
  SigningCosmWasmClient,
  SigningCosmWasmClientOptions,
} from '@cosmjs/cosmwasm-stargate'
import { GasPrice } from '@cosmjs/stargate'

import { MaciClient } from './Maci.client'
import { GenerateWallet } from '../../wallet'

export const prefix = 'dora'

const defaultSigningClientOptions: SigningCosmWasmClientOptions = {
  broadcastPollIntervalMs: 8_000,
  broadcastTimeoutMs: 16_000,
  gasPrice: GasPrice.fromString('100000000000peaka'),
}

export async function getContractSignerClient(contract: string) {
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
}


export async function getAccountBalance(address: string, denom: string = 'peaka') {
  const client = await CosmWasmClient.connect(process.env.RPC_ENDPOINT)
  const balance = await client.getBalance(address, denom)
  return balance
}

