/**
 * Loads an unpacked extension folder in Playwright's Chromium the way extension/test/run.ts does,
 * and serves the suite's stand-in pages (extension/test/fixtures/) on one port: the fake Ütle page at
 * http://localhost:<port>/fixtures/utle.html, the target pages at http://127.0.0.1:<port>/fixtures.
 * Used by scripts/store-shots.ts and scripts/pack-check.ts (ARCHITECTURE 30.6).
 */
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { BrowserContext, Page, Worker } from 'playwright'

/* The browser's API, as far as the callbacks below use it (this file is compiled without the chrome and DOM types). */
declare const chrome: {
  storage: { local: { set: (items: Record<string, unknown>) => Promise<void> } }
  windows: {
    create: (options: { url: string; focused: boolean }) => Promise<unknown>
    getAll: (options: { populate: boolean }) => Promise<Array<{ id?: number; tabs?: Array<{ url?: string }> }>>
  }
}
declare const window: { bridge: (command: unknown) => Promise<BridgeResult> }

export const repoRoot =resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testDir = join(repoRoot, 'extension', 'test')

export type BridgeResult = { ok: true; hints?: number; box?: { text: string } } | { ok: false; code: string; message: string } | 'timeout'

export interface Harness {
  ctx: BrowserContext
  sw: Worker
  server: Server
  /** The target pages' base, e.g. http://127.0.0.1:5185/fixtures. */
  base: string
  close: () => Promise<void>
}

export interface Driver {
  /** Sends one BrowserCommand through the localhost relay, as the suite does. */
  send: (command: unknown) => Promise<BridgeResult>
  /** The window that commands act on (not the fake Ütle page's own window). */
  targetWindowId: number
}

function serve(port: number): Promise<Server> {
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webm': 'video/webm' }
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    const file = resolve(testDir, path === '/fixtures/watch' ? './fixtures/video.html' : `.${path}`)
    if (!file.startsWith(testDir)) {
      res.writeHead(403).end()
      return
    }
    readFile(file).then(
      (body) => res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body),
      () => res.writeHead(404).end('not found'),
    )
  })
  return new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(port, () => ok(server))
  })
}

export async function waitUntil(test: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await test()) return true
    await new Promise((ok) => setTimeout(ok, 200))
  }
  return test()
}

/**
 * A fresh profile with only `extensionDir` loaded, headed (headless Chromium crashes on the
 * extension's service worker). `viewport` fixed at 1280×800 and scale 1 when given, so a viewport
 * screenshot is exactly that size.
 */
export async function launch(extensionDir: string, port: number, viewport: { width: number; height: number } | null): Promise<Harness> {
  const server = await serve(port)
  const profile = await mkdtemp(join(tmpdir(), 'utle-ship-'))
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: false,
    ...(viewport ? { viewport, deviceScaleFactor: 1 } : { viewport: null }),
    locale: 'et-EE',
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  })
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
  await sw.evaluate((url) => chrome.storage.local.set({ utleUrl: url }), `http://localhost:${port}/fixtures/utle.html`)
  return {
    ctx,
    sw,
    server,
    base: `http://127.0.0.1:${port}/fixtures`,
    close: async () => {
      await ctx.close()
      server.close()
    },
  }
}

/** Opens the fake Ütle page in a window of its own, so the first window is the target. */
export async function driver(h: Harness, port: number): Promise<Driver> {
  const utleUrl = `http://localhost:${port}/fixtures/utle.html`
  const opened = h.ctx.waitForEvent('page', (p) => p.url().startsWith(utleUrl))
  await h.sw.evaluate(async (url) => {
    await chrome.windows.create({ url, focused: false })
  }, utleUrl)
  const utle: Page = await opened
  await utle.waitForLoadState('load')
  const targetWindowId = await h.sw.evaluate(async (url) => {
    const all = await chrome.windows.getAll({ populate: true })
    return all.find((w) => !(w.tabs ?? []).some((t) => t.url === url))?.id ?? -1
  }, utleUrl)
  const send = async (command: unknown): Promise<BridgeResult> => utle.evaluate((c) => window.bridge(c), command)
  return { send, targetWindowId }
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.toString('latin1', 12, 16) !== 'IHDR') throw new Error('not a PNG')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}
