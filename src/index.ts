import _ from 'lodash'
import { Task, TaskResult } from './types'
import * as T from './task'
import { TestStorage } from './storage/TestStorage'
import { info, error as logError, warn as logWarn } from './logger'

import { init } from './init'
import {
  startMetricsServer,
  updateOperatorState,
  updateActiveTasksCount,
} from './metrics'
import { getAccountBalance } from './lib/client/utils'
import { GenerateWallet } from './wallet'
const DefaultTask: Task = { name: 'inspect' }

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })

let prevTaskName = ''


const checkOperatorBalance = async (
  operatorAddress: string,
): Promise<boolean> => {
  try {
    const balance = await getAccountBalance(operatorAddress)
    const amount = BigInt(balance.amount)
    // 简化计算，只获取整数部分
    const amountInDora = Number(amount / BigInt(10**18))

    info(`Current operator balance: ${amountInDora} DORA`, 'BALANCE')

    // when operator balance is between 100000000000000000000 and 50000000000000000000, it will be warned
    if (amountInDora <= BigInt('200') && amountInDora >= BigInt('50')) {
      logWarn(
        `🚨Operator won't have enough balance to perform the task: ${amountInDora} DORA, Please recharge your balance`,
        'OPERATOR_BALANCE',
      )
      return true
    }

    if (amountInDora <= BigInt('50')) {
      logError(
        `🚫Operator has insufficient balance(below 50 DORA): ${amountInDora} DORA, Please recharge your balance`,
        'OPERATOR_BALANCE',
      )
      return false
    }

    return true
  } catch (err) {
    logError(
      `🚫Failed to check operator balance: ${err instanceof Error ? err.message : String(err)}`,
      'OPERATOR_BALANCE',
    )
    return false
  }
}

const main = async () => {
  await init()

  // Start metrics server
  try {
    const metricsPort = parseInt(process.env.METRICS_PORT || '3001')
    startMetricsServer(metricsPort)

    // Metrics: Set the status of the operator to inspect
    updateOperatorState('inspect')

    // Metrics: Update the number of active tasks (every 10 seconds)
    setInterval(() => {
      updateActiveTasksCount()
    }, 10000)
  } catch (e) {
    logError(
      `Failed to start metrics server: ${e instanceof Error ? e.message : String(e)}`,
      'MAIN',
    )
  }

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
    // get operator account by mnemonic
    const operatorWallet = await GenerateWallet(0)
    const [{address}] = await operatorWallet.getAccounts()

    // check operator balance
    const hasBalance = await checkOperatorBalance(address)
    if (!hasBalance) {
      logError('Operator has no enoughbalance, exited...Please recharge your balance and restart the operator service')
      process.exit(1)
    }

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
