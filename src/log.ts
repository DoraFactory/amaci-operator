import fs from 'fs'
import path from 'path'

if (!fs.existsSync(process.env.WORK_PATH)) {
  fs.mkdirSync(process.env.WORK_PATH)
}

let logFile = ''
const updateLogFile = () => {
  logFile = path.join(
    process.env.WORK_PATH,
    `log-${Math.floor(Date.now() / 3600000)}.txt`,
  )
  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, '')
  }
}
updateLogFile()

export const log = (...msgs: any[]) => {
  updateLogFile()

  const logMessage = msgs
    .map((m) => {
      if (m instanceof Error) {
        return m.message + '\n' + (m.stack || '') + (m.cause || '')
      }
      return m.toString()
    })
    .join(' ') + '\n';

  // 写入日志文件
  fs.appendFileSync(logFile, logMessage);
  
  // 同时输出到控制台
  console.log(...msgs);
}
