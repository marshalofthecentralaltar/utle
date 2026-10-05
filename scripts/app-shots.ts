/**
 * Proof for the M4 app lane: screenshots and recorded bridge commands from the real page.
 * Needs the dev server on 5182 (npx vite --port 5182 --strictPort). The message steps call the
 * real model through the dev server: two requests, a few tenths of a cent.
 *
 *   npx tsx scripts/app-shots.ts            all steps
 *   npx tsx scripts/app-shots.ts demo       only the scripted demo
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'

const BASE = process.env.UTLE_URL ?? 'http://localhost:5182'
const OUT = 'docs/proof'
const VIEWPORT = { width: 1280, height: 800 }

/** A page-side stand-in for the extension: records every command (pings apart) and answers success. */
const stub = (openConversationMs: number): string => `
  window.__bridge = [];
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'utle-app') return;
    if (data.command.kind !== 'ping') window.__bridge.push(data.command);
    const result = data.command.kind === 'openConversation'
      ? { ok: true, tab: { title: data.command.name, url: 'https://www.messenger.com/' } }
      : { ok: true };
    const delay = data.command.kind === 'openConversation' ? ${openConversationMs} : 50;
    setTimeout(() => window.postMessage({ source: 'utle-extension', id: data.id, result }, window.location.origin), delay);
  });
`
const STUB = stub(50)

/** A speech recogniser that starts and stops and never hears anything, so the microphone control can be driven. */
const QUIET_MIC = `
  class QuietRecognition {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1;
      this.onresult = null; this.onerror = null; this.onend = null; this.onstart = null; this.onaudiostart = null; }
    start() {} stop() {} abort() {}
    addEventListener() {} removeEventListener() {}
  }
  window.SpeechRecognition = QuietRecognition;
  window.webkitSpeechRecognition = QuietRecognition;
`

async function freshPage(browser: Browser, ...scripts: string[]): Promise<Page> {
  return sizedPage(browser, VIEWPORT, ...scripts)
}

async function sizedPage(browser: Browser, viewport: { width: number; height: number }, ...scripts: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport, locale: 'et-EE' })
  for (const script of scripts) await context.addInitScript(script)
  return context.newPage()
}

async function understood(page: Page): Promise<string> {
  return (await page.locator('.fixed p').nth(1).innerText()).replace(/\s+/g, ' ').trim()
}

async function typeLine(page: Page, text: string): Promise<void> {
  await page.fill('#typed', text)
  await page.press('#typed', 'Enter')
}

/** Waits until the page is not thinking (the prompt is no longer "Hetk."). */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(`!document.querySelector('.fixed')?.textContent?.includes('Hetk.')`, undefined, { timeout: 30_000 })
}

async function chrome(page: Page): Promise<string> {
  const header = await page.locator('header').innerText()
  const bar = await page.locator('.fixed').innerText()
  const placeholder = (await page.getAttribute('#typed', 'placeholder')) ?? ''
  const notices = await page.locator('main ~ *, ul').first().innerText().catch(() => '')
  return [header, bar, placeholder, notices].join(' | ').replace(/\s+/g, ' ')
}

