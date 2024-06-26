import fs from 'fs'
import path from 'path'

let timer: Record<string, number> | undefined
const saveFile = path.join(process.env.WORK_PATH, `deactivate`)
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
