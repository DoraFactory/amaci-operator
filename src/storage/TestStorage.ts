import { Groth16Proof } from 'snarkjs'
import { IMaciMetadata, ProofType, IMaciStatus } from '../types'
import { Storage } from '.'

export class TestStorage implements Storage {
  async fetchMacidata(id: string): Promise<IMaciMetadata & IMaciStatus> {
    throw new Error('Method not implemented.')
  }

  async fetchActiveMaciData(): Promise<(IMaciMetadata & IMaciStatus)[]> {
    return []
  }

  // async fetchMaciLogs(id: string): Promise<IContractLogs> {
  //   return TestContractLogs
  // }

  async setMaciStatus(
    id: string,
    status: Partial<IMaciStatus>,
  ): Promise<boolean> {
    return true
  }

  // async setDeactivateInfo(
  //   id: string,
  //   allDeactivates: string[][],
  //   activeStates: string[],
  // ): Promise<boolean> {
  //   throw new Error('Method not implemented.')
  // }
  // async fetchDeactivateInfo(
  //   id: string,
  // ): Promise<{ allDeactivates: string[][]; activeStates: string[] }> {
  //   throw new Error('Method not implemented.')
  // }

  async saveAllInputs(id: string, inputs: any): Promise<boolean> {
    return true
  }

  async saveProof(
    id: string,
    proofType: ProofType,
    idx: number,
    commitment: string,
    proof: Groth16Proof,
  ): Promise<boolean> {
    return true
  }

  async updateTxHashOfProof(
    id: string,
    proofType: ProofType,
    idx: number,
    txHash: string,
  ): Promise<boolean> {
    throw new Error('Method not implemented.')
  }

  async fetchProof(
    id: string,
    proofType: ProofType,
    idx: number,
  ): Promise<{ commitment: string; proof: Groth16Proof }> {
    throw new Error('Method not implemented.')
  }

  async saveResult(
    id: string,
    result: string[],
    salt: string,
  ): Promise<boolean> {
    throw new Error('Method not implemented.')
  }

  async fetchResult(id: string): Promise<{ result: string[]; salt: string }> {
    throw new Error('Method not implemented.')
  }
}
