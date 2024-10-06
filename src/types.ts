import { Storage } from './storage'

export enum ChainId {
  eth = 1,
  sepolia = 11155111,
}

export type ProofType = 'msg' | 'tally' | 'deactivate'

export type MaciType = '4-2-2-25_v2' | '2-1-1-5_v2'

export const MaciParams: Record<
  MaciType,
  {
    stateTreeDepth: number
    intStateTreeDepth: number
    batchSize: number
    voteOptionTreeDepth: number
  }
> = {
  // '6-2-3-25': {
  //   stateTreeDepth: 6,
  //   intStateTreeDepth: 2,
  //   batchSize: 25,
  //   voteOptionTreeDepth: 3,
  // },
  '4-2-2-25_v2': {
    stateTreeDepth: 4,
    intStateTreeDepth: 2,
    batchSize: 25,
    voteOptionTreeDepth: 2,
  },
  '2-1-1-5_v2': {
    stateTreeDepth: 2,
    intStateTreeDepth: 1,
    batchSize: 5,
    voteOptionTreeDepth: 1,
  },
}

/**
 * eg: '2-1-1-5' => { 2, 1, 5, 1 }
 */
export const maciParamsFromCircuitPower = (circuitPower: string) => {
  const nums = circuitPower.split('-').map((s) => Number(s))

  if (nums.length !== 4 || nums.some((n) => !n)) {
    throw new Error('can not get maci params from circuit power')
  }

  return {
    stateTreeDepth: nums[0],
    intStateTreeDepth: nums[1],
    batchSize: nums[3],
    voteOptionTreeDepth: nums[2],
  }
}

export interface IMaciMetadata {
  id: string

  chainId: ChainId
  contractAddr: string
  type: MaciType

  coordinatorPrivateKey: string
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

export interface ProofData {
  proofHex: { a: string; b: string; c: string }
  commitment: string
}

export interface IKeypair {
  privKey: bigint
  pubKey: [bigint, bigint]
  formatedPrivKey: bigint
}

export type Task = {
  name: 'inspect' | 'deactivate' | 'tally'
  // | 'proof'
  // | 'txDeactivate'
  // | 'txStopVoting'
  // | 'txProof'
  // | 'txResult'
  params?: any
}

export type TaskResult = {
  newTasks?: Task[]
  error?: { msg: string; again?: number }
}

export type TaskAct = (storage: Storage, params?: any) => Promise<TaskResult>
