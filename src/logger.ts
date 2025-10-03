// src/logger.ts
import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import colors from 'colors/safe';
import { EventEmitter } from 'events';

// add max listeners
EventEmitter.defaultMaxListeners = 200;

// add write counters - for tracking write counts and triggering transport rebuild
const writeCounters = new Map<string, number>();
// add max writes before rebuild, reduce rebuild frequency
const MAX_WRITES_BEFORE_REBUILD = 10000;  // 增加到10000次写入后才考虑重建

// add min rebuild interval, prevent too frequent rebuild
const MIN_REBUILD_INTERVAL = 5 * 60 * 1000;  // 最小重建间隔5分钟
const lastRebuildTimes = new Map<string, number>();

// track log rebuild counts, for reducing log output
const rebuildCounters = new Map<string, number>();

// add transport listener counts, for tracking transport listener counts
const transportListenerCounts = new Map<string, number>();

// add warning listener
process.on('warning', (warning) => {
  if (warning.name === 'MaxListenersExceededWarning') {
    console.error(`[CRITICAL] Memory leak warning: ${warning.message}`);
    console.error(`Round transports cache size: ${roundTransports.size}`);
    // trigger full cleanup
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

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

// create the file transport, rotate the log file daily
const fileTransport = new winston.transports.DailyRotateFile({
  dirname: logDir,
  filename: 'log-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '100000d',
  level: LOG_LEVEL,
  format: formats.file
});

// the console transport
const consoleTransport = new winston.transports.Console({
  level: LOG_LEVEL,
  format: formats.console
});

// create the winston logger instance
const winstonLogger = winston.createLogger({
  level: LOG_LEVEL,
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

// create a dedicated file transport for each round
const roundTransports = new Map<string, winston.transport>();

// modify the cleanup interval to 5 minutes
const TRANSPORT_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
// periodically clean up unused transports
const cleanupTransports = (forceCleanAll = false) => {
  const transportCount = roundTransports.size;
  const loggersCount = roundLoggers.size;
  
  // only output log when there is something to clean
  if (transportCount > 0 || loggersCount > 0) {
    console.log(`[${new Date().toISOString()}][LOGGER] Running cleanup, force=${forceCleanAll}, transports=${transportCount}, loggers=${loggersCount}`);
  } else if (!forceCleanAll) {
    // if there is nothing to clean and not forced, return directly
    return;
  }
  
  const now = Date.now();
  
  // if forced, clean all transports and loggers
  if (forceCleanAll) {
    console.log(`[${new Date().toISOString()}][LOGGER] Force cleaning all resources (${transportCount} transports, ${loggersCount} loggers)`);
    
    // clean loggers
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
    
    // clean transports
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
    
    // additional GC suggestions
    if (global.gc) {
      try {
        global.gc();
      } catch (e) {
        // do not output GC errors
      }
    }
    
    console.log(`[${new Date().toISOString()}][LOGGER] Force cleanup completed`);
    return;
  }
  
  // regular cleanup - check the last used time of each logger
  let cleanedCount = 0;
  
  // clean loggers
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
        // reduce error logs
      }
    }
  }
  
  // clean transports
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
        // reduce error logs
      }
    }
  }
  
  // only output log when there is something to clean
  if (cleanedCount > 0) {
    console.log(`[${new Date().toISOString()}][LOGGER] Cleaned up ${cleanedCount} inactive resources`);
  }
};

// clean up the transports periodically
setInterval(() => cleanupTransports(), TRANSPORT_IDLE_TIMEOUT);

// create a dedicated round logger
function createRoundLogger(roundId: string): winston.Logger {
  const roundLogPath = path.join(process.env.WORK_PATH || "./work", `round_${roundId}.log`);
  
  // create a dedicated Winston logger instance
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
        maxFiles: 5
      })
    ]
  });
  
  return roundLogger;
}

// create a map to store round logger instances
const roundLoggers = new Map<string, winston.Logger>();

// get or create a specific round logger (use winston logger API instead of directly accessing transports)
function getRoundLogger(roundId: string, forceRebuild = false): winston.Logger {
  // if forced rebuild or not exists, create a new logger
  if (forceRebuild || !roundLoggers.has(roundId)) {
    // if exists, close it first
    if (roundLoggers.has(roundId)) {
      try {
        const oldLogger = roundLoggers.get(roundId)!;
        oldLogger.close();
        roundLoggers.delete(roundId);
      } catch (e) {
        // reduce error logs, only output when it really affects functionality
        if (e instanceof Error && !e.message.includes('not found')) {
          console.error(`[${new Date().toISOString()}][LOGGER] Error closing logger for ${roundId}: ${e}`);
        }
      }
    }
    
    // create a new logger
    const newLogger = createRoundLogger(roundId);
    roundLoggers.set(roundId, newLogger);
    
    // reset write counters
    writeCounters.set(roundId, 0);
    transportListenerCounts.set(roundId, 0);
    
    return newLogger;
  }
  
  return roundLoggers.get(roundId)!;
}

