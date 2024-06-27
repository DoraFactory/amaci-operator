declare module 'circomlib' {
  export const poseidon: (inputs: Array<bigint | number>) => bigint
  export const babyJub: {
    Base8: [bigint, bigint]
    mulPointEscalar: (base: [bigint, bigint], e: bigint) => [bigint, bigint]
    addPoint: (a: [bigint, bigint], b: [bigint, bigint]) => [bigint, bigint]
    F: {
      sub: (a: bigint, b: bigint) => bigint
      e: (a: bigint) => bigint
    }
  }
  export const eddsa: {
    prv2pub: (priKey: Uint8Array) => [bigint, bigint]
    pruneBuffer: (buff: Uint8Array) => Uint8Array
    verifyPoseidon: (msg: bigint, sig: any, A: [bigint, bigint]) => boolean
  }
}

declare module 'ffjavascript' {
  export const utils: any
  // eslint-disable-next-line @typescript-eslint/naming-convention
  export const Scalar: any
  export const buildBn128: any
  export const buildBls12381: any
}

declare module 'blake-hash' {
  const createBlakeHash: any
  export default createBlakeHash
}
