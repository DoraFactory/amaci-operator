/**
 * This file was automatically generated by @cosmwasm/ts-codegen@0.30.1.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run the @cosmwasm/ts-codegen generate command to regenerate this file.
 */

import {
  CosmWasmClient,
  SigningCosmWasmClient,
  ExecuteResult,
} from '@cosmjs/cosmwasm-stargate'
import { Coin, StdFee } from '@cosmjs/amino'
import {
  Uint256,
  Timestamp,
  Uint64,
  InstantiateMsg,
  PubKey,
  Groth16VKeyType,
  MaciParameters,
  QuinaryTreeRoot,
  RoundInfo,
  VotingTime,
  Whitelist,
  WhitelistConfig,
  ExecuteMsg,
  Uint128,
  MessageData,
  Groth16ProofType,
  QueryMsg,
  Addr,
  PeriodStatus,
  Period,
  Boolean,
  ArrayOfString,
} from './Maci.types'
export interface MaciReadOnlyInterface {
  contractAddress: string
  getRoundInfo: () => Promise<RoundInfo>
  getVotingTime: () => Promise<VotingTime>
  getPeriod: () => Promise<Period>
  getNumSignUp: () => Promise<Uint256>
  getMsgChainLength: () => Promise<Uint256>
  getDMsgChainLength: () => Promise<Uint256>
  getProcessedDMsgCount: () => Promise<Uint256>
  getProcessedMsgCount: () => Promise<Uint256>
  getProcessedUserCount: () => Promise<Uint256>
  getResult: ({ index }: { index: Uint256 }) => Promise<Uint256>
  getAllResult: () => Promise<Uint256>
  getStateIdxInc: ({ address }: { address: Addr }) => Promise<Uint256>
  getVoiceCreditBalance: ({ index }: { index: Uint256 }) => Promise<Uint256>
  whiteList: () => Promise<Whitelist>
  isWhiteList: ({ sender }: { sender: string }) => Promise<Boolean>
  voteOptionMap: () => Promise<ArrayOfString>
  maxVoteOptions: () => Promise<Uint256>
  queryTotalFeeGrant: () => Promise<Uint128>
  queryCircuitType: () => Promise<Uint256>
  queryCertSystem: () => Promise<Uint256>
}
export class MaciQueryClient implements MaciReadOnlyInterface {
  client: CosmWasmClient
  contractAddress: string

  constructor(client: CosmWasmClient, contractAddress: string) {
    this.client = client
    this.contractAddress = contractAddress
    this.getRoundInfo = this.getRoundInfo.bind(this)
    this.getVotingTime = this.getVotingTime.bind(this)
    this.getPeriod = this.getPeriod.bind(this)
    this.getNumSignUp = this.getNumSignUp.bind(this)
    this.getMsgChainLength = this.getMsgChainLength.bind(this)
    this.getDMsgChainLength = this.getDMsgChainLength.bind(this)
    this.getProcessedDMsgCount = this.getProcessedDMsgCount.bind(this)
    this.getProcessedMsgCount = this.getProcessedMsgCount.bind(this)
    this.getProcessedUserCount = this.getProcessedUserCount.bind(this)
    this.getResult = this.getResult.bind(this)
    this.getAllResult = this.getAllResult.bind(this)
    this.getStateIdxInc = this.getStateIdxInc.bind(this)
    this.getVoiceCreditBalance = this.getVoiceCreditBalance.bind(this)
    this.whiteList = this.whiteList.bind(this)
    this.isWhiteList = this.isWhiteList.bind(this)
    this.voteOptionMap = this.voteOptionMap.bind(this)
    this.maxVoteOptions = this.maxVoteOptions.bind(this)
    this.queryTotalFeeGrant = this.queryTotalFeeGrant.bind(this)
    this.queryCircuitType = this.queryCircuitType.bind(this)
    this.queryCertSystem = this.queryCertSystem.bind(this)
  }

