import {
  SigningCosmWasmClient,
  SigningCosmWasmClientOptions,
} from '@cosmjs/cosmwasm-stargate'
import { Secp256k1HdWallet } from '@cosmjs/launchpad'
import { GasPrice } from '@cosmjs/stargate'
import { MaciClient } from './Maci.client'

export const prefix = 'dora'

const defaultSigningClientOptions: SigningCosmWasmClientOptions = {
  broadcastPollIntervalMs: 8_000,
  broadcastTimeoutMs: 16_000,
  gasPrice: GasPrice.fromString('100000000000peaka'),
}

export async function getContractSignerClient(contract: string) {
  const contractAddress = contract
  const mnemonic = process.env.MNEMONIC

  const wallet = await Secp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix,
  })

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
