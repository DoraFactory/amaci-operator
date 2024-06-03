import { Groth16Proof } from 'snarkjs'
import { IContractLogs, IMaciMetadata, IMaciStatus, ProofType } from '../types'

export interface Storage {
  fetchMacidata(id: number): Promise<IMaciMetadata & IMaciStatus>

  fetchActiveMaciData(): Promise<(IMaciMetadata & IMaciStatus)[]>

  fetchMaciLogs(id: number): Promise<IContractLogs>

  setMaciStatus(id: number, status: Partial<IMaciStatus>): Promise<boolean>

  setDeactivateInfo(
    id: number,
    allDeactivates: string[][],
    activeStates: string[],
  ): Promise<boolean>

  fetchDeactivateInfo(id: number): Promise<{
    allDeactivates: string[][]
    activeStates: string[]
  }>

  saveAllInputs(id: number, inputs: any): Promise<boolean>

  saveProof(
    id: number,
    proofType: ProofType,
    idx: number,
    commitment: string,
    proof: Groth16Proof,
    // deactivate 专用
    size?: number,
    root?: string,
  ): Promise<boolean>

  updateTxHashOfProof(
    id: number,
    proofType: ProofType,
    idx: number,
    txHash: string,
  ): Promise<boolean>

  fetchProof(
    id: number,
    proofType: ProofType,
    idx: number,
  ): Promise<{
    commitment: string
    proof: Groth16Proof
    // deactivate 专用
    size?: number
    root?: string
  }>

  saveResult(id: number, result: string[], salt: string): Promise<boolean>

  fetchResult(id: number): Promise<{ result: string[]; salt: string }>
}
