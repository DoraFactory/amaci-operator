import _ from 'lodash'
import { Task, TaskResult } from './types'
import * as T from './task'
import { TestStorage } from './storage/TestStorage'
import { info, error as logError, warn as logWarn, closeAllTransports } from './logger'

import { init } from './init'
import {
  startMetricsServer,
  updateOperatorState,
  updateActiveTasksCount,
  updateOperatorBalance,
  updateOperatorStatus
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

// 修改进程退出处理程序，确保先关闭日志系统再退出
process.on('SIGINT', async () => {
  info('Received SIGINT, shutting down...', 'MAIN')
  updateOperatorStatus(false) // 这会记录最终运行时间
  // 确保日志被完全写入后再退出
  await new Promise<void>(resolve => {
    closeAllTransports();
    setTimeout(resolve, 1000); // 给日志和指标系统1秒完成关闭
  });
  process.exit(0)
})

process.on('SIGTERM', async () => {
  info('Received SIGTERM, shutting down...', 'MAIN')
  updateOperatorStatus(false) // 这会记录最终运行时间
  // 确保日志被完全写入后再退出
  await new Promise<void>(resolve => {
    closeAllTransports();
    setTimeout(resolve, 1000); // 给日志和指标系统1秒完成关闭
  });
  process.exit(0)
})

// 添加更多信号处理
// 定义支持的进程信号类型
type NodeProcessSignal = 'SIGUSR1' | 'SIGUSR2';

// 使用类型安全的方式添加信号处理
(['SIGUSR1', 'SIGUSR2'] as NodeProcessSignal[]).forEach((signal) => {
  process.on(signal, async () => {
    info(`Received ${signal}, shutting down...`, 'MAIN')
    updateOperatorStatus(false) // 这会记录最终运行时间
    await new Promise<void>(resolve => {
      closeAllTransports();
      setTimeout(resolve, 1000); // 给日志和指标系统1秒完成关闭
    });
    process.exit(0);
  });
});

// 单独处理未捕获异常
process.on('uncaughtException', async (err) => {
  logError(`Uncaught exception: ${err.message}\n${err.stack}`, 'MAIN');
  updateOperatorStatus(false) // 这会记录最终运行时间
  await new Promise<void>(resolve => {
    closeAllTransports();
    setTimeout(resolve, 1000); // 给日志和指标系统1秒完成关闭
  });
  process.exit(1);
});

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
        'Operator has no enoughbalance, exited...Please recharge your balance and restart the operator service',
      )
      updateOperatorStatus(false) // 记录最终运行时间
      
      // 确保日志和指标系统有时间同步
      await new Promise<void>(resolve => {
        closeAllTransports();
        setTimeout(resolve, 1000);
      });
      
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
