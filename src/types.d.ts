import { Chain } from './chain'
import { Storage } from './storage'

export enum ChainId {
  eth = 1,
}

export type ProofType = 'msg' | 'tally' | 'deactivate'

export type MaciType = '6-2-3-25' | '2-1-1-5'

export const MaciParams: Record<
  MaciType,
  {
    stateTreeDepth: number
    intStateTreeDepth: number
    batchSize: number
    voteOptionTreeDepth: number
  }
> = {
  '6-2-3-25': {
    stateTreeDepth: 6,
    intStateTreeDepth: 2,
    batchSize: 25,
    voteOptionTreeDepth: 3,
  },
  '2-1-1-5': {
    stateTreeDepth: 2,
    intStateTreeDepth: 1,
    batchSize: 5,
    voteOptionTreeDepth: 1,
  },
}

export interface IMaciMetadata {
  id: number

  chainId: ChainId
  contractAddr: string
  type: MaciType

  coordinatorPrivateKey: bigint
  eoaPrivateKey: any

  startAt: number
  endAt: number
  maxVoteOptions: number
  deactivateInterval: number
}

export interface IMaciStatus {
  latestdeactivateAt: number

  isStopVoting: boolean

  deactivateProofsCount: number
  submitedDeactivateProofsCount: number

  hasProofs: boolean
  msgProofsCount: number
  tallyProofsCount: number
  submitedProofsCount: number

  ifFinished: boolean
}

export interface IContractLogs {
  messages: {
    idx: number
    msg: bigint[]
    pubkey: [bigint, bigint]
  }[]
  dmessages: {
    idx: number
    numSignUps: number
    msg: bigint[]
    pubkey: [bigint, bigint]
  }[]
  states: {
    idx: number
    balance: bigint
    pubkey: [bigint, bigint]
    c?: bigint[]
  }[]
}

export interface IKeypair {
  privKey: bigint
  pubKey: [bigint, bigint]
  formatedPrivKey: bigint
}

export type Task = {
  name:
    | 'inspect'
    | 'deactivate'
    | 'proof'
    | 'txDeactivate'
    | 'txStopVoting'
    | 'txProof'
    | 'txResult'
  params?: any
}

export type TaskResult = {
  newTasks?: Task[]
  error?: { msg: string; again?: number }
}

export type TaskAct = (storage: Storage, params?: any) => Promise<TaskResult>
