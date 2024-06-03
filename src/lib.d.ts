declare module 'circomlib' {
  export const poseidon: (inputs: (bigint | number)[]) => bigint
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
    prv2pub: (priKey: Buffer) => [bigint, bigint]
    pruneBuffer: (buff: Buffer) => Buffer
    verifyPoseidon: (msg: bigint, sig: any, A: [bigint, bigint]) => boolean
  }
}

declare module 'ffjavascript' {
  export const utils: any
  export const Scalar: any
}

declare module 'blake-hash' {
  const createBlakeHash: any
  export default createBlakeHash
}
