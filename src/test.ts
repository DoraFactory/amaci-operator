import fs from 'fs'
import {
  CosmWasmClient,
  SigningCosmWasmClient,
  SigningCosmWasmClientOptions,
} from '@cosmjs/cosmwasm-stargate'
import { Secp256k1HdWallet } from '@cosmjs/launchpad'
import { GasPrice } from '@cosmjs/stargate'
import { genKeypair } from './lib/keypair'

const apiEndpoint = 'http://3.0.94.169:8000/'
// const apiEndpoint = 'https://vota-api.dorafactory.org'

const rpc = 'https://vota-sf-rpc.dorafactory.org'

interface SignUpEvent {
  id: string
  blockHeight: string
  timestamp: string
  txHash: string
  stateIdx: number
  pubKey: string
  balance: string
  contractAddress: string
  d0: string
  d1: string
  d2: string
  d3: string
}

interface PublishMessageEvent {
  id: string
  blockHeight: string
  timestamp: string
  txHash: string
  msgChainLength: number
  message: string
  encPubKey: string
  contractAddress: string
}

interface PublishDeactivateMessageEvent {
  id: string
  blockHeight: string
  timestamp: string
  txHash: string
  dmsgChainLength: number
  numSignUps: string
  message: string
  encPubKey: string
  contractAddress: string
}

interface RoundData {
  id: string
  blockHeight: string
  txHash: string
  operator: string
  contractAddress: string
  circuitName: string
  timestamp: string
  votingStart: string
  votingEnd: string
  status: string
  period: string
  actionType: string
  roundId: string
  roundTitle: string
  roundDescription: string
  roundLink: string
  coordinatorPubkeyX: string
  coordinatorPubkeyY: string
  voteOptionMap: string
  results: string
  allResult: string
  maciDenom: string
  gasStationEnable: boolean
  totalGrant: string
  baseGrant: string
  totalBond: string
  circuitType: string
  circuitPower: string
  certificationSystem: string
}

const ROUNDS_QUERY = (
  coordinatorPubkeyX: string,
  coordinatorPubkeyY: string,
) => `query ($limit: Int, $offset: Int) {
  rounds(
    first: $limit,
    offset: $offset,
    filter: {
      coordinatorPubkeyX: {
        equalTo: "${coordinatorPubkeyX}" 
      },
      coordinatorPubkeyY: {
        equalTo: "${coordinatorPubkeyY}" 
      },
      period: {
        notIn: "Ended"
      }
    }
  ) {
    totalCount
    pageInfo {
      endCursor
      hasNextPage
    }
    nodes {
      id
      blockHeight
      txHash
      operator
      contractAddress
      coordinatorPubkeyX
      coordinatorPubkeyY
      circuitName
      timestamp
      votingStart
      votingEnd
      status
      period
      actionType
      roundId
      roundTitle
      roundDescription
      roundLink
      maciDenom
      gasStationEnable
      totalGrant
      baseGrant
      totalBond
      circuitType
      circuitPower
      certificationSystem
    }
  }
}`

const SIGN_UP_EVENTS_QUERY = (
  contract: string,
) => `query ($limit: Int, $offset: Int) {
  signUpEvents(
    first: $limit,
    offset: $offset,
    orderBy: [STATE_IDX_ASC],
    filter: {
      contractAddress: { 
        equalTo: "${contract}" 
      },
    }
  ) {
    totalCount
    pageInfo {
      endCursor
      hasNextPage
    }
    nodes {       
      id
      blockHeight
      timestamp
      txHash
      stateIdx
      pubKey
      balance
      contractAddress
      d0
      d1
      d2
      d3
    }
  }
}`

const PUBLISH_MESSAGE_EVENTS_QUERY = (
  contract: string,
) => `query ($limit: Int, $offset: Int) {
  publishMessageEvents(
    first: $limit,
    offset: $offset,
    orderBy: [MSG_CHAIN_LENGTH_ASC],
    filter: {
      contractAddress: { 
        equalTo: "${contract}" 
      },
    }
  ) {
    totalCount
    pageInfo {
      endCursor
      hasNextPage
    }
    nodes {
      id
      blockHeight
      timestamp
      txHash
      msgChainLength
      message
      encPubKey
      contractAddress
    }
  }
}`

const PUBLISH_DEACTIVATE_MESSAGE_EVENTS_QUERY = (
  contract: string,
) => `query ($limit: Int, $offset: Int) {
	publishDeactivateMessageEvents(
    first: $limit,
    offset: $offset,
    orderBy: [DMSG_CHAIN_LENGTH_ASC],
    filter: {
      contractAddress: { 
        equalTo: "${contract}" 
      },
    }
  ) {
	  totalCount
    pageInfo {
      endCursor
      hasNextPage
    }
    nodes {
      id
      blockHeight
      timestamp
      txHash
      dmsgChainLength
      numSignUps
      message
      encPubKey
      contractAddress
    }
  }
}`

