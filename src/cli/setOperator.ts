export type SetOperatorSubcommand = 'identity' | 'maciPubkey'
export type CoordinatorPrivKeyStrategy = 'reuse-existing' | 'generate-new'

export const normalizeSetOperatorSubcommand = (
  subcommand?: string,
): SetOperatorSubcommand | undefined => {
  if (!subcommand) return undefined

  switch (subcommand) {
    case 'identity':
      return 'identity'
    case 'maciPubkey':
    case 'maciPubKey':
      return 'maciPubkey'
    default:
      return undefined
  }
}

export const resolveCoordinatorPrivKeyStrategy = (
  hasValidCoordinatorPrivKey: boolean,
): CoordinatorPrivKeyStrategy =>
  hasValidCoordinatorPrivKey ? 'reuse-existing' : 'generate-new'

export const isAffirmativeAnswer = (answer: string): boolean => {
  const normalized = answer.trim().toLowerCase()
  return normalized === 'y' || normalized === 'yes'
}
