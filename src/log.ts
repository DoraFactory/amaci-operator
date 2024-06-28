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

  fs.appendFileSync(
    logFile,
    msgs
      .map((m) => {
        if (m instanceof Error) {
          return m.message + '\n' + (m.stack || '') + (m.cause || '')
        }
        return m.toString()
      })
      .join(' ') + '\n',
  )
}