const MACI_SIGNUP_QUERY = `query ($limit: Int, $offset: Int) {
  transactions(
    first: $limit,
    offset: $offset,
    filter: {
      contractAddress: {
        equalTo: "dora1smdzpfsy48kmkzmm4m9hsg4850czdvfncxyxp6d4h3j7qv3m4v0s0530a6"
      }
      type: {
        equalTo: "signup"
      }
    },
    orderBy: [TIMESTAMP_DESC]
  )
  {
	  totalCount
    pageInfo {
      endCursor
      hasNextPage
    }
    nodes {
      id
      blockHeight
      txHash
      caller
    }
  }
}`

async function fetchAllPages<T>(query: string, variables: any): Promise<T[]> {
  let hasNextPage = true
  let offset = 0
  const limit = 100 // Adjust the limit as needed
  const allData: T[] = []

  while (hasNextPage) {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { ...variables, limit, offset },
      }),
    }).then((res) => res.json())

    const key = Object.keys(response.data)[0]

    const { nodes, pageInfo } = response.data[key]
    allData.push(...nodes)
    hasNextPage = pageInfo.hasNextPage
    offset += limit
  }

  return allData
}

const testContract =
  'dora1aakfpghcanxtc45gpqlx8j3rq0zcpyf49qmhm9mdjrfx036h4z5s3avh6g'
const testOp = 'dora1f0cywn02dm63xl52kw8r9myu5lelxfxd7zrqan'

const main = async () => {
  const a = genKeypair(111111n)
  console.log(a)

  // const signTx = await fetchAllPages<any>(MACI_SIGNUP_QUERY, {})
  // fs.writeFileSync('./all.json', JSON.stringify(signTx))
  // fs.writeFileSync('./addrs.json', signTx.map((s) => s.caller).join('\n'))
  const rounds = await fetchAllPages<RoundData>(
    ROUNDS_QUERY(String(a.pubKey[0]), String(a.pubKey[1])),
    {},
  )
  console.log(rounds.length)
  // const signUpEvents = await fetchAllPages<SignUpEvent>(
  //   SIGN_UP_EVENTS_QUERY(testContract),
  //   {},
  // )
  // console.log(signUpEvents)
  // const msgEvents = await fetchAllPages<PublishMessageEvent>(
  //   PUBLISH_MESSAGE_EVENTS_QUERY(testContract),
  //   {},
  // )
  // console.log(msgEvents)
  // const dmsgEvents = await fetchAllPages<PublishDeactivateMessageEvent>(
  //   PUBLISH_DEACTIVATE_MESSAGE_EVENTS_QUERY(testContract),
  //   {},
  // )
  // console.log(dmsgEvents)
  // const client = await CosmWasmClient.connect(rpc)
  // const res = await client.queryContractSmart(testContract, {
  //   get_processed_msg_count: {},
  // })
  // console.log(res)
  // ==========================================================================
  // const prefix = 'dora'
  // const defaultSigningClientOptions: SigningCosmWasmClientOptions = {
  //   broadcastPollIntervalMs: 8_000,
  //   broadcastTimeoutMs: 16_000,
  //   gasPrice: GasPrice.fromString('100000000000peaka'),
  // }
  // const contractAddress = process.env.DEACTIVATE_RECORDER
  // const mnemonic = process.env.MNEMONIC
  // const wallet = await Secp256k1HdWallet.fromMnemonic(mnemonic, {
  //   prefix,
  // })
  // const signingCosmWasmClient = await SigningCosmWasmClient.connectWithSigner(
  //   process.env.RPC_ENDPOINT,
  //   wallet,
  //   {
  //     ...defaultSigningClientOptions,
  //   },
  // )
  // const [{ address }] = await wallet.getAccounts()
  // const res = await signingCosmWasmClient.execute(
  //   address,
  //   contractAddress,
  //   {
  //     upload_deactivate_message: {
  //       contract_address: 'test',
  //       deactivate_message: [['0', '1', '2', '3', '4']],
  //     },
  //   },
  //   'auto',
  // )
  // console.log(res)
  const response = await fetch(apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: `query {
        deactivateMessages(orderBy: [BLOCK_HEIGHT_ASC],
          filter: {
            maciContractAddress: {
              equalTo: "dora1r4x3lvn20vpls2ammp4ch5z08nge6h77p43ktl04efptgqxgl0qs07cx0z"
            },
          }) {
          nodes {
            id
            blockHeight
            timestamp
            txHash
            deactivateMessage
            maciContractAddress
            maciOperator
          }
          totalCount
        }
      }`,
    }),
  }).then((res) => res.json())
  console.log(response.data.deactivateMessages.nodes)
}

main()
