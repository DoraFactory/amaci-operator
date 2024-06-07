import { Groth16Proof } from 'snarkjs'
import { IMaciMetadata, IMaciStatus, ProofType } from '../types'

export interface Storage {
  fetchMacidata(id: string): Promise<IMaciMetadata & IMaciStatus>

  fetchActiveMaciData(): Promise<(IMaciMetadata & IMaciStatus)[]>

  // fetchMaciLogs(id: string): Promise<IContractLogs>

  setMaciStatus(id: string, status: Partial<IMaciStatus>): Promise<boolean>

  setDeactivateInfo(
    id: string,
    allDeactivates: string[][],
    activeStates: string[],
  ): Promise<boolean>

  fetchDeactivateInfo(id: string): Promise<{
    allDeactivates: string[][]
    activeStates: string[]
  }>

  saveAllInputs(id: string, inputs: any): Promise<boolean>

  saveProof(
    id: string,
    proofType: ProofType,
    idx: number,
    commitment: string,
    proof: Groth16Proof,
    // deactivate 专用
    size?: number,
    root?: string,
  ): Promise<boolean>

  updateTxHashOfProof(
    id: string,
    proofType: ProofType,
    idx: number,
    txHash: string,
  ): Promise<boolean>

  fetchProof(
    id: string,
    proofType: ProofType,
    idx: number,
  ): Promise<{
    commitment: string
    proof: Groth16Proof
    // deactivate 专用
    size?: number
    root?: string
  }>

  saveResult(id: string, result: string[], salt: string): Promise<boolean>

  fetchResult(id: string): Promise<{ result: string[]; salt: string }>
}
