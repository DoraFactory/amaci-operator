import _ from 'lodash'
import { Task, TaskResult } from './types'
import * as T from './task'

import { TestStorage } from './storage/TestStorage'
import { log } from './log'

const DefaultTask: Task = { name: 'inspect' }

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })

const main = async () => {
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

    console.log('[DO]: ' + task.name)

    const { newTasks, error } = await doTack(task).catch((err): TaskResult => {
      log(err)
      return {
        error: { msg: err.message, again: -1 },
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
