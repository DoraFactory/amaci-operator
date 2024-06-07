import type { Groth16Proof } from 'snarkjs'
import type { ChainId, IContractLogs, ProofType } from '../types'

export interface Chain {
  isReadyToSendTx(chainId: ChainId, priKey: any): Promise<boolean>

  fetchMaciLogs(chainId: ChainId, contractAddr: string): Promise<IContractLogs>

  stopVotingPeriod(
    chainId: ChainId,
    priKey: string,
    contractAddr: string,
    maxVoteOptions: number,
  ): Promise<string>

  proof(
    chainId: ChainId,
    priKey: string,
    contractAddr: string,
    proofType: ProofType,
    commitment: string,
    proof: Groth16Proof,
    // deactivate 专用
    size?: number,
    root?: string,
  ): Promise<string>

  stopTallyingPeriod(
    chainId: ChainId,
    priKey: string,
    contractAddr: string,
    results: string[],
    salt: string,
  ): Promise<string>
}
