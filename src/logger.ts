// src/logger.ts
import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import colors from 'colors/safe';
import { EventEmitter } from 'events';

// 大幅增加监听器限制，避免警告
EventEmitter.defaultMaxListeners = 200;

// 添加写入计数器 - 用于追踪写入次数并触发传输器重建
const writeCounters = new Map<string, number>();
// 降低最大写入次数阈值，更频繁地重建传输器以防止监听器累积
const MAX_WRITES_BEFORE_REBUILD = 100;

// 添加监听器追踪Map
const transportListenerCounts = new Map<string, number>();

// 添加警告监听
process.on('warning', (warning) => {
  if (warning.name === 'MaxListenersExceededWarning') {
    console.error(`[CRITICAL] Memory leak warning: ${warning.message}`);
    console.error(`Round transports cache size: ${roundTransports.size}`);
    // 触发全量清理
    cleanupTransports(true);
  }
});

// define the log level
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

// level config
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// level color
const levelColors = {
  error: 'red',
  warn: 'yellow',
  info: 'cyan',
  debug: 'gray'
};

// add alias for color
colors.setTheme(levelColors);

// determine the log directory
const logDir = process.env.WORK_PATH || './work';

// create the formatter
const formats = {
  // the console format, with color
  console: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.printf(({ timestamp, level, message, module, round, operation, ...rest }) => {
      const moduleStr = module ? `[${colors.magenta(String(module))}]` : '';
      const roundStr = round ? `[${colors.green(`Round:${String(round)}`)}]` : '';
      const opStr = operation ? `[${colors.blue(String(operation))}]` : '';
      const contextStr = Object.keys(rest).length > 0 
        ? `[${Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(', ')}]` 
        : '';
      
      // add color to the message based on the log level
      let coloredLevel: string;
      const levelStr = String(level || 'info').toUpperCase();
      if (level === 'error') {
        coloredLevel = colors.red(levelStr);
      } else if (level === 'warn') {
        coloredLevel = colors.yellow(levelStr);
      } else if (level === 'info') {
        coloredLevel = colors.cyan(levelStr);
      } else {
        coloredLevel = colors.gray(levelStr);
      }
      const timeStr = colors.gray(`[${timestamp}]`);

      return `${timeStr} [${coloredLevel}] ${moduleStr}${roundStr}${opStr} ${contextStr} ${message}`;
    })
  ),
  
  // the file format, no color, but contains all data
  file: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  )
};

// create the file transport, rotate the log file daily
const fileTransport = new winston.transports.DailyRotateFile({
  dirname: logDir,
  filename: 'log-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: formats.file
});

// the console transport
const consoleTransport = new winston.transports.Console({
  format: formats.console
});

// create the winston logger instance
const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  transports: [
    fileTransport,
    consoleTransport
  ],
  // record the unhandled exceptions and rejected promises
  exceptionHandlers: [fileTransport, consoleTransport],
  rejectionHandlers: [fileTransport, consoleTransport],
  exitOnError: false
});

// current context
let currentContext: Record<string, any> = {};

// set the context
export const setContext = (context: Record<string, any>) => {
  currentContext = { ...currentContext, ...context };
  return currentContext;
};

// Clear the context
export const clearContext = (keys?: string[]) => {
  if (!keys) {
    currentContext = {};
  } else {
    keys.forEach(key => delete currentContext[key]);
  }
  return currentContext;
};

// Get the current context
export const getContext = () => ({ ...currentContext });

// 为每个 round 创建专用的文件传输器
const roundTransports = new Map<string, winston.transport>();

