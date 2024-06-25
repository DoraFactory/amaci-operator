import fs from 'fs'
import path from 'path'

const idx = Math.floor(Date.now() / 3600000)
const logFile = path.join(process.env.WORK_PATH, `log-${idx}.txt`)

if (!fs.existsSync(logFile)) {
  fs.writeFileSync(logFile, '')
}

export const log = (...msgs: any[]) => {
  // console.log(...msgs)

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