  getRoundInfo = async (): Promise<RoundInfo> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_round_info: {},
    })
  }
  getVotingTime = async (): Promise<VotingTime> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_voting_time: {},
    })
  }
  getPeriod = async (): Promise<Period> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_period: {},
    })
  }
  getNumSignUp = async (): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_num_sign_up: {},
    })
  }
  getMsgChainLength = async (): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_msg_chain_length: {},
    })
  }
  getDMsgChainLength = async (): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_d_msg_chain_length: {},
    })
  }
  getProcessedDMsgCount = async (): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_processed_d_msg_count: {},
    })
  }
  getProcessedMsgCount = async (): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_processed_msg_count: {},
    })
  }
  getProcessedUserCount = async (): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_processed_user_count: {},
    })
  }
  getResult = async ({ index }: { index: Uint256 }): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_result: {
        index,
      },
    })
  }
  getAllResult = async (): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_all_result: {},
    })
  }
  getStateIdxInc = async ({ address }: { address: Addr }): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_state_idx_inc: {
        address,
      },
    })
  }
  getVoiceCreditBalance = async ({
    index,
  }: {
    index: Uint256
  }): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      get_voice_credit_balance: {
        index,
      },
    })
  }
  whiteList = async (): Promise<Whitelist> => {
    return this.client.queryContractSmart(this.contractAddress, {
      white_list: {},
    })
  }
  isWhiteList = async ({ sender }: { sender: string }): Promise<Boolean> => {
    return this.client.queryContractSmart(this.contractAddress, {
      is_white_list: {
        sender,
      },
    })
  }
  voteOptionMap = async (): Promise<ArrayOfString> => {
    return this.client.queryContractSmart(this.contractAddress, {
      vote_option_map: {},
    })
  }
  maxVoteOptions = async (): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      max_vote_options: {},
    })
  }
  queryTotalFeeGrant = async (): Promise<Uint128> => {
    return this.client.queryContractSmart(this.contractAddress, {
      query_total_fee_grant: {},
    })
  }
  queryCircuitType = async (): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      query_circuit_type: {},
    })
  }
  queryCertSystem = async (): Promise<Uint256> => {
    return this.client.queryContractSmart(this.contractAddress, {
      query_cert_system: {},
    })
  }
}
export interface MaciInterface extends MaciReadOnlyInterface {
  contractAddress: string
  sender: string
  setParams: (
    {
      intStateTreeDepth,
      messageBatchSize,
      stateTreeDepth,
      voteOptionTreeDepth,
    }: {
      intStateTreeDepth: Uint256
      messageBatchSize: Uint256
      stateTreeDepth: Uint256
      voteOptionTreeDepth: Uint256
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  setRoundInfo: (
    {
      roundInfo,
    }: {
      roundInfo: RoundInfo
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  setWhitelists: (
    {
      whitelists,
    }: {
      whitelists: Whitelist
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  setVoteOptionsMap: (
    {
      voteOptionMap,
    }: {
      voteOptionMap: string[]
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  startVotingPeriod: (
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  signUp: (
    {
      pubkey,
    }: {
      pubkey: PubKey
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  startProcessPeriod: (
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  stopVotingPeriod: (
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  publishDeactivateMessage: (
    {
      encPubKey,
      message,
    }: {
      encPubKey: PubKey
      message: MessageData
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  processDeactivateMessage: (
    {
      groth16Proof,
      newDeactivateCommitment,
      newDeactivateRoot,
      size,
    }: {
      groth16Proof: Groth16ProofType
      newDeactivateCommitment: Uint256
      newDeactivateRoot: Uint256
      size: Uint256
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  addNewKey: (
    {
      d,
      groth16Proof,
      nullifier,
      pubkey,
    }: {
      d: Uint256[]
      groth16Proof: Groth16ProofType
      nullifier: Uint256
      pubkey: PubKey
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  publishMessage: (
    {
      encPubKey,
      message,
    }: {
      encPubKey: PubKey
      message: MessageData
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  processMessage: (
    {
      groth16Proof,
      newStateCommitment,
    }: {
      groth16Proof: Groth16ProofType
      newStateCommitment: Uint256
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  stopProcessingPeriod: (
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  processTally: (
    {
      groth16Proof,
      newTallyCommitment,
    }: {
      groth16Proof: Groth16ProofType
      newTallyCommitment: Uint256
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  stopTallyingPeriod: (
    {
      results,
      salt,
    }: {
      results: Uint256[]
      salt: Uint256
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  grant: (
    {
      maxAmount,
    }: {
      maxAmount: Uint128
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  revoke: (
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  bond: (
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  withdraw: (
    {
      amount,
    }: {
      amount?: Uint128
    },
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
  claim: (
    fee?: number | StdFee | 'auto',
    memo?: string,
    _funds?: Coin[],
  ) => Promise<ExecuteResult>
}
export class MaciClient extends MaciQueryClient implements MaciInterface {
  client: SigningCosmWasmClient
  sender: string
  contractAddress: string

  constructor(
    client: SigningCosmWasmClient,
    sender: string,
    contractAddress: string,
  ) {
    super(client, contractAddress)
    this.client = client
    this.sender = sender
    this.contractAddress = contractAddress
    this.setParams = this.setParams.bind(this)
    this.setRoundInfo = this.setRoundInfo.bind(this)
    this.setWhitelists = this.setWhitelists.bind(this)
    this.setVoteOptionsMap = this.setVoteOptionsMap.bind(this)
    this.startVotingPeriod = this.startVotingPeriod.bind(this)
    this.signUp = this.signUp.bind(this)
    this.startProcessPeriod = this.startProcessPeriod.bind(this)
    this.stopVotingPeriod = this.stopVotingPeriod.bind(this)
    this.publishDeactivateMessage = this.publishDeactivateMessage.bind(this)
    this.processDeactivateMessage = this.processDeactivateMessage.bind(this)
    this.addNewKey = this.addNewKey.bind(this)
    this.publishMessage = this.publishMessage.bind(this)
    this.processMessage = this.processMessage.bind(this)
    this.stopProcessingPeriod = this.stopProcessingPeriod.bind(this)
    this.processTally = this.processTally.bind(this)
    this.stopTallyingPeriod = this.stopTallyingPeriod.bind(this)
    this.grant = this.grant.bind(this)
    this.revoke = this.revoke.bind(this)
    this.bond = this.bond.bind(this)
    this.withdraw = this.withdraw.bind(this)
    this.claim = this.claim.bind(this)
  }

  setParams = async (
    {
      intStateTreeDepth,
      messageBatchSize,
      stateTreeDepth,
      voteOptionTreeDepth,
    }: {
      intStateTreeDepth: Uint256
      messageBatchSize: Uint256
      stateTreeDepth: Uint256
      voteOptionTreeDepth: Uint256
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        set_params: {
          int_state_tree_depth: intStateTreeDepth,
          message_batch_size: messageBatchSize,
          state_tree_depth: stateTreeDepth,
          vote_option_tree_depth: voteOptionTreeDepth,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  setRoundInfo = async (
    {
      roundInfo,
    }: {
      roundInfo: RoundInfo
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        set_round_info: {
          round_info: roundInfo,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  setWhitelists = async (
    {
      whitelists,
    }: {
      whitelists: Whitelist
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        set_whitelists: {
          whitelists,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  setVoteOptionsMap = async (
    {
      voteOptionMap,
    }: {
      voteOptionMap: string[]
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        set_vote_options_map: {
          vote_option_map: voteOptionMap,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  startVotingPeriod = async (
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        start_voting_period: {},
      },
      fee,
      memo,
      _funds,
    )
  }
  signUp = async (
    {
      pubkey,
    }: {
      pubkey: PubKey
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        sign_up: {
          pubkey,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  startProcessPeriod = async (
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        start_process_period: {},
      },
      fee,
      memo,
      _funds,
    )
  }
  stopVotingPeriod = async (
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        stop_voting_period: {},
      },
      fee,
      memo,
      _funds,
    )
  }
  publishDeactivateMessage = async (
    {
      encPubKey,
      message,
    }: {
      encPubKey: PubKey
      message: MessageData
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        publish_deactivate_message: {
          enc_pub_key: encPubKey,
          message,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  processDeactivateMessage = async (
    {
      groth16Proof,
      newDeactivateCommitment,
      newDeactivateRoot,
      size,
    }: {
      groth16Proof: Groth16ProofType
      newDeactivateCommitment: Uint256
      newDeactivateRoot: Uint256
      size: Uint256
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        process_deactivate_message: {
          groth16_proof: groth16Proof,
          new_deactivate_commitment: newDeactivateCommitment,
          new_deactivate_root: newDeactivateRoot,
          size,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  addNewKey = async (
    {
      d,
      groth16Proof,
      nullifier,
      pubkey,
    }: {
      d: Uint256[]
      groth16Proof: Groth16ProofType
      nullifier: Uint256
      pubkey: PubKey
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        add_new_key: {
          d,
          groth16_proof: groth16Proof,
          nullifier,
          pubkey,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  publishMessage = async (
    {
      encPubKey,
      message,
    }: {
      encPubKey: PubKey
      message: MessageData
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        publish_message: {
          enc_pub_key: encPubKey,
          message,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  processMessage = async (
    {
      groth16Proof,
      newStateCommitment,
    }: {
      groth16Proof: Groth16ProofType
      newStateCommitment: Uint256
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        process_message: {
          groth16_proof: groth16Proof,
          new_state_commitment: newStateCommitment,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  stopProcessingPeriod = async (
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        stop_processing_period: {},
      },
      fee,
      memo,
      _funds,
    )
  }
  processTally = async (
    {
      groth16Proof,
      newTallyCommitment,
    }: {
      groth16Proof: Groth16ProofType
      newTallyCommitment: Uint256
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        process_tally: {
          groth16_proof: groth16Proof,
          new_tally_commitment: newTallyCommitment,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  stopTallyingPeriod = async (
    {
      results,
      salt,
    }: {
      results: Uint256[]
      salt: Uint256
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        stop_tallying_period: {
          results,
          salt,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  grant = async (
    {
      maxAmount,
    }: {
      maxAmount: Uint128
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        grant: {
          max_amount: maxAmount,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  revoke = async (
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        revoke: {},
      },
      fee,
      memo,
      _funds,
    )
  }
  bond = async (
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        bond: {},
      },
      fee,
      memo,
      _funds,
    )
  }
  withdraw = async (
    {
      amount,
    }: {
      amount?: Uint128
    },
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        withdraw: {
          amount,
        },
      },
      fee,
      memo,
      _funds,
    )
  }
  claim = async (
    fee: number | StdFee | 'auto' = 'auto',
    memo?: string,
    _funds?: Coin[],
  ): Promise<ExecuteResult> => {
    return await this.client.execute(
      this.sender,
      this.contractAddress,
      {
        claim: {},
      },
      fee,
      memo,
      _funds,
    )
  }
}