// 修改清理时间间隔为5分钟
const TRANSPORT_IDLE_TIMEOUT = 5 * 60 * 1000; // 5分钟
// 定期清理不再使用的传输器
const cleanupTransports = (forceCleanAll = false) => {
  console.log(`[LOGGER] Running cleanup, force=${forceCleanAll}, transports=${roundTransports.size}`);
  
  const now = Date.now();
  // 获取所有传输器
  const transportEntries = Array.from(roundTransports.entries());
  
  // 如果强制清理，则清理所有传输器
  if (forceCleanAll) {
    console.log(`[LOGGER] Force cleaning all ${transportEntries.length} transports`);
    for (const [roundId, transport] of transportEntries) {
      try {
        if (typeof (transport as any).close === 'function') {
          (transport as any).close();
        }
        roundTransports.delete(roundId);
        writeCounters.delete(roundId);
        transportListenerCounts.delete(roundId);
        console.log(`[LOGGER] Force cleaned transport for round ${roundId}`);
      } catch (e) {
        console.error(`[LOGGER] Error during force cleanup of ${roundId}: ${e}`);
      }
    }
    // 额外的GC建议
    if (global.gc) {
      try {
        global.gc();
        console.log('[LOGGER] Forced garbage collection after transport cleanup');
      } catch (e) {
        console.error(`[LOGGER] Error during forced GC: ${e}`);
      }
    }
    return;
  }
  
  // 常规清理 - 检查每个传输器的最后使用时间
  let cleanedCount = 0;
  for (const [roundId, transport] of transportEntries) {
    const lastUsed = (transport as any).lastUsed || 0;
    if (now - lastUsed > TRANSPORT_IDLE_TIMEOUT) {
      // 关闭传输器
      try {
        if (typeof (transport as any).close === 'function') {
          (transport as any).close();
        }
        // 从Map中移除
        roundTransports.delete(roundId);
        writeCounters.delete(roundId);
        transportListenerCounts.delete(roundId);
        cleanedCount++;
      } catch (e) {
        console.error(`[LOGGER] Error during cleanup of ${roundId}: ${e}`);
      }
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`[LOGGER] Cleaned up ${cleanedCount} inactive transports`);
  }
};

// 更频繁地执行清理 - 每5分钟
setInterval(() => cleanupTransports(), TRANSPORT_IDLE_TIMEOUT);

// 创建专用的round日志记录器
function createRoundLogger(roundId: string): winston.Logger {
  const roundLogPath = path.join(process.env.WORK_PATH || "./work", `round_${roundId}.log`);
  
  // 创建一个单独的Winston logger实例
  const roundLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.printf(({ timestamp, level, message, operation }) => {
        const opStr = operation ? `[${operation}]` : '';
        const levelStr = String(level || 'INFO').toUpperCase();
        const messageStr = message || '';
        return `[${timestamp}] [${levelStr}] ${opStr} ${messageStr}`;
      })
    ),
    transports: [
      new winston.transports.File({
        filename: roundLogPath,
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 3
      })
    ]
  });
  
  return roundLogger;
}

// 创建一个Map来存储round的logger实例
const roundLoggers = new Map<string, winston.Logger>();

// 获取或创建特定 round 的日志传输器 (使用winston logger API而不是直接访问传输器)
function getRoundLogger(roundId: string, forceRebuild = false): winston.Logger {
  // 如果要求强制重建或者不存在此日志记录器
  if (forceRebuild || !roundLoggers.has(roundId)) {
    // 如果已存在则先关闭
    if (roundLoggers.has(roundId)) {
      try {
        const oldLogger = roundLoggers.get(roundId)!;
        oldLogger.close();
        roundLoggers.delete(roundId);
      } catch (e) {
        console.error(`[LOGGER] Error closing logger for ${roundId}: ${e}`);
      }
    }
    
    // 创建新的logger
    const newLogger = createRoundLogger(roundId);
    roundLoggers.set(roundId, newLogger);
    
    // 重置写入计数
    writeCounters.set(roundId, 0);
    transportListenerCounts.set(roundId, 0);
    
    return newLogger;
  }
  
  return roundLoggers.get(roundId)!;
}

