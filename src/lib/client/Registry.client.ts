import { SigningCosmWasmClient, ExecuteResult } from '@cosmjs/cosmwasm-stargate'
import { Coin, StdFee } from '@cosmjs/amino'
import { withTxLock } from './txLock'

export class RegistryClient {
  constructor(
    public client: SigningCosmWasmClient,
    public sender: string,
    public contractAddress: string,
  ) {}

  private executeLocked(
    msg: Record<string, unknown>,
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> {
    return withTxLock(this.sender, () =>
      this.client.execute(this.sender, this.contractAddress, msg, fee, memo, _funds),
    )
  }

  async setOperatorIdentity(
    identity: string,
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> {
    return await this.executeLocked(
      { set_maci_operator_identity: { identity } },
      fee,
      memo,
      _funds,
    )
  }

  async setOperatorPubkey(
    x: string,
    y: string,
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> {
    return await this.executeLocked(
      { set_maci_operator_pubkey: { pubkey: { x, y } } },
      fee,
      memo,
      _funds,
    )
  }
}