// add a lock, prevent multiple calls to closeAllTransports
let isClosingLoggers = false;
let forceExitTimeout: NodeJS.Timeout | null = null;

// modify the method to close all transports
export const closeAllTransports = async () => {
    // if already closing, return directly
    if (isClosingLoggers) {
        console.log(`[${new Date().toISOString()}][LOGGER] Already closing loggers, skipping duplicate call`);
        return false;
    }

    // use graceful shutdown mechanism
    return gracefulShutdown(5000);
};

// modify the emergency close function
export const emergencyCloseLoggers = () => {
    console.log(`[${new Date().toISOString()}][LOGGER] Emergency logger shutdown`);
    try {
        // clear all transports
        winstonLogger.clear();
        winstonLogger.close();
        
        // clear all round loggers
        for (const logger of roundLoggers.values()) {
            try { 
                logger.clear();
                logger.close();
            } catch (e) {
                // ignore individual logger errors
            }
        }
        
        // clean resources
        roundLoggers.clear();
        writeCounters.clear();
        transportListenerCounts.clear();
        
        console.log(`[${new Date().toISOString()}][LOGGER] Emergency shutdown completed`);
    } catch (e) {
        // ignore errors, ensure not blocking process exit
        console.error(`[${new Date().toISOString()}][LOGGER] Error during emergency shutdown:`, e);
    }
};

// register exit handler - only register for logger.ts to clean up logger resources
// the handler in index.ts is for application level exit
process.on('exit', () => {
  console.log(`[${new Date().toISOString()}][LOGGER] Process exit - final cleanup`);
  // only synchronous operations can be performed in the exit event, so use emergencyCloseLoggers
  emergencyCloseLoggers();
});