// 添加关闭所有传输器的方法（在程序退出时调用）
export const closeAllTransports = () => {
  console.log(`[LOGGER] Closing all loggers (${roundLoggers.size} round loggers)`);
  
  // 关闭所有轮次的日志记录器
  for (const [roundId, logger] of roundLoggers.entries()) {
    try {
      logger.close();
      console.log(`[LOGGER] Closed logger for round ${roundId}`);
    } catch (e) {
      console.error(`[LOGGER] Error closing logger for round ${roundId}: ${e}`);
    }
  }
  roundLoggers.clear();
  writeCounters.clear();
  transportListenerCounts.clear();
  
  // 关闭主日志传输器
  try {
    winstonLogger.close();
    console.log('[LOGGER] Closed main logger');
  } catch (e) {
    console.error(`[LOGGER] Error closing main logger: ${e}`);
  }
};

// 确保在所有可能的退出信号上释放资源
['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'SIGTERM'].forEach((eventType) => {
  process.on(eventType as any, () => {
    console.log(`[LOGGER] Received ${eventType} signal, closing loggers...`);
    closeAllTransports();
    
    // 对于非正常退出信号，确保进程终止
    if (eventType !== 'exit' && eventType !== 'uncaughtException') {
      // 给日志系统一点时间来完成关闭操作
      setTimeout(() => {
        process.exit(0);
      }, 500);
    }
  });
});

