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

const zkeyPath = './zkey/'

const deactivateInterval = Number(process.env.DEACTIVATE_INTERVAL)

let timer: Record<string, number> | undefined
const saveFile = path.join(process.env.WORK_PATH, `deactivate`)
if (fs.existsSync(saveFile)) {
  const file = fs.readFileSync(saveFile).toString()
  try {
    timer = JSON.parse(file)
  } catch {}
}

if (!timer) {
  timer = {}
  fs.writeFileSync(saveFile, JSON.stringify(timer))
}

export const deactivate: TaskAct = async (_, { id }: { id: string }) => {
  const maciRound = await fetchRound(id)

  const now = Date.now()

  if (maciRound.period !== 'Voting') {
    return { error: { msg: 'error status' } }
  }

  const latestdeactivateAt = timer[id] || 0

  if (latestdeactivateAt + deactivateInterval > now) {
    return { error: { msg: 'too earlier' } }
  }

  const params = maciParamsFromCircuitPower(maciRound.circuitPower)

  const logs = await fetchAllDeactivateLogs(id)

  if (logs.dmsg.length > logs.ds.length) {
    const maciClient = await getContractSignerClient(id)

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
      logs.ds.map((d) => d.map(BigInt)),
    )

    const dmsg: (ProofData & { root: string; size: string })[] = []

    log('start to gen proof | deactivate')
    for (let i = 0; i < res.dMsgInputs.length; i++) {
      const { input, size } = res.dMsgInputs[i]

      const { proof } = await groth16.fullProve(
        input,
        zkeyPath + maciRound.circuitPower + '/deactivate.wasm',
        zkeyPath + maciRound.circuitPower + '/deactivate.zkey',
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

    const uploadRes = uploadDeactivateHistory(
      id,
      res.newDeactivates.map((d) => d.map(String)),
    )
    log('upload deactivate history', uploadRes)
  }

  timer[id] = now
  fs.writeFileSync(saveFile, JSON.stringify(timer))

  return {}
}