async function languages(browser: Browser): Promise<void> {
  const page = await freshPage(browser, QUIET_MIC)
  await page.goto(BASE)
  await page.waitForSelector('[data-control="microphone"]')
  await page.screenshot({ path: `${OUT}/app-et.png` })
  console.log(`[1] Estonian chrome: ${await chrome(page)}`)
  await page.getByRole('button', { name: 'English' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/app-en.png` })
  console.log(`[1] English chrome: ${await chrome(page)}`)
  await page.context().close()
}

/** At a narrow width: nothing scrolls sideways, and every control showing is at least 96 x 96 and on screen. */
async function layout(page: Page, state: string): Promise<void> {
  const viewport = page.viewportSize()
  if (!viewport) return
  const scrollWidth = await page.evaluate<number>('document.documentElement.scrollWidth')
  const parts = [`scrollWidth=${scrollWidth} (<= ${viewport.width}: ${scrollWidth <= viewport.width})`]
  let ok = scrollWidth <= viewport.width
  for (const control of ['microphone', 'yes', 'no']) {
    const locator = page.locator(`[data-control="${control}"]`)
    if ((await locator.count()) === 0) continue
    const box = await locator.boundingBox()
    if (!box) continue
    const big = box.width >= 96 && box.height >= 96
    const inside = box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height
    ok = ok && big && inside
    parts.push(`${control} ${box.width}x${box.height} at ${Math.round(box.x)},${Math.round(box.y)} big=${big} inside=${inside}`)
  }
  console.log(`[440] ${state}: ${parts.join('; ')} -> ${ok ? 'PASS' : 'FAIL'}`)
  if (!ok) process.exitCode = 1
}

async function message(browser: Browser, width = VIEWPORT.width): Promise<void> {
  const narrow = width < VIEWPORT.width
  const tag = narrow ? '440' : '6'
  const shot = (name: string): string => (narrow ? `${OUT}/app-440-${name}.png` : `${OUT}/app-${name}.png`)
  // The stub answers openConversation after 4 s, as the real extension may while it loads the list.
  const page = await sizedPage(browser, narrow ? { width, height: 900 } : VIEWPORT, stub(4000), QUIET_MIC)
  await page.goto(BASE)
  await page.waitForSelector('#typed')
  if (narrow) {
    await page.screenshot({ path: shot('et') })
    await layout(page, 'fresh')
    // The bar is taller at this width: the last paragraph must still scroll clear of it.
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
    await page.waitForTimeout(300)
    const clear = await page.evaluate<string>(
      `(() => { const rows = document.querySelectorAll('[aria-label="Dokument"] > div'); const last = rows[rows.length - 1].getBoundingClientRect(); const bar = document.querySelector('.fixed').getBoundingClientRect(); return Math.round(last.bottom) + ' ' + Math.round(bar.top) })()`,
    )
    const [lastBottom, barTop] = clear.split(' ').map(Number)
    console.log(`[440] scrolled to the end: last paragraph ends at ${lastBottom}, bar starts at ${barTop} -> ${(lastBottom ?? 0) <= (barTop ?? 0) ? 'PASS' : 'FAIL'}`)
    await page.evaluate('window.scrollTo(0, 0)')
  }

  const lines = ['Kirjuta Marile, et ma jõuan homme kell kolm', 'Mitte kolm, vaid neli', 'jah']
  for (const line of lines) {
    await typeLine(page, line)
    await page.waitForTimeout(150)
    await settled(page)
    console.log(`[${tag}] "${line}" -> ${await understood(page)}`)
  }
  await page.screenshot({ path: shot('draft') })
  if (narrow) await layout(page, 'draft')

  await typeLine(page, 'saada')
  await page.waitForSelector('[data-control="yes"]')
  console.log(`[${tag}] "saada" -> ${await understood(page)}`)
  await page.screenshot({ path: shot('send-confirm') })
  if (narrow) {
    await layout(page, 'send-confirm')
    await page.context().close()
    return
  }

  const started = Date.now()
  await typeLine(page, 'jah')
  await page.waitForTimeout(2000)
  console.log(`[6] 2 s after "jah", openConversation not answered yet -> ${await understood(page)}`)
  await page.waitForFunction(`document.querySelector('.fixed')?.textContent?.includes('Saadetud')`, undefined, { timeout: 30_000 })
  console.log(`[6] after ${((Date.now() - started) / 1000).toFixed(1)} s -> ${await understood(page)}`)
  const commands = await page.evaluate<unknown>('window.__bridge')
  console.log(`[6] recorded bridge commands: ${JSON.stringify(commands)}`)

  // Proof 7: one deliberately unclear Estonian utterance through the interpreter.
  await typeLine(page, 'noh see seal üleval vist')
  await page.waitForTimeout(150)
  await settled(page)
  console.log(`[7] unclear -> ${await understood(page)}`)
  await page.context().close()
}

async function dwell(browser: Browser): Promise<void> {
  const page = await freshPage(browser, QUIET_MIC)
  await page.goto(BASE)
  const mic = page.locator('[data-control="microphone"]')
  await mic.waitFor()
  const box = await mic.boundingBox()
  const yesNoNote = 'yes and no are measured in the send-confirm step'
  console.log(`[8] microphone box: ${box?.width} x ${box?.height} (${yesNoNote})`)
  const before = await mic.getAttribute('data-listening')
  await page.mouse.move(10, 10)
  await mic.hover()
  await page.waitForTimeout(550)
  const dwelling = await mic.getAttribute('data-dwelling')
  await page.screenshot({ path: `${OUT}/app-mic.png` })
  await page.waitForTimeout(750)
  const after = await mic.getAttribute('data-listening')
  console.log(`[8] data-listening before=${before} after 1.3 s hover=${after}; mid-dwell data-dwelling=${dwelling}; no click was sent`)
  if (before === after) throw new Error('dwell did not toggle the microphone')
  await page.waitForTimeout(1500)
  console.log(`[8] still hovering 1.5 s later: data-listening=${await mic.getAttribute('data-listening')} (no refire)`)
  await page.context().close()
}

async function yesNoBoxes(browser: Browser): Promise<void> {
  const page = await freshPage(browser, STUB, QUIET_MIC)
  await page.goto(BASE)
  await typeLine(page, 'uus sõnum Marile')
  await typeLine(page, 'tulen kohe')
  const yes = await page.locator('[data-control="yes"]').boundingBox()
  const no = await page.locator('[data-control="no"]').boundingBox()
  console.log(`[8] yes box ${yes?.width} x ${yes?.height}, no box ${no?.width} x ${no?.height}`)
  await page.context().close()
}

async function demo(browser: Browser): Promise<void> {
  const page = await freshPage(browser, STUB)
  await page.goto(`${BASE}/?voice=demo`)
  await page.waitForFunction(`document.querySelector('.fixed')?.textContent?.includes('Puhkan.')`, undefined, { timeout: 120_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/app-demo-end.png` })
  const commands = await page.evaluate<unknown>('window.__bridge')
  console.log(`[9] demo ended: ${await understood(page)}`)
  console.log(`[9] recorded bridge commands: ${JSON.stringify(commands)}`)
  await page.context().close()
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    const only = process.argv[2]
    if (!only || only === 'languages') await languages(browser)
    if (!only || only === 'message') await message(browser)
    if (!only || only === 'narrow') await message(browser, 440)
    if (!only || only === 'dwell') {
      await dwell(browser)
      await yesNoBoxes(browser)
    }
    if (!only || only === 'demo') await demo(browser)
  } finally {
    await browser.close()
  }
}

await main()
