/**
 * Round 10 (#5) defect 2: what readPage costs, this working tree against a base commit.
 *
 *   npx tsx scripts/readpage-timing.ts [base-sha]      (default 2bb7398, the round's base)
 *
 * Bundles extension/src/page.ts from the working tree and from the base (git archive into a temp
 * folder), loads each page in Chromium without the extension, and times __utle.run({ kind:
 * 'readPage' }) inside the page: one fresh load per run, five runs, base and branch interleaved,
 * the median. Pages: the two news fixtures, plus two generated heavy pages (2,000 links under one
 * parent; 2,000 list rows of one link each), since the fixtures are small stand-ins.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? '2bb7398'
/** UTLE_RUNS=<n> for more runs when a page's few milliseconds are within the noise. */
const RUNS = Number(process.env.UTLE_RUNS ?? '5') || 5

const temp = mkdtempSync(join(tmpdir(), 'utle-readpage-'))

async function bundle(root: string): Promise<string> {
  const out = await build({ entryPoints: [join(root, 'extension/src/page.ts')], bundle: true, format: 'iife', target: 'chrome120', charset: 'utf8', write: false, logLevel: 'error' })
  const file = out.outputFiles[0]
  if (!file) throw new Error(`no bundle for ${root}`)
  return file.text
}

function heavyPage(name: string, body: string): string {
  const path = join(temp, name)
  writeFileSync(path, `<!doctype html><html lang="et"><head><meta charset="utf-8"><title>${name}</title></head><body>${body}</body></html>`)
  return pathToFileURL(path).href
}

const links = (n: number, wrap: (i: number) => string): string => Array.from({ length: n }, (_, i) => wrap(i)).join('\n')

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}

async function main(): Promise<void> {
  const baseRoot = join(temp, 'base')
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'extension/src', 'src'], { cwd: repo, encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.ts'))
  for (const file of files) {
    const target = join(baseRoot, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, execFileSync('git', ['show', `${base}:${file}`], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }))
  }
  const bundles = { base: await bundle(baseRoot), branch: await bundle(repo) }

  const fixtures = join(repo, 'extension/test/fixtures')
  const pages: Array<[string, string]> = [
    ['real-delfi.html', pathToFileURL(join(fixtures, 'real-delfi.html')).href],
    ['real-postimees.html', pathToFileURL(join(fixtures, 'real-postimees.html')).href],
    ['heavy: 2000 links in one div', heavyPage('flat.html', `<nav>${links(2000, (i) => `<a href="/a/${i}">Uudis number ${i} pealkiri</a>`)}</nav>`)],
    ['heavy: 2000 list rows', heavyPage('list.html', `<ul>${links(2000, (i) => `<li><a href="/b/${i}">Uudis number ${i} pealkiri</a></li>`)}</ul>`)],
  ]

  const browser = await chromium.launch({ channel: 'chromium', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.addInitScript(() => {
      const w = globalThis as unknown as { chrome?: unknown }
      w.chrome = { runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => undefined } } }
    })
    console.log(`readPage ms, median of ${RUNS} fresh loads; base ${base} against the working tree`)
    console.log('| page | items | base ms (runs) | branch ms (runs) | branch / base |')
    console.log('|---|---|---|---|---|')
    for (const [name, url] of pages) {
      const times: Record<'base' | 'branch', number[]> = { base: [], branch: [] }
      let items = 0
      for (let run = 0; run < RUNS; run++) {
        for (const which of ['base', 'branch'] as const) {
          await page.goto(url, { waitUntil: 'load' })
          await page.addScriptTag({ content: bundles[which] })
          const r = await page.evaluate(async () => {
            const utle = (globalThis as unknown as { __utle: { run(c: unknown): Promise<{ ok: boolean; page?: { items: unknown[] } }> } }).__utle
            const t0 = performance.now()
            const result = await utle.run({ kind: 'readPage', site: null })
            return { ms: performance.now() - t0, ok: result.ok, items: result.page?.items.length ?? -1 }
          })
          if (!r.ok) throw new Error(`readPage failed on ${name} (${which})`)
          times[which].push(r.ms)
          items = r.items
        }
      }
      const b = median(times.base)
      const n = median(times.branch)
      const fmt = (xs: number[]): string => xs.map((x) => x.toFixed(1)).join(', ')
      console.log(`| ${name} | ${items} | ${b.toFixed(1)} (${fmt(times.base)}) | ${n.toFixed(1)} (${fmt(times.branch)}) | ${(n / b).toFixed(2)} |`)
    }
  } finally {
    await browser.close()
    rmSync(temp, { recursive: true, force: true })
  }
}

await main()
