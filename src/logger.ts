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
// 增加最大写入次数阈值，减少重建频率
const MAX_WRITES_BEFORE_REBUILD = 10000;  // 增加到10000次写入后才考虑重建

// 添加最小重建间隔时间(毫秒)，防止过于频繁的重建
const MIN_REBUILD_INTERVAL = 5 * 60 * 1000;  // 最小重建间隔5分钟
const lastRebuildTimes = new Map<string, number>();

// 跟踪日志重建次数，用于减少日志输出
const rebuildCounters = new Map<string, number>();

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
    new winston.transports.Console({
      format: formats.console,
      level: 'info'
    })
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
  const transportCount = roundTransports.size;
  const loggersCount = roundLoggers.size;
  
  // 只有当有东西需要清理时才输出日志
  if (transportCount > 0 || loggersCount > 0) {
    console.log(`[${new Date().toISOString()}][LOGGER] Running cleanup, force=${forceCleanAll}, transports=${transportCount}, loggers=${loggersCount}`);
  } else if (!forceCleanAll) {
    // 如果没有需要清理的内容且不是强制清理，则直接返回
    return;
  }
  
  const now = Date.now();
  
  // 如果强制清理，则清理所有传输器和日志记录器
  if (forceCleanAll) {
    console.log(`[${new Date().toISOString()}][LOGGER] Force cleaning all resources (${transportCount} transports, ${loggersCount} loggers)`);
    
    // 清理日志记录器
    for (const [roundId, logger] of roundLoggers.entries()) {
      try {
        logger.close();
        roundLoggers.delete(roundId);
        writeCounters.delete(roundId);
        lastRebuildTimes.delete(roundId);
        rebuildCounters.delete(roundId);
        transportListenerCounts.delete(roundId);
      } catch (e) {
        console.error(`[${new Date().toISOString()}][LOGGER] Error during force cleanup of logger ${roundId}: ${e}`);
      }
    }
    
    // 清理传输器
    for (const [roundId, transport] of roundTransports.entries()) {
      try {
        if (typeof (transport as any).close === 'function') {
          (transport as any).close();
        }
        roundTransports.delete(roundId);
      } catch (e) {
        console.error(`[${new Date().toISOString()}][LOGGER] Error during force cleanup of transport ${roundId}: ${e}`);
      }
    }
    
    // 额外的GC建议
    if (global.gc) {
      try {
        global.gc();
      } catch (e) {
        // 不输出GC错误
      }
    }
    
    console.log(`[${new Date().toISOString()}][LOGGER] Force cleanup completed`);
    return;
  }
  
  // 常规清理 - 检查每个日志记录器的最后使用时间
  let cleanedCount = 0;
  
  // 清理日志记录器
  for (const [roundId, logger] of roundLoggers.entries()) {
    const lastUsed = lastRebuildTimes.get(roundId) || 0;
    if (now - lastUsed > TRANSPORT_IDLE_TIMEOUT) {
      try {
        logger.close();
        roundLoggers.delete(roundId);
        writeCounters.delete(roundId);
        lastRebuildTimes.delete(roundId);
        rebuildCounters.delete(roundId);
        transportListenerCounts.delete(roundId);
        cleanedCount++;
      } catch (e) {
        // 减少错误日志
      }
    }
  }
  
  // 清理传输器
  for (const [roundId, transport] of roundTransports.entries()) {
    const lastUsed = (transport as any).lastUsed || 0;
    if (now - lastUsed > TRANSPORT_IDLE_TIMEOUT) {
      try {
        if (typeof (transport as any).close === 'function') {
          (transport as any).close();
        }
        roundTransports.delete(roundId);
        cleanedCount++;
      } catch (e) {
        // 减少错误日志
      }
    }
  }
  
  // 只有当清理了资源时才输出日志
  if (cleanedCount > 0) {
    console.log(`[${new Date().toISOString()}][LOGGER] Cleaned up ${cleanedCount} inactive resources`);
  }
};

// 更频繁地执行清理 - 每5分钟
setInterval(() => cleanupTransports(), TRANSPORT_IDLE_TIMEOUT);

