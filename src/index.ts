import _ from 'lodash'
import { Task, TaskResult } from './types'
import * as T from './task'
import { TestStorage } from './storage/TestStorage'
import {
  info,
  error as logError,
  warn as logWarn,
  closeAllTransports,
  emergencyCloseLoggers,
  clearContext,
} from './logger'

import { init } from './init'
import {
  startMetricsServer,
  updateOperatorState,
  updateActiveTasksCount,
  updateOperatorBalance,
  updateOperatorStatus,
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
    // 确保没有 round 上下文
    clearContext(['round'])

    const balance = await getAccountBalance(operatorAddress)
    const amount = BigInt(balance.amount)
    const amountInDora = Number(amount / BigInt(10 ** 18))

    // Metrics: Update operator balance
    updateOperatorBalance(amountInDora)

    info(`Current operator balance: ${amountInDora} DORA`, 'BALANCE')

    // when operator balance is between 100000000000000000000 and 50000000000000000000, it will be warned
    if (amountInDora <= 200 && amountInDora >= 50) {
      logWarn(
        `🚨Operator won't have enough balance to perform the task: ${amountInDora} DORA, Please recharge your balance`,
        'OPERATOR_BALANCE',
      )
      return true
    }

    if (amountInDora <= 50) {
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

// 添加一个标志跟踪进程是否正在退出
let isShuttingDown = false
let shutdownTimer: NodeJS.Timeout | null = null

// 统一处理退出过程
const gracefulShutdown = async (signal: string, exitCode: number = 0) => {
  // 如果已经在关闭中，不要重复处理
  if (isShuttingDown) {
    console.log(`Already shutting down, ignoring duplicate ${signal} signal`)
    return
  }

  // 设置退出标志
  isShuttingDown = true

  // 强制退出定时器 - 确保即使卡住也能退出
  if (shutdownTimer) {
    clearTimeout(shutdownTimer)
  }

  // 设置3秒后的强制退出
  shutdownTimer = setTimeout(() => {
    console.log(`[SHUTDOWN] Forcing exit after timeout - some data may be lost`)
    // 使用紧急关闭函数确保至少尝试清理一下
    try {
      emergencyCloseLoggers()
    } catch (e) {
      // 忽略任何错误
    }
    // 强制退出
    process.exit(exitCode)
  }, 3000)

  // 记录退出信息
  info(`Received ${signal}, shutting down...`, 'MAIN')

  // 更新运行状态
  updateOperatorStatus(false)

  // 确保日志被完全写入
  try {
    console.log('[SHUTDOWN] Closing all resources and flushing logs...')

    // 同步更新状态
    try {
      await new Promise<void>((resolve) => {
        // 给pushMetrics调用一些时间, 如果使用了这个函数的话
        setTimeout(resolve, 200)
      })
    } catch (e) {
      // 忽略任何错误
    }

    // 关闭日志系统 - 更快的版本
    try {
      closeAllTransports()
    } catch (e) {
      console.error('[SHUTDOWN] Error closing loggers:', e)
    }

    // 短暂延迟确保资源释放
    await new Promise<void>((resolve) => setTimeout(resolve, 500))

    // 清除退出定时器
    if (shutdownTimer) {
      clearTimeout(shutdownTimer)
    }

    // 正常退出
    console.log(`[SHUTDOWN] Exiting with code ${exitCode}`)
    process.exit(exitCode)
  } catch (err) {
    console.error('[SHUTDOWN] Error during shutdown:', err)
    // 出现错误时也要退出
    process.exit(exitCode)
  }
}

// 统一注册所有信号处理
process.on('SIGINT', () => gracefulShutdown('SIGINT', 0))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0))
process.on('SIGUSR1', () => gracefulShutdown('SIGUSR1', 0))
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2', 0))
process.on('uncaughtException', (err) => {
  logError(`Uncaught exception: ${err.message}\n${err.stack}`, 'MAIN')
  gracefulShutdown('uncaughtException', 1)
})

const main = async () => {
  await init()

  // Set operator status to UP
  updateOperatorStatus(true)

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
    // If startup fails, set status to down
    updateOperatorStatus(false)
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
    const [{ address }] = await operatorWallet.getAccounts()

    // check operator balance
    const hasBalance = await checkOperatorBalance(address)
    if (!hasBalance) {
      logError(
        'Operator has no enough balance, exited...Please recharge your balance and restart the operator service',
      )
      // Now, we don't want to exit the process, we want to keep the process running
      // So operator will need to monitor the balance and recharge it manually
      // gracefulShutdown('INSUFFICIENT_BALANCE', 1);
      // return;
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
