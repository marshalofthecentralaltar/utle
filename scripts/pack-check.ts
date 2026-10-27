/**
 * The check of the store packet (ARCHITECTURE 30.6): builds the zip, unpacks it into a temporary
 * folder, loads that folder (not extension/) as an unpacked extension on a fresh profile, and checks
 * that the welcome page opens on install and that "abi" opens the help page. Saves
 * docs/proof/r9-pack-welcome.png from the unpacked zip.
 *
 *   npx tsx scripts/pack-check.ts
 *
 * Uses port 5185 (PACK_CHECK_PORT to change it).
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { driver, launch, repoRoot, waitUntil } from './ext-harness.ts'
import { pack } from './pack.ts'
import { initialInpage, inpageStep } from '../src/core/inpage.ts'

/* The browser's API, as far as the callbacks below use it (this file is compiled without the chrome types). */
declare const chrome: {
  runtime: { getURL: (path: string) => string; id: string }
  tabs: { query: (q: Record<string, never>) => Promise<Array<{ url?: string; pendingUrl?: string }>> }
}

const PORT = Number(process.env.PACK_CHECK_PORT ?? 5185)

/** Unpacks a zip's stored and deflated entries (all the pack script writes) into `dir`; returns the names. */
function unzip(zip: Buffer, dir: string): string[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error('no end of central directory')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central directory entry')
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const extra = zip.readUInt16LE(at + 30)
    const comment = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + extra + comment
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const raw = zip.subarray(start, start + size)
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null
    if (data === null) throw new Error(`${name}: compression method ${method}`)
    if (name.includes('..') || name.startsWith('/')) throw new Error(`${name}: unsafe path`)
    const target = join(dir, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
    names.push(name)
  }
  return names
}

async function main(): Promise<void> {
  let failures = 0
  const check = (label: string, pass: boolean, detail = ''): void => {
    if (!pass) failures++
    console.log(`${pass ? 'PASS' : 'FAIL'}  pack  ${label}${detail ? `  ${detail}` : ''}`)
  }
  const zipPath = await pack()
  const dir = mkdtempSync(join(tmpdir(), 'utle-unpacked-'))
  const names = unzip(readFileSync(zipPath), dir)
  check(`unpacked ${zipPath} into a temporary folder`, names.includes('manifest.json'), `${names.length} files in ${dir}`)

  const h = await launch(dir, PORT, { width: 1280, height: 800 })
  try {
    const loadedFrom = await h.sw.evaluate(() => chrome.runtime.getURL(''))
    const welcomeBase = await h.sw.evaluate(() => chrome.runtime.getURL('welcome.html'))
    const opened = await waitUntil(async () => h.ctx.pages().some((p) => p.url().startsWith(welcomeBase)), 8000)
    const welcome = h.ctx.pages().find((p) => p.url().startsWith(welcomeBase))
    let heading = ''
    if (welcome) {
      await welcome.waitForLoadState('load')
      await welcome.waitForTimeout(1500)
      heading = (await welcome.locator('h1').first().textContent()) ?? ''
      await welcome.evaluate('window.scrollTo(0, 0)')
      await welcome.bringToFront()
      await welcome.screenshot({ path: join(repoRoot, 'docs/proof/r9-pack-welcome.png') })
    }
    check('install opens welcome.html from the unpacked zip', opened && heading === 'Alustamine', `${welcome?.url() ?? '(none)'} h1=${JSON.stringify(heading)} extension=${loadedFrom}`)
    await welcome?.close()

    const first = h.ctx.pages()[0] ?? (await h.ctx.newPage())
    await first.goto(`${h.base}/page-one.html`)
    const d = await driver(h, PORT)
    const command = inpageStep(initialInpage('et'), 'abi', { present: false, text: '', armed: false }).commands[0]
    const r = await d.send(command)
    const helpBase = await h.sw.evaluate(() => chrome.runtime.getURL('help.html'))
    const helpOpen = await waitUntil(async () => h.ctx.pages().some((p) => p.url().startsWith(helpBase)), 5000)
    const help = h.ctx.pages().find((p) => p.url().startsWith(helpBase))
    await help?.waitForSelector('#open h2', { timeout: 5000 }).catch(() => undefined)
    const group = (await help?.locator('#open h2').textContent().catch(() => '')) ?? ''
    check('"abi" opens help.html, the first group (Sõnumid) open', r !== 'timeout' && r.ok && helpOpen && group === 'Sõnumid', `command=${JSON.stringify(command)} result=${JSON.stringify(r)} url=${help?.url() ?? '(none)'} group=${JSON.stringify(group)}`)
  } finally {
    await h.close()
  }
  console.log(failures === 0 ? '\nPACK PASS' : `\n${failures} FAILED`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
