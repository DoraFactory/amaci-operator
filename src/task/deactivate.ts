import fs from 'fs'
import path from 'path'
import { groth16 } from 'snarkjs'

import { log } from '../log'
import { getContractSignerClient } from '../lib/client/utils'
import { uploadDeactivateHistory } from '../lib/client/Deactivate.client'
import { genDeacitveMaciInputs } from '../operator/genDeactivateInputs'
import {
  MaciParams,
  ProofData,
  TaskAct,
  maciParamsFromCircuitPower,
} from '../types'
import { getChain } from '../chain'
import { fetchAllDeactivateLogs, fetchRound } from '../vota/indexer'
import { adaptToUncompressed } from '../vota/adapt'
import { Timer } from '../storage/timer'
import {
  startOperation,
  endOperation,
  setRoundCircuitPower,
} from '../lib/monitor'

const zkeyPath = './zkey/'

const deactivateInterval = Number(process.env.DEACTIVATE_INTERVAL)

export const deactivate: TaskAct = async (_, { id }: { id: string }) => {
  // 开始记录 deactivate 操作时间
  const startTime = startOperation(id, 'deactivate')

  try {
    log('\n\n\ndeactivate', id)
    const maciRound = await fetchRound(id)

    // 保存 round 的 circuit power 信息
    if (maciRound.circuitPower) {
      setRoundCircuitPower(id, maciRound.circuitPower)
    }

    const now = Date.now()

    // If the round has already ended, you can ignore the condition
    // and execute a deactivate task.
    if (now < Number(maciRound.votingEnd) / 1e6) {
      if (!['Pending', 'Voting'].includes(maciRound.period)) {
        // 记录失败的操作
        endOperation(id, 'deactivate', false, startTime, 'error status')
        return { error: { msg: 'error status' } }
      }

      const latestdeactivateAt = Timer.get(id)

      if (latestdeactivateAt + deactivateInterval > now) {
        // 记录失败的操作
        endOperation(id, 'deactivate', false, startTime, 'too earlier')
        return { error: { msg: 'too earlier' } }
      }
    }

    const params = maciParamsFromCircuitPower(maciRound.circuitPower)

    const maciClient = await getContractSignerClient(id)
    const dc = await maciClient.getProcessedDMsgCount()

    const logs = await fetchAllDeactivateLogs(id)

    if (logs.dmsg.length > Number(dc)) {
      const maxVoteOptions = await maciClient.maxVoteOptions()

      const res = genDeacitveMaciInputs(
        {
          ...params,
          coordPriKey: BigInt(process.env.COORDINATOR_PRI_KEY),
          maxVoteOptions: Number(maxVoteOptions),
        },
        {
          states: logs.signup.map((s) => ({
            idx: s.stateIdx,
            balance: BigInt(s.balance),
            pubkey: (s.pubKey.match(/\d+/g) || []).map((n: string) =>
              BigInt(n),
            ) as [bigint, bigint],
            c: [BigInt(s.d0), BigInt(s.d1), BigInt(s.d2), BigInt(s.d3)],
          })),
          messages: [],
          dmessages: logs.dmsg.map((m) => ({
            idx: m.dmsgChainLength,
            numSignUps: m.numSignUps,
            msg: (m.message.match(/(?<=\()\d+(?=\))/g) || []).map((s) =>
              BigInt(s),
            ),
            pubkey: (m.encPubKey.match(/\d+/g) || []).map((n: string) =>
              BigInt(n),
            ) as [bigint, bigint],
          })),
        },
        // logs.ds.map((d) => d.map(BigInt)),
        Number(dc),
      )

      const dmsg: (ProofData & { root: string; size: string })[] = []

      log('start to gen proof | deactivate')
      for (let i = 0; i < res.dMsgInputs.length; i++) {
        const { input, size } = res.dMsgInputs[i]
        // 验证输入对象中的每个字段
        const validateInput = (input: any) => {
          for (const [key, value] of Object.entries(input)) {
            if (value === undefined) {
              throw new Error(`Input field ${key} is undefined`)
            }
            if (typeof value === 'object' && value !== null) {
              validateInput(value)
            }
          }
        }

        // 在调用fullProve前
        validateInput(input)

        const { proof } = await groth16.fullProve(
          input,
          zkeyPath + maciRound.circuitPower + '_v3/deactivate.wasm',
          zkeyPath + maciRound.circuitPower + '_v3/deactivate.zkey',
        )
        const proofHex = await adaptToUncompressed(proof)
        const commitment = input.newDeactivateCommitment.toString()
        const root = input.newDeactivateRoot.toString()
        log('gen deactivate | ')

        dmsg.push({ proofHex, commitment, root, size })
      }

      log('prepare to send deactivate', dmsg.length)

      for (let i = 0; i < dmsg.length; i++) {
        const { proofHex, commitment, root, size } = dmsg[i]
        const res = await maciClient.processDeactivateMessage({
          groth16Proof: proofHex,
          newDeactivateCommitment: commitment,
          newDeactivateRoot: root,
          size,
        })
        log('processTally', i, res)
      }

      const uploadRes = await uploadDeactivateHistory(
        id,
        res.newDeactivates.map((d) => d.map(String)),
      )
      log('upload deactivate history', uploadRes)
    } else {
      log('empty deactivate op')
    }

    Timer.set(id, now)

    // 记录成功的操作
    endOperation(id, 'deactivate', true, startTime, undefined)
    return {}
  } catch (error: any) {
    // 记录失败的操作
    endOperation(id, 'deactivate', false, startTime, error.message)
    throw error
  }
}