// 创建专用的round日志记录器
function createRoundLogger(roundId: string): winston.Logger {
  const roundLogPath = path.join(process.env.WORK_PATH || "./work", `round_${roundId}.log`);
  
  // 创建一个单独的Winston logger实例
  const roundLogger = winston.createLogger({
    level: 'debug',
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
        level: 'debug',
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
        // 减少错误日志输出，只在真正影响功能时输出
        if (e instanceof Error && !e.message.includes('not found')) {
          console.error(`[${new Date().toISOString()}][LOGGER] Error closing logger for ${roundId}: ${e}`);
        }
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

// 添加一个锁，防止多次调用closeAllTransports
let isClosingLoggers = false;
let forceExitTimeout: NodeJS.Timeout | null = null;

// 添加关闭所有传输器的方法（在程序退出时调用）
export const closeAllTransports = () => {
  // 如果已经在关闭中，直接返回，避免重复关闭
  if (isClosingLoggers) {
    console.log(`[${new Date().toISOString()}][LOGGER] Already closing loggers, skipping duplicate call`);
    return;
  }
  
  // 设置一个强制退出定时器，确保即使日志系统卡住也能退出
  if (forceExitTimeout) {
    clearTimeout(forceExitTimeout);
  }
  forceExitTimeout = setTimeout(() => {
    console.log(`[${new Date().toISOString()}][LOGGER] Forced shutdown due to timeout - some logs may be lost`);
    isClosingLoggers = false; // 重置标志以便下次可以再次尝试关闭
  }, 2000); // 2秒后强制结束
  
  // 设置标志，表示正在关闭
  isClosingLoggers = true;
  
  console.log(`[${new Date().toISOString()}][LOGGER] Closing all loggers (${roundLoggers.size} round loggers)`);
  
  try {
    // 首先关闭主日志记录器
    try {
      winstonLogger.end(); // 使用end()而不是close()，它会刷新并关闭
      console.log(`[${new Date().toISOString()}][LOGGER] Main logger ended`);
    } catch (e) {
      console.error(`[${new Date().toISOString()}][LOGGER] Error ending main logger: ${e}`);
    }
    
    // 关闭所有轮次的日志记录器 - 限制每个操作的时间
    for (const [roundId, logger] of roundLoggers.entries()) {
      try {
        logger.end(); // 使用end()而不是close()
        console.log(`[${new Date().toISOString()}][LOGGER] Ended logger for round ${roundId}`);
      } catch (e) {
        console.error(`[${new Date().toISOString()}][LOGGER] Error ending logger for round ${roundId}: ${e}`);
      }
    }
  } finally {
    // 无论成功与否，都清理资源
    roundLoggers.clear();
    writeCounters.clear();
    transportListenerCounts.clear();
    
    // 清理完成，清除定时器
    if (forceExitTimeout) {
      clearTimeout(forceExitTimeout);
      forceExitTimeout = null;
    }
    
    // 完成关闭
    isClosingLoggers = false;
    console.log(`[${new Date().toISOString()}][LOGGER] All loggers closed`);
  }
};

// 为了安全起见，添加一个简化版的同步关闭函数，用于process.exit之前的紧急情况
export const emergencyCloseLoggers = () => {
  console.log(`[${new Date().toISOString()}][LOGGER] Emergency logger shutdown`);
  try {
    winstonLogger.clear(); // 清除所有传输器
    for (const logger of roundLoggers.values()) {
      try { logger.clear(); } catch (e) {}
    }
  } catch (e) {
    // 忽略错误，确保不阻止进程退出
  }
};

// 注册退出处理程序 - 只在logger.ts中注册用于清理logger资源的处理程序
// index.ts中的处理程序负责应用级别的退出
process.on('exit', () => {
  console.log(`[${new Date().toISOString()}][LOGGER] Process exit - final cleanup`);
  // 在exit事件中只能执行同步操作，所以使用emergencyCloseLoggers
  emergencyCloseLoggers();
});

// 修改 logWithContext 函数，优化写入方式
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
    
    // 更新计数器
    writeCounters.set(roundId, writeCount);
    
    // 检查是否需要重建 - 同时满足计数和时间间隔条件
    const lastRebuildTime = lastRebuildTimes.get(roundId) || 0;
    const timeSinceLastRebuild = Date.now() - lastRebuildTime;
    const forceRebuild = writeCount >= MAX_WRITES_BEFORE_REBUILD && timeSinceLastRebuild > MIN_REBUILD_INTERVAL;
    
    try {
      // 获取或创建该round的日志记录器
      const roundLogger = getRoundLogger(roundId, forceRebuild);
      
      // 如果需要重建，记录重建信息（但减少输出频率）
      if (forceRebuild) {
        // 重置写入计数
        writeCounters.set(roundId, 0);
        
        // 更新最后重建时间
        lastRebuildTimes.set(roundId, Date.now());
        
        // 更新并检查重建计数器，每10次只输出一次日志
        let rebuildCount = rebuildCounters.get(roundId) || 0;
        rebuildCount++;
        rebuildCounters.set(roundId, rebuildCount);
        
        if (rebuildCount % 10 === 1) {
          console.log(`[${new Date().toISOString()}][LOGGER] Rebuilding logger for round ${roundId} (rebuild #${rebuildCount}, after ${writeCount} writes)`);
        }
      }
      
      // 使用标准Winston API记录日志
      roundLogger.log({
        level,
        message: finalMessage,
        operation: contextObj.operation,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.error(`[${new Date().toISOString()}][LOGGER] Error writing to round logger: ${e}`);
      
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
const FORCE_REBUILD_INTERVAL = 3 * 60 * 60 * 1000; // 改为3小时
setInterval(() => {
  const activeRoundIds = Array.from(roundLoggers.keys());
  if (activeRoundIds.length > 0) {
    console.log(`[${new Date().toISOString()}][LOGGER] Periodic force rebuild of ${activeRoundIds.length} active loggers`);
    for (const roundId of activeRoundIds) {
      try {
        getRoundLogger(roundId, true); // 强制重建
      } catch (e) {
        console.error(`[${new Date().toISOString()}][LOGGER] Error during periodic rebuild of ${roundId}: ${e}`);
      }
    }
  }
}, FORCE_REBUILD_INTERVAL);

// 定期强制重建机制只需保留一个，删除重复的方法
// 降低清理间隔到30分钟，减少资源消耗
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30分钟
setInterval(() => cleanupTransports(), CLEANUP_INTERVAL_MS);

// 添加格式化时间函数
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(2);
    return `${minutes}m ${seconds}s`;
  }
}

// startOperation, endOperation和separator函数
export const startOperation = (operationName: string, context: Record<string, any> | string = {}) => {
  const timestamp = new Date();
  const timestampStr = timestamp.toISOString();
  const formattedTimestamp = colors.cyan(timestampStr);
  
  // 处理字符串类型的context（向后兼容）
  let operationContext: Record<string, any> = {};
  if (typeof context === 'string') {
    // 如果context是字符串，将其作为operationTag
    operationContext = { operationTag: context, operation: operationName, startTime: timestamp };
  } else {
    // 创建上下文副本，避免修改原始对象
    operationContext = { ...context, operation: operationName, startTime: timestamp };
  }
  
  // 设置操作开始时间以便后续计算持续时间
  if (!operationContext.operations) {
    operationContext.operations = {};
  }
  operationContext.operations[operationName] = { startTime: timestamp };
  
  // 记录日志
  logWithContext('info', `▶ Starting ${operationName}`, operationContext);
  
  return operationContext;
};

export const endOperation = (operationName: string, success: boolean, operationContext: Record<string, any> | string = {}) => {
  const endTime = new Date();
  let duration = 0;
  
  // 处理字符串类型的context（向后兼容）
  let finalContext: Record<string, any> = {};
  if (typeof operationContext === 'string') {
    // 如果context是字符串，将其作为operationTag
    finalContext = { operationTag: operationContext };
  } else {
    finalContext = operationContext;
  }
  
  // 计算操作持续时间
  if (finalContext.operations && finalContext.operations[operationName]?.startTime) {
    const startTime = finalContext.operations[operationName].startTime;
    
    // 如果startTime是Date对象，使用getTime()
    if (startTime instanceof Date) {
      duration = endTime.getTime() - startTime.getTime();
    } 
    // 如果startTime是数字（毫秒时间戳），直接计算差值
    else if (typeof startTime === 'number') {
      duration = endTime.getTime() - startTime;
    } 
    // 其他情况，尝试强制转换
    else {
      try {
        const timestamp = Number(startTime);
        if (!isNaN(timestamp)) {
          duration = endTime.getTime() - timestamp;
        }
      } catch (e) {
        console.error(`Failed to calculate duration for operation ${operationName}: Invalid startTime format`);
      }
    }
  }
  
  // 确保duration至少为1ms，避免显示0ms
  if (duration < 1) {
    duration = 1;
    console.warn(`Operation ${operationName} had zero duration, setting to 1ms minimum`);
  }
  
  const durationStr = formatDuration(duration);
  const status = success ? ('✅ Success') : ('❌ Failed');
  
  // 记录日志
  logWithContext(
    success ? 'info' : 'error',
    `${operationName} ${status} (${durationStr})`,
    finalContext
  );
  
  return finalContext;
};

export const separator = (title?: string) => {
  const lineWidth = 80;
  let line = '';
  
  if (title) {
    const padding = Math.max(0, Math.floor((lineWidth - title.length - 2) / 2));
    line = '='.repeat(padding) + ' ' + title + ' ' + '='.repeat(lineWidth - padding - title.length - 2);
  } else {
    line = '='.repeat(lineWidth);
  }
  
  logWithContext('info', colors.yellow(line));
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