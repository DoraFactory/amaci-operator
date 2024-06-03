import { Groth16Proof } from 'snarkjs'
import { IMaciMetadata, IContractLogs, ProofType, IMaciStatus } from '../types'
import { Storage } from '.'

import TestContractLogs from './test/contract-logs'

export class TestStorage implements Storage {
  async fetchMacidata(id: number): Promise<IMaciMetadata & IMaciStatus> {
    throw new Error('Method not implemented.')
  }

  async fetchActiveMaciData(): Promise<(IMaciMetadata & IMaciStatus)[]> {
    return []
  }

  async fetchMaciLogs(id: number): Promise<IContractLogs> {
    return TestContractLogs
  }

  async setMaciStatus(
    id: number,
    status: Partial<IMaciStatus>,
  ): Promise<boolean> {
    return true
  }

  async setDeactivateInfo(
    id: number,
    allDeactivates: string[][],
    activeStates: string[],
  ): Promise<boolean> {
    throw new Error('Method not implemented.')
  }
  async fetchDeactivateInfo(
    id: number,
  ): Promise<{ allDeactivates: string[][]; activeStates: string[] }> {
    throw new Error('Method not implemented.')
  }

  async saveAllInputs(id: number, inputs: any): Promise<boolean> {
    return true
  }

  async saveProof(
    id: number,
    proofType: ProofType,
    idx: number,
    commitment: string,
    proof: Groth16Proof,
  ): Promise<boolean> {
    return true
  }

  async updateTxHashOfProof(
    id: number,
    proofType: ProofType,
    idx: number,
    txHash: string,
  ): Promise<boolean> {
    throw new Error('Method not implemented.')
  }

  async fetchProof(
    id: number,
    proofType: ProofType,
    idx: number,
  ): Promise<{ commitment: string; proof: Groth16Proof }> {
    throw new Error('Method not implemented.')
  }

  async saveResult(
    id: number,
    result: string[],
    salt: string,
  ): Promise<boolean> {
    throw new Error('Method not implemented.')
  }

  async fetchResult(id: number): Promise<{ result: string[]; salt: string }> {
    throw new Error('Method not implemented.')
  }
}
