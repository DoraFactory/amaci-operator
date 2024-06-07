import { MongoClient, ServerApiVersion } from 'mongodb'
import type { Groth16Proof } from 'snarkjs'
import { IMaciMetadata, ProofType, IMaciStatus } from '../types'
import { Storage } from '.'

type MaciRound = IMaciMetadata & IMaciStatus
type MaciRroof = {
  maciId: string

  idx: number
  proofType: ProofType
  commitment: string
  proof: Groth16Proof

  size?: number
  root?: string

  txHash?: string
}
type MaciResult = {
  maciId: string

  result: string[]
  salt: string
}

const uri = process.env.MONGODB_URI || ''

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const mongoClient = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

const database = mongoClient.db('maci_manager')

const maciRounds = database.collection<Omit<MaciRound, 'id'>>('rounds')
const maciProofs = database.collection<MaciRroof>('proofs')
const maciResults = database.collection<MaciResult>('results')

export class MongoStorage implements Storage {
  async createMacidata(payload: Omit<MaciRound, 'id'>): Promise<boolean> {
    const res = await maciRounds.insertOne(payload)
    if (res.acknowledged && res.insertedId) {
      return true
    } else {
      return false
    }
  }

  async fetchMacidata(id: string): Promise<MaciRound> {
    const round = await maciRounds.findOne({ id })
    if (!round) {
      throw new Error('unknow maci round')
    }
    return {
      id: round._id.toString(),
      ...round,
    }
  }

  async fetchActiveMaciData(): Promise<MaciRound[]> {
    const cursor = maciRounds.find({ ifFinished: false })
    const rounds: MaciRound[] = []
    for await (const doc of cursor) {
      rounds.push({
        id: doc._id.toString(),
        ...doc,
      })
    }
    return rounds
  }

  // async fetchMaciLogs(id: string): Promise<IContractLogs> {
  //   return TestContractLogs
  // }

  async setMaciStatus(
    id: string,
    status: Partial<IMaciStatus>,
  ): Promise<boolean> {
    const res = await maciRounds.updateOne(
      { id },
      {
        $set: {
          ...status,
        },
      },
    )
    if (res.acknowledged && res.modifiedCount) {
      return true
    } else {
      return false
    }
  }

  async setDeactivateInfo(
    id: string,
    allDeactivates: string[][],
    activeStates: string[],
  ): Promise<boolean> {
    throw new Error('Method not implemented.')
  }
  async fetchDeactivateInfo(
    id: string,
  ): Promise<{ allDeactivates: string[][]; activeStates: string[] }> {
    throw new Error('Method not implemented.')
  }

  async saveAllInputs(id: string, inputs: any): Promise<boolean> {
    return true
  }

  async saveProof(
    maciId: string,
    proofType: ProofType,
    idx: number,
    commitment: string,
    proof: Groth16Proof,
    size?: number,
    root?: string,
  ): Promise<boolean> {
    const res = await maciProofs.insertOne({
      maciId,
      idx,
      proofType,
      commitment,
      proof,
      size,
      root,
    })
    if (res.acknowledged && res.insertedId) {
      return true
    } else {
      return false
    }
  }

  async updateTxHashOfProof(
    maciId: string,
    proofType: ProofType,
    idx: number,
    txHash: string,
  ): Promise<boolean> {
    const res = await maciProofs.updateOne(
      { maciId, proofType, idx },
      {
        $set: {
          txHash,
        },
      },
    )
    if (res.acknowledged && res.modifiedCount) {
      return true
    } else {
      return false
    }
  }

  async fetchProof(
    maciId: string,
    proofType: ProofType,
    idx: number,
  ): Promise<{ commitment: string; proof: Groth16Proof }> {
    const proof = await maciProofs.findOne({ maciId, proofType, idx })
    if (!proof) {
      throw new Error(['unknow maci proof:', maciId, proofType, idx].join(' '))
    }
    return proof
  }

  async saveResult(
    maciId: string,
    result: string[],
    salt: string,
  ): Promise<boolean> {
    const res = await maciResults.insertOne({
      maciId,
      result,
      salt,
    })
    if (res.acknowledged && res.insertedId) {
      return true
    } else {
      return false
    }
  }

  async fetchResult(
    maciId: string,
  ): Promise<{ result: string[]; salt: string }> {
    const result = await maciResults.findOne({ maciId })
    if (!result) {
      throw new Error(['unknow maci result:', maciId].join(' '))
    }
    return result
  }
}
