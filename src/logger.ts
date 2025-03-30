// src/logger.ts
import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import colors from 'colors/safe';
import { EventEmitter } from 'events';

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
const logDir = process.env.WORK_PATH || './logs';

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

// 设置更高的最大监听器数量
EventEmitter.defaultMaxListeners = 50;

// 定期清理不再使用的传输器
const cleanupTransports = () => {
  const now = Date.now();
  // 获取所有传输器
  const transportEntries = Array.from(roundTransports.entries());
  
  // 检查每个传输器的最后使用时间，如果超过1小时则关闭并移除
  for (const [roundId, transport] of transportEntries) {
    const lastUsed = (transport as any).lastUsed || 0;
    if (now - lastUsed > 60 * 60 * 1000) { // 1小时
      // 关闭传输器
      if (typeof (transport as any).close === 'function') {
        (transport as any).close();
      }
      // 从Map中移除
      roundTransports.delete(roundId);
      console.log(`[LOGGER] Cleaned up transport for round ${roundId}`);
    }
  }
};

// 每小时执行一次清理
setInterval(cleanupTransports, 60 * 60 * 1000);

// 获取或创建特定 round 的日志传输器
function getRoundTransport(roundId: string): winston.transport {
  if (!roundTransports.has(roundId)) {
    // 创建 round 专用的日志文件
    const roundLogPath = path.join(process.env.WORK_PATH, `round_${roundId}.log`);
    
    // 创建该 round 的传输器
    const transport = new winston.transports.File({
      filename: roundLogPath,
      maxsize: 10 * 1024 * 1024, // 10MB 最大文件大小
      maxFiles: 3,               // 当超过大小时，保留最多3个归档文件
      tailable: true,            // 确保总是追加到日志文件末尾
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.printf(({ timestamp, level, message, operation, ...rest }) => {
          // 简化的日志格式，专注于操作和消息
          const opStr = operation ? `[${operation}]` : '';
          const levelStr = String(level || 'INFO').toUpperCase();
          const messageStr = message || '';
          return `[${timestamp}] [${levelStr}] ${opStr} ${messageStr}`;
        })
      )
    });
    
    // 添加最后使用时间
    (transport as any).lastUsed = Date.now();
    
    roundTransports.set(roundId, transport);
  } else {
    // 更新最后使用时间
    const transport = roundTransports.get(roundId)!;
    (transport as any).lastUsed = Date.now();
  }
  
  return roundTransports.get(roundId)!;
}

// 添加关闭所有传输器的方法（在程序退出时调用）
export const closeAllTransports = () => {
  for (const [roundId, transport] of roundTransports.entries()) {
    if (typeof (transport as any).close === 'function') {
      (transport as any).close();
    }
  }
  roundTransports.clear();
  
  // 也关闭主日志传输器
  winstonLogger.close();
  console.log('[LOGGER] Closed all transports');
};

// 处理程序退出
process.on('exit', () => {
  closeAllTransports();
});

// 修改 logWithContext 函数，支持按 round 记录日志
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

  // Record the log
  winstonLogger.log({
    level,
    message: finalMessage,
    module: moduleStr,
    ...contextObj
  });
  
  // 如果上下文中包含 round ID，则同时记录到特定 round 的日志文件
  const roundId = contextObj.round || contextObj.roundId;
  if (roundId) {
    // 获取或创建该 round 的传输器
    const roundTransport = getRoundTransport(roundId);
    
    // 使用Winston的格式化器创建日志条目
    const logEntry = {
      level,
      message: finalMessage,
      operation: contextObj.operation,
      timestamp: new Date().toISOString()
    };
    
    // 使用Winston的格式化器处理日志
    const formattedLog = (roundTransport as any).format.transform(logEntry);
    
    // 写入格式化后的日志
    (roundTransport as any).write(formattedLog);
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