import fs from 'fs'
import _ from 'lodash'
import { Secp256k1HdWallet } from '@cosmjs/launchpad'

import { Task, TaskResult } from './types'
import * as T from './task'

import { TestStorage } from './storage/TestStorage'
import { genKeypair } from './lib/keypair'
import { log } from './log'

const DefaultTask: Task = { name: 'inspect' }

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })

let prevTaskName = ''

if (!process.env.COORDINATOR_PRI_KEY) {
  console.log('[ERROR] empty COORDINATOR_PRI_KEY in .env file!')
  process.exit(1)
}

const main = async () => {
  console.log('Init')
  if (!fs.existsSync(process.env.WORK_PATH)) {
    fs.mkdirSync(process.env.WORK_PATH)
  }

  // ==========================================================================

  const coordinator = genKeypair(BigInt(process.env.COORDINATOR_PRI_KEY))

  console.log('\nCoordinator public key:')
  console.log('X:', String(coordinator.pubKey[0]))
  console.log('Y:', String(coordinator.pubKey[1]))

  // ==========================================================================

  const mnemonic = process.env.MNEMONIC
  const wallet = await Secp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'dora',
  })
  const [{ address }] = await wallet.getAccounts()
  console.log('\nVota address:')
  console.log(address)

  // ==========================================================================

  const storage = new TestStorage()

  const tasks: Task[] = []

  const doTack = (task: Task) => {
    switch (task.name) {
      case 'deactivate':
        return T.deactivate(storage, task.params)
      case 'tally':
        return T.tally(storage, task.params)
      // case 'proof':
      //   return T.proof(storage, task.params)
      // case 'txProof':
      //   return T.txProof(storage, task.params)
      // case 'txStopVoting':
      //   return T.txStopVoting(storage, task.params)
      // case 'txResult':
      //   return T.txResult(storage, task.params)
      case 'inspect':
      default:
        return T.inspect(storage)
    }
  }

  while (true) {
    const task = tasks.shift() || DefaultTask

    if (task.name === 'inspect' && prevTaskName === 'inspect') {
      await sleep(60000)
    }
    prevTaskName = task.name

    const msg =
      '[DO]: ' +
      task.name +
      (task.params?.id ? ' - MACI Round ' + task.params.id : '')
    console.log(msg)
    log(msg)

    const { newTasks, error } = await doTack(task).catch((err): TaskResult => {
      log(err)
      return {
        error: { msg: err.message },
      }
    })

    if (newTasks) {
      for (const nt of newTasks) {
        if (!tasks.find((t) => _.isEqual(t, nt))) {
          tasks.push(nt)
        }
      }
    }

    if (error) {
      console.log('Task Error,', error.msg)
      if (typeof error.again === 'number') {
        tasks.splice(error.again, 0, task)
      }
    }

    await sleep(1000)
  }
}

main()
