export type SourceIdentity = {
  id: string
  label: string
  branch?: string
}

export type SourceIdentityAlias = {
  legacyId: string
  legacyLabel: string
  canonicalId: string
  canonicalLabel: string
  branch?: string
}

export type SourceIdentityResolution =
  | { status: 'canonical'; identity: SourceIdentity }
  | { status: 'alias'; identity: SourceIdentity; legacy: SourceIdentity }
  | { status: 'unknown'; input: string }
  | { status: 'ambiguous'; input: string; candidates: SourceIdentity[] }

const BUILT_IN_ALIASES: readonly SourceIdentityAlias[] = [
  {
    legacyId: 'prochattools-workbench',
    legacyLabel: 'Workbench Private',
    canonicalId: 'prochattools-mastermind',
    canonicalLabel: 'Mastermind Private'
  },
  {
    legacyId: 'prochattools-workbench',
    legacyLabel: 'Workbench',
    canonicalId: 'prochattools-mastermind',
    canonicalLabel: 'Mastermind'
  },
  {
    legacyId: 'prochattools-workbench-codex-recovered-v138-provider-dra',
    legacyLabel: 'Workbench Private (codex/recovered-v138-provider-dra)',
    canonicalId: 'prochattools-mastermind-codex-recovered-v138-provider-dra',
    canonicalLabel: 'Mastermind Private (codex/recovered-v138-provider-dra)',
    branch: 'codex/recovered-v138-provider-dra'
  }
]

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function matches(input: string, identity: SourceIdentity): boolean {
  return normalize(input) === normalize(identity.id) || normalize(input) === normalize(identity.label)
}

function identity(id: string, label: string, branch?: string): SourceIdentity {
  return branch ? { id, label, branch } : { id, label }
}

function assertOneToOne(aliases: readonly SourceIdentityAlias[]): void {
  const seen = new Map<string, string>()
  for (const alias of aliases) {
    for (const key of [alias.legacyId, alias.legacyLabel]) {
      const normalized = normalize(key)
      const existing = seen.get(normalized)
      if (existing && existing !== alias.canonicalId) {
        throw new Error(`Ambiguous source alias mapping for ${key}`)
      }
      seen.set(normalized, alias.canonicalId)
    }
  }
}

export function createSourceIdentityResolver(
  aliases: readonly SourceIdentityAlias[] = BUILT_IN_ALIASES
) {
  assertOneToOne(aliases)
  const mappings = aliases.map((alias) => ({
    alias,
    legacy: identity(alias.legacyId, alias.legacyLabel, alias.branch),
    canonical: identity(alias.canonicalId, alias.canonicalLabel, alias.branch)
  }))

  return (input: string, available: readonly SourceIdentity[] = []): SourceIdentityResolution => {
    const candidates = available.filter((identity) => matches(input, identity))
    if (candidates.length > 1) return { status: 'ambiguous', input, candidates }
    const aliasMatches = mappings.filter(({ alias }) =>
      normalize(input) === normalize(alias.legacyId) || normalize(input) === normalize(alias.legacyLabel) ||
      normalize(input) === normalize(alias.canonicalId) || normalize(input) === normalize(alias.canonicalLabel)
    )
    if (aliasMatches.length > 1) {
      return {
        status: 'ambiguous',
        input,
        candidates: aliasMatches.map(({ canonical }) => canonical)
      }
    }
    const match = aliasMatches[0]
    if (!match) {
      if (candidates.length === 1) return { status: 'canonical', identity: candidates[0] }
      return { status: 'unknown', input }
    }
    if (normalize(input) === normalize(match.alias.canonicalId) || normalize(input) === normalize(match.alias.canonicalLabel)) {
      return { status: 'canonical', identity: match.canonical }
    }
    return { status: 'alias', identity: match.canonical, legacy: match.legacy }
  }
}

export const mastermindSourceIdentityAliases = BUILT_IN_ALIASES
