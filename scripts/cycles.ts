/**
 * The import-cycle gate (round 13): runs `madge --circular --extensions ts src extension/src server`
 * and fails on any cycle not in `scripts/cycles.allow.json` (today's 17), and on a listed cycle
 * that is gone (delete its entry). The EDGES, MACHINES and SPEECH lanes shrink the list to empty.
 * A cycle is written from its alphabetically first file, so a rotation found by madge matches.
 *
 * `npx tsx scripts/cycles.ts`
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const cli = join(root, 'node_modules/madge/bin/cli.js')
const args = ['--circular', '--json', '--no-spinner', '--extensions', 'ts', 'src', 'extension/src', 'server']

function isCycleList(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every((cycle) => Array.isArray(cycle) && cycle.every((file) => typeof file === 'string'))
}

/** "a > b > c" from its alphabetically first file. */
function normalise(cycle: readonly string[]): string {
  const files = cycle.map((file) => file.replace(/\\/g, '/'))
  let start = 0
  files.forEach((file, i) => {
    const first = files[start]
    if (first !== undefined && file < first) start = i
  })
  return [...files.slice(start), ...files.slice(0, start)].join(' > ')
}

function found(): string[] {
  let out: string
  try {
    out = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    // madge exits 1 when it finds a cycle; its JSON is still on stdout.
    const stdout = error instanceof Error && 'stdout' in error ? error.stdout : undefined
    if (typeof stdout !== 'string' || stdout.trim() === '') throw error
    out = stdout
  }
  const parsed: unknown = JSON.parse(out)
  if (!isCycleList(parsed)) throw new Error(`madge --json gave something other than a list of cycles: ${out.slice(0, 200)}`)
  return parsed.map(normalise)
}

function main(): void {
  const listed: unknown = JSON.parse(readFileSync(join(root, 'scripts/cycles.allow.json'), 'utf8'))
  if (!Array.isArray(listed) || !listed.every((entry) => typeof entry === 'string')) {
    throw new Error('scripts/cycles.allow.json must be a list of "a > b > c" strings')
  }
  const allowed = new Set(listed.map((entry) => normalise(entry.split(' > '))))
  const cycles = found()
  const seen = new Set(cycles)
  const fresh = cycles.filter((cycle) => !allowed.has(cycle))
  const gone = [...allowed].filter((cycle) => !seen.has(cycle))
  for (const cycle of fresh) console.log(`cycles: NEW ${cycle}`)
  for (const cycle of gone) console.log(`cycles: gone ${cycle} (delete it from scripts/cycles.allow.json)`)
  console.log(`cycles: ${cycles.length} cycles, ${cycles.length - fresh.length} allowed, ${fresh.length} new, ${gone.length} gone from the list`)
  if (fresh.length > 0 || gone.length > 0) process.exitCode = 1
}

main()
