import fs from 'fs'
import path from 'path'
import { MaciType } from '../types'

const proofKinds = ['msg', 'tally', 'deactivate'] as const
const requiredExtensions = ['zkey', 'wasm'] as const

export function getRequiredBundleFiles(bundle: MaciType): string[] {
  return proofKinds.flatMap((kind) =>
    requiredExtensions.map((ext) => path.join(bundle, `${kind}.${ext}`)),
  )
}

export function listMissingBundleFiles(zkeyRoot: string, bundle: MaciType): string[] {
  const bundleRoot = path.join(zkeyRoot, bundle)
  if (!fs.existsSync(bundleRoot)) {
    return getRequiredBundleFiles(bundle)
  }
  return getRequiredBundleFiles(bundle).filter(
    (relativePath) => !fs.existsSync(path.join(zkeyRoot, relativePath)),
  )
}

export function isBundleComplete(zkeyRoot: string, bundle: MaciType): boolean {
  return listMissingBundleFiles(zkeyRoot, bundle).length === 0
}
