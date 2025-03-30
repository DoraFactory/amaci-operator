import fs from 'fs'
import path from 'path'
import { groth16 } from 'snarkjs'

// import { log } from '../log'
import { getContractSignerClient } from '../lib/client/utils'
import { uploadDeactivateHistory } from '../lib/client/Deactivate.client'
import { genDeacitveMaciInputs } from '../operator/genDeactivateInputs'
import {
  MaciParams,
  ProofData,
  TaskAct,
  maciParamsFromCircuitPower,
} from '../types'
import { fetchAllDeactivateLogs, fetchRound } from '../vota/indexer'
import { adaptToUncompressed } from '../vota/adapt'
import { Timer } from '../storage/timer'
import {
  info,
  error as logError,
  debug,
  warn,
  startOperation,
  endOperation,
  setCurrentRound,
} from '../logger'

const zkeyPath = './zkey/'

const deactivateInterval = Number(process.env.DEACTIVATE_INTERVAL)

export const deactivate: TaskAct = async (_, { id }: { id: string }) => {
  // log the round id
  setCurrentRound(id)

  startOperation('deactivate', 'DEACTIVATE-TASK')

  try {
    const maciRound = await fetchRound(id)
    info(`Current round period: ${maciRound.period}`, 'DEACTIVATE-TASK')

    info('Start round deactivate', 'DEACTIVATE-TASK')

    const now = Date.now()

    // If the round has already ended, you can ignore the condition
    // and execute a deactivate task.
    if (now < Number(maciRound.votingEnd) / 1e6) {
      if (!['Pending', 'Voting'].includes(maciRound.period)) {
        logError('Round not in proper state for deactivate', 'DEACTIVATE-TASK')
        return { error: { msg: 'error status' } }
      }

      const latestdeactivateAt = Timer.get(id)

      if (latestdeactivateAt + deactivateInterval > now) {
        logError('Too early to deactivate again', 'DEACTIVATE-TASK')
        return { error: { msg: 'too earlier' } }
      }
    }

    const params = maciParamsFromCircuitPower(maciRound.circuitPower)

    const maciClient = await getContractSignerClient(id)
    const dc = await maciClient.getProcessedDMsgCount()

    const logs = await fetchAllDeactivateLogs(id)
    info('Fetched deactivate logs', 'DEACTIVATE-TASK', {
      signup: logs.signup.length,
      dmsg: logs.dmsg.length,
      processedCount: Number(dc),
    })

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
        Number(dc),
      )

      const dmsg: (ProofData & { root: string; size: string })[] = []

      info('Start generating proof for deactivate', 'DEACTIVATE-TASK', {
        period: maciRound.period,
        circuitPower: maciRound.circuitPower,
      })
      for (let i = 0; i < res.dMsgInputs.length; i++) {
        const { input, size } = res.dMsgInputs[i]

        const { proof } = await groth16.fullProve(
          input,
          zkeyPath + maciRound.circuitPower + '_v2/deactivate.wasm',
          zkeyPath + maciRound.circuitPower + '_v2/deactivate.zkey',
        )
        const proofHex = await adaptToUncompressed(proof)
        const commitment = input.newDeactivateCommitment.toString()
        const root = input.newDeactivateRoot.toString()
        debug(`Generated deactivate proof #${i}`, 'DEACTIVATE-TASK')

        dmsg.push({ proofHex, commitment, root, size })
      }

      info(`Prepare to send ${dmsg.length} deactivate messages`, 'DEACTIVATE-TASK')

      for (let i = 0; i < dmsg.length; i++) {
        const { proofHex, commitment, root, size } = dmsg[i]
        const res = await maciClient.processDeactivateMessage({
          groth16Proof: proofHex,
          newDeactivateCommitment: commitment,
          newDeactivateRoot: root,
          size,
        })
        info(`Processed deactivate message #${i} successfully✅`, 'DEACTIVATE-TASK', {
          txHash: res.transactionHash,
        })
      }

      const uploadRes = await uploadDeactivateHistory(
        id,
        res.newDeactivates.map((d) => d.map(String)),
      )
      info('Uploaded deactivate history successfully✅', 'DEACTIVATE-TASK', { uploadResult: uploadRes.transactionHash })
    } else {
      info('No new deactivate messages to process 👀', 'DEACTIVATE-TASK')
    }

    Timer.set(id, now)

    endOperation('deactivate', true, 'DEACTIVATE-TASK')
    return {}
  } catch (err) {
    logError(err, 'DEACTIVATE-TASK', { operation: 'deactivate' })
    endOperation('deactivate', false, 'DEACTIVATE-TASK')
    throw err
  }
}
