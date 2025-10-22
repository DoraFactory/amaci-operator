import fs from 'fs'
import path from 'path'

let timer: Record<string, number> | undefined
// move timer file into data directory for clarity
const saveFile = path.join(
  process.env.WORK_PATH || './work',
  'data',
  'deactivate-timer.json',
)
try {
  const dir = path.dirname(saveFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
} catch {}
if (fs.existsSync(saveFile)) {
  const file = fs.readFileSync(saveFile).toString()
  try {
    timer = JSON.parse(file)
  } catch {}
}

if (!timer) {
  timer = {}
  fs.writeFileSync(saveFile, JSON.stringify(timer))
}

export const Timer = {
  get(id: string) {
    return timer[id] || 0
  },
  set(id: string, time: number) {
    timer[id] = time
    fs.writeFileSync(saveFile, JSON.stringify(timer))
  },
}
