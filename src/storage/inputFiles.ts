import fs from 'fs'
import path from 'path'

export type InputKind = 'msg' | 'tally'

const INDEX_PAD = 6

const getInputsBaseDir = (id: string) =>
  path.join(process.env.WORK_PATH || './work', 'data', id, 'inputs')

const getInputsDir = (id: string, kind: InputKind) =>
  path.join(getInputsBaseDir(id), kind)

const toStr = (v: any): any => {
  if (typeof v === 'bigint') return v.toString()
  if (Array.isArray(v)) return v.map(toStr)
  if (v && typeof v === 'object') {
    const out: any = {}
    for (const k of Object.keys(v)) out[k] = toStr(v[k])
    return out
  }
  return v
}

const atomicWrite = (file: string, data: string) => {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

const inputFileName = (index: number) =>
  `${String(index).padStart(INDEX_PAD, '0')}.json`

export const clearInputsDir = (id: string) => {
  const base = getInputsBaseDir(id)
  if (fs.existsSync(base)) {
    fs.rmSync(base, { recursive: true, force: true })
  }
}

export const saveInputFiles = (
  id: string,
  kind: InputKind,
  inputs: any[],
) => {
  const dir = getInputsDir(id, kind)
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < inputs.length; i++) {
    const file = path.join(dir, inputFileName(i))
    if (fs.existsSync(file)) continue
    const payload = JSON.stringify(toStr(inputs[i]))
    atomicWrite(file, payload)
  }
}

export const loadInputFiles = (
  id: string,
  kind: InputKind,
  count: number,
) => {
  const dir = getInputsDir(id, kind)
  const out: any[] = []
  for (let i = 0; i < count; i++) {
    const file = path.join(dir, inputFileName(i))
    const raw = fs.readFileSync(file, 'utf8')
    out.push(JSON.parse(raw))
  }
  return out
}
