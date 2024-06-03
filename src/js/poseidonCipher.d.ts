export const poseidonEncrypt: (
  msg: bigint,
  key: [bigint, bigint],
  nonce: bigint,
) => bigint[]

export const poseidonDecrypt: (
  ciphertext: bigint[],
  key: [bigint, bigint],
  nonce: bigint,
  length: number,
) => bigint[]
