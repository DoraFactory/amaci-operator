import Web3 from 'web3'
import { IContractLogs } from '@/types'

const sleep = async (ms: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

const PublishMessageSign =
  '0x8bb5a8cf78a5b2f53c73e2feacb1fb3e91c3f03cb15e33f53174db20e37e3928'
// const PublishDeactivateMessageSign =
  // '0xbc95c7d3fe7fef05bb4206d406cce3f05e000db24e6ca7d01aee1cfa63fa58e4'
const SignUpSign =
  '0xc7563c66f89e2fb0839e2b64ed54fe4803ff9428777814772ccfe4c385072c4b'
const SignUpActiveSign =
  '0x6385353c27ff5a24160beb230f2b460f782c96306af71eae339d9c486cda48da'

type Log = { topics: string[]; data: string }

export const getContractLogs = async (
  web3: Web3,
  contract: string,
  from?: number,
  to?: number,
): Promise<IContractLogs> => {
  const messages: IContractLogs['messages'] = []
  // const dmessages: IContractLogs['dmessages'] = []
  const states: IContractLogs['states'] = []
  const statesActive: { idx: number; c: bigint[] }[] = []

  function handleMessage(log: Log) {
    const idx = Number(log.topics[1])
    const d = web3.eth.abi.decodeParameters(
      ['uint256[9]'],
      log.data,
    )[0] as string[]
    const msg = d.slice(0, 7).map((n) => BigInt(n))
    const pubkey = d.slice(7, 9).map((n) => BigInt(n)) as [bigint, bigint]
    messages.push({ idx, msg, pubkey })
  }

  // function handleDeactivateMessage(log: Log) {
  //   const idx = Number(log.topics[1])
  //   const d = web3.eth.abi.decodeParameters(
  //     ['uint256[10]'],
  //     log.data,
  //   )[0] as string[]
  //   const numSignUps = Number(d[0])
  //   const msg = d.slice(1, 8).map((n) => BigInt(n))
  //   const pubkey = d.slice(8, 10).map((n) => BigInt(n)) as [bigint, bigint]
  //   dmessages.push({ idx, numSignUps, msg, pubkey })
  // }

  function handleSignUpActive(log: Log) {
    const idx = Number(log.topics[1])
    const c = (
      web3.eth.abi.decodeParameters(['uint256[4]'], log.data)[0] as string[]
    ).map((n) => BigInt(n))
    statesActive.push({ idx, c })
  }

  function handleSignup(log: Log) {
    const idx = Number(log.topics[1])
    const d = web3.eth.abi.decodeParameters(
      ['uint256[3]'],
      log.data,
    )[0] as string[]
    const pubkey = d.slice(0, 2).map((n) => BigInt(n)) as [bigint, bigint]
    const balance = BigInt(d[2])
    states.push({ idx, balance, pubkey })
  }

  const number = await web3.eth.getBlockNumber()

  const fromBlock = Number(number) - 2000
  const endBlock = Number(number)

  for (let i = fromBlock; i < endBlock; i += 2000) {
    const from = i
    const to = i + 1999
    await web3.eth
      .getPastLogs({
        fromBlock: from,
        toBlock: to,
        topics: [
          [
            PublishMessageSign,
            // PublishDeactivateMessageSign,
            SignUpSign,
            SignUpActiveSign,
          ],
        ],
        address: contract,
      })
      .then((logs) => {
        for (const _log of logs) {
          const log = _log as Log
          if (log.topics[0] === PublishMessageSign) {
            handleMessage(log)
          // } else if (log.topics[0] === PublishDeactivateMessageSign) {
          //   handleDeactivateMessage(log)
          } else if (log.topics[0] === SignUpActiveSign) {
            handleSignUpActive(log)
          } else {
            handleSignup(log)
          }
        }
        console.log(logs.length)
      })
      .catch((err) => {
        console.error(err.message || err)
      })
    console.log(`Processed: from height ${from}, to height ${to}.`)
    await sleep(1000)
  }

  for (const sa of statesActive) {
    const s = states.find((d) => d.idx === sa.idx)
    if (s) {
      s.c = sa.c
    }
  }

  return { messages, states }
}
