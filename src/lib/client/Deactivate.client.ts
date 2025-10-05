import {
  SigningCosmWasmClient,
  SigningCosmWasmClientOptions,
} from '@cosmjs/cosmwasm-stargate'
import { GasPrice } from '@cosmjs/stargate'

import { GenerateWallet } from '../../wallet'
import { withRetry, withBroadcastRetry } from './utils'
import { withTxLock } from './txLock'

export const uploadDeactivateHistory = async (
  contract: string,
  deactivate: string[][],
) => {
  return withRetry(
    async () => {
      const defaultSigningClientOptions: SigningCosmWasmClientOptions = {
        broadcastPollIntervalMs: 5_000,
        broadcastTimeoutMs: 60_000,
        gasPrice: GasPrice.fromString('10000000000peaka'),
      }
      const contractAddress = contract
      const wallet = await GenerateWallet(0)
      const signingCosmWasmClient =
        await SigningCosmWasmClient.connectWithSigner(
          process.env.RPC_ENDPOINT,
          wallet,
          {
            ...defaultSigningClientOptions,
          },
        )
      const [{ address }] = await wallet.getAccounts()
      return withTxLock(address, () =>
        withBroadcastRetry(
          () =>
            signingCosmWasmClient.execute(
              address,
              contractAddress,
              {
                upload_deactivate_message: {
                  deactivate_message: deactivate,
                },
              },
              'auto',
            ),
          { context: 'UPLOAD-DEACTIVATE-HISTORY', maxRetries: 3 },
        ),
      )
    },
    {
      maxRetries: 3,
      initialDelay: 2000,
      context: 'UPLOAD-DEACTIVATE-HISTORY',
    },
  )
}
