const endpoint = process.env.IND_ENDPOINT
const codeIds = process.env.CODE_IDS

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

// interface DeactivateMessage {
//   id: string
//   blockHeight: string
//   timestamp: string
//   txHash: string
//   deactivateMessage: string // '[["0", "1", "2", "3", "4"]]'
//   maciContractAddress: string
//   maciOperator: string
// }

// interface PublishDeactivateMessageEvent {
//   id: string
//   blockHeight: string
//   timestamp: string
//   txHash: string
//   dmsgChainLength: number
//   numSignUps: number
//   message: string
//   encPubKey: string
//   contractAddress: string
// }

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
  roundTitle: string
  roundDescription: string
  roundLink: string
  coordinatorPubkeyX: string
  coordinatorPubkeyY: string
  voteOptionMap: string
  results: string
  allResult: string
  gasStationEnable: boolean
  totalGrant: string
  baseGrant: string
  totalBond: string
  circuitType: '1' | '0'
  circuitPower: string
  certificationSystem: string
}

const ROUND_QUERY = (id: string) => `query {
  round(id: "${id}") {
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
    roundTitle
    roundDescription
    roundLink
    gasStationEnable
    totalGrant
    baseGrant
    totalBond
    circuitType
    circuitPower
    certificationSystem
  }
}`
const ROUNDS_QUERY = (
  coordinatorPubkeyX: string,
  coordinatorPubkeyY: string,
) => `query ($limit: Int, $offset: Int) {
  rounds(
    first: $limit,
    offset: $offset,
    filter: {
      maciType: {
        equalTo: "MACI"
      },
      caller: {
        equalTo: "${process.env.SAAS_ADDRESS}"
      },

      coordinatorPubkeyX: {
        equalTo: "${coordinatorPubkeyX}" 
      },
      coordinatorPubkeyY: {
        equalTo: "${coordinatorPubkeyY}" 
      },
      period: {
        notIn: ["Ended"]
      }
      codeId: {
        in: ${codeIds}
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
      roundTitle
      roundDescription
      roundLink
      gasStationEnable
      totalGrant
      baseGrant
      totalBond
      circuitType
      circuitPower
      certificationSystem
      codeId
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

// const PUBLISH_DEACTIVATE_MESSAGE_EVENTS_QUERY = (
//   contract: string,
// ) => `query ($limit: Int, $offset: Int) {
// 	publishDeactivateMessageEvents(
//     first: $limit,
//     offset: $offset,
//     orderBy: [DMSG_CHAIN_LENGTH_ASC],
//     filter: {
//       contractAddress: { 
//         equalTo: "${contract}" 
//       },
//     }
//   ) {
// 	  totalCount
// 	  pageInfo {
//       endCursor
//       hasNextPage
// 	  }
//     nodes {
//       id
//       blockHeight
//       timestamp
//       txHash
//       dmsgChainLength
//       numSignUps
//       message
//       encPubKey
//       contractAddress
//     }
//   }
// }`

// const DEACTIVATE_MESSAGE_QUERY = (
//   contract: string,
// ) => `query ($limit: Int, $offset: Int) {
//   deactivateMessages(
//     first: $limit,
//     offset: $offset,
//     orderBy: [BLOCK_HEIGHT_ASC],
//     filter: {
//       maciContractAddress: { 
//         equalTo: "${contract}" 
//       },
//     }
//   ) {
// 	  totalCount
// 	  pageInfo {
//       endCursor
//       hasNextPage
// 	  }
//     nodes {
//       id
//       blockHeight
//       timestamp
//       txHash
//       deactivateMessage
//       maciContractAddress
//       maciOperator
//     }
//   }
// }`

async function fetchOne<T>(query: string): Promise<T> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query }),
  })
    .then((res) => res.json())
    .then((res) => {
      const key = Object.keys(res.data)[0]
      return res.data[key] as T
    })
}

async function fetchAllPages<T>(query: string, variables: any): Promise<T[]> {
  let hasNextPage = true
  let offset = 0
  const limit = 100 // Adjust the limit as needed
  const allData: T[] = []

  while (hasNextPage) {
    const response = await fetch(endpoint, {
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

export const fetchRounds = async (coordinatorPubkey: string[]) => {
  return fetchAllPages<RoundData>(
    ROUNDS_QUERY(coordinatorPubkey[0], coordinatorPubkey[1]),
    {},
  )
}

export const fetchRound = async (id: string) => {
  return fetchOne<RoundData>(ROUND_QUERY(id))
}

export const fetchAllVotesLogs = async (contract: string) => {
  const signup = await fetchAllPages<SignUpEvent>(
    SIGN_UP_EVENTS_QUERY(contract),
    {},
  )
  const msg = await fetchAllPages<PublishMessageEvent>(
    PUBLISH_MESSAGE_EVENTS_QUERY(contract),
    {},
  )
  // const ds = await fetchAllPages<DeactivateMessage>(
  //   DEACTIVATE_MESSAGE_QUERY(ontract),
  //   {},
  // )
  // const dmsg = await fetchAllPages<PublishDeactivateMessageEvent>(
  //   PUBLISH_DEACTIVATE_MESSAGE_EVENTS_QUERY(contract),
  //   {},
  // )

  return {
    signup,
    // ds: ds.reduce(
    //   (s, c) => [...s, ...JSON.parse(c.deactivateMessage)],
    //   [] as string[][],
    // ),
    msg,
    // dmsg,
  }
}

// export const fetchAllDeactivateLogs = async (contract: string) => {
//   const signup = await fetchAllPages<SignUpEvent>(
//     SIGN_UP_EVENTS_QUERY(contract),
//     {},
//   )
//   // const ds = await fetchAllPages<DeactivateMessage>(
//   //   DEACTIVATE_MESSAGE_QUERY(contract),
//   //   {},
//   // )
//   const dmsg = await fetchAllPages<PublishDeactivateMessageEvent>(
//     PUBLISH_DEACTIVATE_MESSAGE_EVENTS_QUERY(contract),
//     {},
//   )

//   return {
//     signup,
//     // ds: ds.reduce(
//     //   (s, c) => [...s, ...JSON.parse(c.deactivateMessage)],
//     //   [] as string[][],
//     // ),
//     dmsg,
//  s
// }