// 修改 logWithContext 函数，使用Winston标准API而不是直接操作传输器
const logWithContext = (
  level: string,
  message: string | any,
  moduleOrContext?: string | Record<string, any>,
  context?: Record<string, any>
) => {
  let moduleStr = '';
  let contextObj = { ...currentContext };

  // Process optional parameters
  if (typeof moduleOrContext === 'string') {
    moduleStr = moduleOrContext;
    if (context) {
      contextObj = { ...contextObj, ...context };
    }
  } else if (moduleOrContext && typeof moduleOrContext === 'object') {
    contextObj = { ...contextObj, ...moduleOrContext };
  }

  // Process different types of messages
  let finalMessage = message;
  if (message instanceof Error) {
    finalMessage = `${message.message}\n${message.stack || ''}`;
    contextObj.errorName = message.name;
  } else if (typeof message !== 'string') {
    try {
      finalMessage = JSON.stringify(message);
    } catch (e) {
      finalMessage = String(message);
    }
  }

  // Record the log to main logger
  winstonLogger.log({
    level,
    message: finalMessage,
    module: moduleStr,
    ...contextObj
  });
  
  // 如果上下文中包含 round ID，则同时记录到特定 round 的日志文件
  const roundId = contextObj.round || contextObj.roundId;
  if (roundId) {
    // 更新写入计数器并检查是否需要重建日志记录器
    let writeCount = writeCounters.get(roundId) || 0;
    writeCount++;
    
    // 如果写入次数超过阈值，强制重建日志记录器
    const forceRebuild = writeCount >= MAX_WRITES_BEFORE_REBUILD;
    if (forceRebuild) {
      console.log(`[LOGGER] Rebuilding logger for round ${roundId} after ${writeCount} writes`);
      writeCount = 0;
    }
    
    // 更新计数器
    writeCounters.set(roundId, writeCount);
    
    try {
      // 获取或创建该round的日志记录器
      const roundLogger = getRoundLogger(roundId, forceRebuild);
      
      // 使用标准Winston API记录日志
      roundLogger.log({
        level,
        message: finalMessage,
        operation: contextObj.operation,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.error(`[LOGGER] Error writing to round logger: ${e}`);
      
      // 如果写入失败，下次使用时强制重建日志记录器
      if (roundLoggers.has(roundId)) {
        roundLoggers.delete(roundId);
        writeCounters.delete(roundId);
      }
    }
  }
};

// export the log function for each level
export const error = (message: any, moduleOrContext?: string | Record<string, any>, context?: Record<string, any>) => 
  logWithContext(LogLevel.ERROR, message, moduleOrContext, context);

export const warn = (message: any, moduleOrContext?: string | Record<string, any>, context?: Record<string, any>) => 
  logWithContext(LogLevel.WARN, message, moduleOrContext, context);

export const info = (message: any, moduleOrContext?: string | Record<string, any>, context?: Record<string, any>) => 
  logWithContext(LogLevel.INFO, message, moduleOrContext, context);

export const debug = (message: any, moduleOrContext?: string | Record<string, any>, context?: Record<string, any>) => 
  logWithContext(LogLevel.DEBUG, message, moduleOrContext, context);


// keep compatible with old version
export const log = (...msgs: any[]) => {
  return info(msgs.join(' '));
};

// 添加周期性强制重建所有活跃日志记录器的功能
// 每小时执行一次彻底的重建，无论写入计数如何
const FORCE_REBUILD_INTERVAL = 60 * 60 * 1000; // 1小时
setInterval(() => {
  const activeRoundIds = Array.from(roundLoggers.keys());
  if (activeRoundIds.length > 0) {
    console.log(`[LOGGER] Periodic force rebuild of ${activeRoundIds.length} active loggers`);
    for (const roundId of activeRoundIds) {
      try {
        getRoundLogger(roundId, true); // 强制重建
      } catch (e) {
        console.error(`[LOGGER] Error during periodic rebuild of ${roundId}: ${e}`);
      }
    }
  }
}, FORCE_REBUILD_INTERVAL);

// trace the operation of specific constract operation tasks
export const startOperation = (operation: string, module?: string, context?: Record<string, any>) => {
  const startTimestamp = Date.now();
  // 转换为标准的年月日时分秒格式，不指定特定时区
  const date = new Date(startTimestamp);
  const startTimeFormatted = 
    `${date.getFullYear()}-` + 
    `${String(date.getMonth() + 1).padStart(2, '0')}-` +
    `${String(date.getDate()).padStart(2, '0')} ` +
    `${String(date.getHours()).padStart(2, '0')}:` +
    `${String(date.getMinutes()).padStart(2, '0')}:` +
    `${String(date.getSeconds()).padStart(2, '0')}.` +
    `${String(date.getMilliseconds()).padStart(3, '0')}`;
  
  const opContext = { 
    operation, 
    operationStartTime: startTimeFormatted,
    ...context
  };

  // 如果是 inspect 操作，清除 round 上下文
  if (operation === 'inspect') {
    clearContext(['round', 'roundId']);
  }

  return info(`=== START: ${operation} ===`, module, opContext);
};

export const endOperation = (operation: string, success: boolean, module?: string, context?: Record<string, any>) => {
  const endTimestamp = Date.now();
  // 转换为标准的年月日时分秒格式，不指定特定时区
  const date = new Date(endTimestamp);
  const endTimeFormatted = 
    `${date.getFullYear()}-` + 
    `${String(date.getMonth() + 1).padStart(2, '0')}-` +
    `${String(date.getDate()).padStart(2, '0')} ` +
    `${String(date.getHours()).padStart(2, '0')}:` +
    `${String(date.getMinutes()).padStart(2, '0')}:` +
    `${String(date.getSeconds()).padStart(2, '0')}.` +
    `${String(date.getMilliseconds()).padStart(3, '0')}`;
  
  const status = success ? 'SUCCESS' : 'FAILED';
  const opContext: Record<string, any> = { 
    operation,
    operationEndTime: endTimeFormatted,
    operationStatus: status,
    ...context
  };
  
  // 如果上下文中有开始时间，计算持续时间
  if (currentContext.operationStart) {
    const duration = endTimestamp - currentContext.operationStart;
    opContext.operationDuration = `${duration}ms`;
  }
  
  const level = success ? LogLevel.INFO : LogLevel.ERROR;
  return logWithContext(level, `=== END: ${operation} (${status}) ===`, module, opContext);
};

// add separator
export const separator = (title?: string, module?: string) => {
  const line = title 
    ? `========== ${title} ==========` 
    : '==============================';
  return info(line, module);
};

// 添加用于设置当前 round 的辅助函数
export const setCurrentRound = (roundId: string) => {
  setContext({ round: roundId });
  return roundId;
};

export const logger = winstonLogger;

export default {
  error,
  warn,
  info,
  debug,
  log,
  startOperation,
  endOperation,
  separator,
  setContext,
  clearContext,
  getContext,
  logger
};