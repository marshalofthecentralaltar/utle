/**
 * Round 10 (#8): which Anthropic key the server loaded, and from where, for one line at start.
 * `npm run dev` and `npm run serve` load `.env.local` with Node's `--env-file-if-exists`, and Node
 * never overrides a variable the environment already has: a Windows user variable of the same name
 * wins over the file without a word (2026-10-27). The line names the source and a short prefix,
 * never the key.
 */

export type KeyOrigin = 'environment' | '.env.local' | 'none'

export interface KeyReport {
  /** The first characters of the key the server uses (at most 10, fewer for a short key); null without one. */
  prefix: string | null
  source: KeyOrigin
  /** The prefix of a different key in .env.local that the environment's outranks; null when there is none. */
  shadowed: string | null
}

const NAME = 'ANTHROPIC_API_KEY'
const LINE = /^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*(.*?)\s*$/

/** Enough to tell keys apart (sk-ant-usr, sk-ant-api), never enough to matter: at most a quarter of the key. */
function prefixOf(key: string): string {
  return key.slice(0, Math.min(10, Math.floor(key.length / 4)))
}

/** The key .env.local sets, the last line winning as in Node; null when it sets none. */
function fileKey(fileText: string | null): string | null {
  if (fileText === null) return null
  let found: string | null = null
  for (const line of fileText.split(/\r?\n/)) {
    const match = LINE.exec(line)
    if (!match) continue
    const raw = match[1] ?? ''
    const quoted = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.endsWith(raw[0])
    found = quoted ? raw.slice(1, -1) : raw
  }
  return found === '' ? null : found
}

/** envValue: the key in the server's environment; fileText: .env.local's text, null when there is no file. */
export function keySource(envValue: string | undefined, fileText: string | null): KeyReport {
  if (envValue === undefined || envValue === '') return { prefix: null, source: 'none', shadowed: null }
  const inFile = fileKey(fileText)
  if (inFile === envValue) return { prefix: prefixOf(envValue), source: '.env.local', shadowed: null }
  return { prefix: prefixOf(envValue), source: 'environment', shadowed: inFile === null ? null : prefixOf(inFile) }
}

export function keyLine(report: KeyReport): string {
  if (report.prefix === null) return `[key] ${NAME} not set (rules only)`
  const from = report.source === '.env.local' ? '.env.local' : 'the environment'
  const line = `[key] ${NAME} ${report.prefix}... from ${from}`
  return report.shadowed === null
    ? line
    : `${line}; .env.local has another key (${report.shadowed}...) that Node does not apply over the environment: remove the environment variable to use it`
}
