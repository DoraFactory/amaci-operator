import { Storage } from './storage'

export enum ChainId {
  eth = 1,
  sepolia = 11155111,
}

export type ProofType = 'msg' | 'tally' | 'deactivate'

export type MaciType =
  | '6-3-3-125_v3'
  | '4-2-2-25_v3'
  | '2-1-1-5_v3'
  | '9-4-3-125_v4'
  | '6-3-3-125_v4'
  | '4-2-2-25_v4'
  | '2-1-1-5_v4'

export type CircuitArtifactVersion = 'v3' | 'v4'

export const SUPPORTED_ZKEY_BUNDLES: MaciType[] = [
  '2-1-1-5_v3',
  '4-2-2-25_v3',
  '6-3-3-125_v3',
  '2-1-1-5_v4',
  '4-2-2-25_v4',
  '6-3-3-125_v4',
  '9-4-3-125_v4',
]

const V3_CIRCUIT_POWERS = new Set(['2-1-1-5', '4-2-2-25', '6-3-3-125'])
const V4_CIRCUIT_POWERS = new Set([
  '2-1-1-5',
  '4-2-2-25',
  '6-3-3-125',
  '9-4-3-125',
])

export const supportsCircuitArtifactVersion = (
  circuitPower: string,
  version: CircuitArtifactVersion,
) => (version === 'v3' ? V3_CIRCUIT_POWERS.has(circuitPower) : V4_CIRCUIT_POWERS.has(circuitPower))

export const toCircuitBundleName = (
  circuitPower: string,
  version: CircuitArtifactVersion,
): MaciType => {
  if (!supportsCircuitArtifactVersion(circuitPower, version)) {
    throw new Error(`Unsupported circuit bundle: ${circuitPower}_${version}`)
  }
  return `${circuitPower}_${version}` as MaciType
}

export const MaciParams: Record<
  MaciType,
  {
    stateTreeDepth: number
    intStateTreeDepth: number
    batchSize: number
    voteOptionTreeDepth: number
  }
> = {
  '2-1-1-5_v3': {
    stateTreeDepth: 2,
    intStateTreeDepth: 1,
    batchSize: 5,
    voteOptionTreeDepth: 1,
  },
  '4-2-2-25_v3': {
    stateTreeDepth: 4,
    intStateTreeDepth: 2,
    batchSize: 25,
    voteOptionTreeDepth: 2,
  },
  '6-3-3-125_v3': {
    stateTreeDepth: 6,
    intStateTreeDepth: 3,
    batchSize: 125,
    voteOptionTreeDepth: 3,
  },
  '9-4-3-125_v4': {
    stateTreeDepth: 9,
    intStateTreeDepth: 4,
    batchSize: 125,
    voteOptionTreeDepth: 3,
  },
  // '6-2-3-25': {
  //   stateTreeDepth: 6,
  //   intStateTreeDepth: 2,
  //   batchSize: 25,
  //   voteOptionTreeDepth: 3,
  // },
  '4-2-2-25_v4': {
    stateTreeDepth: 4,
    intStateTreeDepth: 2,
    batchSize: 25,
    voteOptionTreeDepth: 2,
  },
  '6-3-3-125_v4': {
    stateTreeDepth: 6,
    intStateTreeDepth: 3,
    batchSize: 125,
    voteOptionTreeDepth: 3,
  },
  '2-1-1-5_v4': {
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
  params?: any
}

export type TaskResult = {
  newTasks?: Task[]
  error?: { msg: string; again?: number }
}

export type TaskAct = (storage: Storage, params?: any) => Promise<TaskResult>