// modify the logWithContext function, optimize the writing method
const logWithContext = (
  level: string,
  message: string | any,
  moduleOrContext?: string | Record<string, any>,
  context?: Record<string, any>
) => {
  let moduleStr = '';
  let contextObj = { ...currentContext };

  // process optional parameters
  if (typeof moduleOrContext === 'string') {
    moduleStr = moduleOrContext;
    if (context) {
      contextObj = { ...contextObj, ...context };
    }
  } else if (moduleOrContext && typeof moduleOrContext === 'object') {
    contextObj = { ...contextObj, ...moduleOrContext };
  }

  // process different types of messages
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

  // record the log to main logger
  winstonLogger.log({
    level,
    message: finalMessage,
    module: moduleStr,
    ...contextObj
  });
  
  // if the context contains round ID, record it to the specific round logger
  const roundId = contextObj.round || contextObj.roundId;
  if (roundId) {
    // update the write counter and check if a logger needs to be rebuilt
    let writeCount = writeCounters.get(roundId) || 0;
    writeCount++;
    
    // update the counter
    writeCounters.set(roundId, writeCount);
    
    // check if a logger needs to be rebuilt - both count and time interval conditions
    const lastRebuildTime = lastRebuildTimes.get(roundId) || 0;
    const timeSinceLastRebuild = Date.now() - lastRebuildTime;
    const forceRebuild = writeCount >= MAX_WRITES_BEFORE_REBUILD && timeSinceLastRebuild > MIN_REBUILD_INTERVAL;
    
    try {
      // get or create the round logger
      const roundLogger = getRoundLogger(roundId, forceRebuild);
      
      // if a logger needs to be rebuilt, record the rebuild information (but reduce the output frequency)
      if (forceRebuild) {
        // reset the write counter
        writeCounters.set(roundId, 0);
        
        // update the last rebuild time
        lastRebuildTimes.set(roundId, Date.now());
        
        // update and check the rebuild counter, output log only once every 10 times
        let rebuildCount = rebuildCounters.get(roundId) || 0;
        rebuildCount++;
        rebuildCounters.set(roundId, rebuildCount);
        
        if (rebuildCount % 10 === 1) {
          console.log(`[${new Date().toISOString()}][LOGGER] Rebuilding logger for round ${roundId} (rebuild #${rebuildCount}, after ${writeCount} writes)`);
        }
      }
      
      // use standard Winston API to record the log
      roundLogger.log({
        level,
        message: finalMessage,
        operation: contextObj.operation,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.error(`[${new Date().toISOString()}][LOGGER] Error writing to round logger: ${e}`);
      
      // if writing fails, force rebuild the logger next time
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

// add a periodic force rebuild of all active loggers
// rebuild every 3 hours, regardless of write count
const FORCE_REBUILD_INTERVAL = 3 * 60 * 60 * 1000; // 改为3小时
setInterval(() => {
  const activeRoundIds = Array.from(roundLoggers.keys());
  if (activeRoundIds.length > 0) {
    console.log(`[${new Date().toISOString()}][LOGGER] Periodic force rebuild of ${activeRoundIds.length} active loggers`);
    for (const roundId of activeRoundIds) {
      try {
        getRoundLogger(roundId, true); // force rebuild
      } catch (e) {
        console.error(`[${new Date().toISOString()}][LOGGER] Error during periodic rebuild of ${roundId}: ${e}`);
      }
    }
  }
}, FORCE_REBUILD_INTERVAL);

// the periodic force rebuild mechanism only needs to keep one, delete the duplicate methods
// reduce the cleanup interval to 30 minutes, reduce resource consumption
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
setInterval(() => cleanupTransports(), CLEANUP_INTERVAL_MS);

// add a function to format time
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

// startOperation, endOperation and separator functions
export const startOperation = (operationName: string, context: Record<string, any> | string = {}) => {
  const timestamp = new Date();
  const timestampStr = timestamp.toISOString();
  const formattedTimestamp = colors.cyan(timestampStr);
  
  // process the context of string type (backward compatibility)
  let operationContext: Record<string, any> = {};
  if (typeof context === 'string') {
    // if context is a string, use it as operationTag
    operationContext = { operationTag: context, operation: operationName, startTime: timestamp };
  } else {
    // create a copy of the context, avoid modifying the original object
    operationContext = { ...context, operation: operationName, startTime: timestamp };
  }
  
  // set the operation start time for subsequent duration calculation
  if (!operationContext.operations) {
    operationContext.operations = {};
  }
  operationContext.operations[operationName] = { startTime: timestamp };
  
  // record the log
  logWithContext('info', `▶ Starting ${operationName}`, operationContext);
  
  return operationContext;
};

export const endOperation = (operationName: string, success: boolean, operationContext: Record<string, any> | string = {}) => {
  const endTime = new Date();
  let duration = 0;
  
  // process the context of string type (backward compatibility)
  let finalContext: Record<string, any> = {};
  if (typeof operationContext === 'string') {
    // if context is a string, use it as operationTag
    finalContext = { operationTag: operationContext };
  } else {
    finalContext = operationContext;
  }
  
  // calculate the operation duration
  if (finalContext.operations && finalContext.operations[operationName]?.startTime) {
    const startTime = finalContext.operations[operationName].startTime;
    
    // if startTime is a Date object, use getTime()
    if (startTime instanceof Date) {
      duration = endTime.getTime() - startTime.getTime();
    } 
    // if startTime is a number (millisecond timestamp), calculate the difference directly
    else if (typeof startTime === 'number') {
      duration = endTime.getTime() - startTime;
    } 
    // other cases, try to force conversion
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
  
  // ensure duration is at least 1ms, avoid displaying 0ms
  if (duration < 1) {
    duration = 1;
    console.warn(`Operation ${operationName} had zero duration, setting to 1ms minimum`);
  }
  
  const durationStr = formatDuration(duration);
  const status = success ? ('✅ Success') : ('❌ Failed');
  
  // record the log
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

// add a helper function to set the current round
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

export const gracefulShutdown = async (timeout = 5000): Promise<boolean> => {
    console.log(`[${new Date().toISOString()}][LOGGER] Starting graceful shutdown with ${timeout}ms timeout`);
    
    return new Promise((resolve) => {
        // set timeout
        const timeoutHandle = setTimeout(() => {
            console.warn(`[${new Date().toISOString()}][LOGGER] Shutdown timeout after ${timeout}ms - forcing exit`);
            emergencyCloseLoggers();
            resolve(false);
        }, timeout);

        // create the close promise for all loggers
        const closePromises: Promise<void>[] = [];

        // the close promise for the main logger
        closePromises.push(
            new Promise<void>((resolveLogger) => {
                winstonLogger.on('finish', () => resolveLogger());
                winstonLogger.end();
            })
        );

        // the close promise for all round loggers
        for (const [roundId, logger] of roundLoggers.entries()) {
            closePromises.push(
                new Promise<void>((resolveLogger) => {
                    logger.on('finish', () => resolveLogger());
                    logger.end();
                }).catch(err => {
                    console.error(`[${new Date().toISOString()}][LOGGER] Error closing logger for round ${roundId}:`, err);
                })
            );
        }

        // wait for all loggers to close
        Promise.all(closePromises)
            .then(() => {
                clearTimeout(timeoutHandle);
                console.log(`[${new Date().toISOString()}][LOGGER] All loggers closed successfully`);
                resolve(true);
            })
            .catch(err => {
                clearTimeout(timeoutHandle);
                console.error(`[${new Date().toISOString()}][LOGGER] Error during graceful shutdown:`, err);
                emergencyCloseLoggers();
                resolve(false);
            });
    });
};

// modify the process exit handling
process.on('exit', () => {
    console.log(`[${new Date().toISOString()}][LOGGER] Process exit - emergency cleanup`);
    emergencyCloseLoggers();
});

// add other signal handling
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
    process.on(signal, async () => {
        console.log(`[${new Date().toISOString()}][LOGGER] Received ${signal} signal`);
        
        try {
            const success = await gracefulShutdown(5000);
            process.exit(success ? 0 : 1);
        } catch (err) {
            console.error(`[${new Date().toISOString()}][LOGGER] Error during shutdown:`, err);
            process.exit(1);
        }
    });
});
