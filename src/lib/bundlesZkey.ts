import fs from 'fs'
import path from 'path'
import { MaciType } from '../types'

const proofKinds = ['msg', 'tally', 'deactivate'] as const
type ProofKind = (typeof proofKinds)[number]
const requiredExtensions = ['zkey', 'wasm'] as const
type BundleFileExtension = (typeof requiredExtensions)[number] | 'bin'

const proofKindAliases: Record<ProofKind, string[]> = {
  msg: ['msg', 'process'],
  tally: ['tally'],
  deactivate: ['deactivate'],
}

export function getRequiredBundleFiles(bundle: MaciType): string[] {
  return proofKinds.flatMap((kind) => {
    const names = proofKindAliases[kind]
    return requiredExtensions.map((ext) => {
      const label = names.map((name) => `${name}.${ext}`).join(' or ')
      return path.join(bundle, label)
    })
  })
}

function hasAnyBundleFile(
  bundleRoot: string,
  kind: ProofKind,
  ext: BundleFileExtension,
): boolean {
  return proofKindAliases[kind].some((name) =>
    fs.existsSync(path.join(bundleRoot, `${name}.${ext}`)),
  )
}

export function isBundleDirectoryComplete(bundleRoot: string): boolean {
  return proofKinds.every((kind) =>
    requiredExtensions.every((ext) => hasAnyBundleFile(bundleRoot, kind, ext)),
  )
}

export function listMissingBundleFiles(zkeyRoot: string, bundle: MaciType): string[] {
  const bundleRoot = path.join(zkeyRoot, bundle)
  if (!fs.existsSync(bundleRoot)) {
    return getRequiredBundleFiles(bundle)
  }
  return proofKinds.flatMap((kind) =>
    requiredExtensions.flatMap((ext) => {
      if (hasAnyBundleFile(bundleRoot, kind, ext)) return []
      const names = proofKindAliases[kind]
      const label = names.map((name) => `${name}.${ext}`).join(' or ')
      return [path.join(bundle, label)]
    }),
  )
}

export function isBundleComplete(zkeyRoot: string, bundle: MaciType): boolean {
  return listMissingBundleFiles(zkeyRoot, bundle).length === 0
}

export function resolveBundleProofFiles(
  zkeyRoot: string,
  bundle: MaciType,
  kind: ProofKind,
): { witnessPath: string; zkeyPath: string } {
  const bundleRoot = path.join(zkeyRoot, bundle)
  for (const name of proofKindAliases[kind]) {
    const zkeyPath = path.join(bundleRoot, `${name}.zkey`)
    const wasmPath = path.join(bundleRoot, `${name}.wasm`)
    const binPath = path.join(bundleRoot, `${name}.bin`)
    if (!fs.existsSync(zkeyPath)) continue
    if (fs.existsSync(binPath)) {
      return { witnessPath: binPath, zkeyPath }
    }
    if (fs.existsSync(wasmPath)) {
      return { witnessPath: wasmPath, zkeyPath }
    }
  }

  const aliases = proofKindAliases[kind].join(' or ')
  throw new Error(
    `Missing ${kind} circuit files for ${bundle}; expected ${aliases}.zkey and ${aliases}.wasm or ${aliases}.bin under ${bundleRoot}`,
  )
}
