import _ from 'lodash'
import { Task, TaskResult } from './types'
import * as T from './task'
import { TestStorage } from './storage/TestStorage'
import {
  info,
  error as logError,
} from './logger'

import { init } from './init'

const DefaultTask: Task = { name: 'inspect' }

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })

let prevTaskName = ''

if (!process.env.COORDINATOR_PRI_KEY) {
  logError('empty COORDINATOR_PRI_KEY in .env file!')
  process.exit(1)
}

const main = async () => {
  await init()

  const storage = new TestStorage()

  const tasks: Task[] = []

  const doTack = (task: Task) => {
    switch (task.name) {
      case 'deactivate':
        return T.deactivate(storage, task.params)
      case 'tally':
        return T.tally(storage, task.params)
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

    const { newTasks, error } = await doTack(task).catch((err): TaskResult => {
      logError(err)
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

    // Important: if meet any error, retry the task
    if (error) {
      logError(error.msg)
      if (typeof error.again === 'number') {
        tasks.splice(error.again, 0, task)
      }
    }

    await sleep(1000)
  }
}

main()
