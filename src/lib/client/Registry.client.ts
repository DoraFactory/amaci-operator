import { SigningCosmWasmClient, ExecuteResult } from '@cosmjs/cosmwasm-stargate'
import { Coin, StdFee } from '@cosmjs/amino'

export class RegistryClient {
  constructor(
    public client: SigningCosmWasmClient,
    public sender: string,
    public contractAddress: string,
  ) {}

  async setOperatorIdentity(
    identity: string,
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
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
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      { set_maci_operator_pubkey: { pubkey: { x, y } } },
      fee,
      memo,
      _funds,
    )
  }
}

