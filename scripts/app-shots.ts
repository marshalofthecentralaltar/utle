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

/** A page-side stand-in for the extension: records every BridgeRequest and answers success. */
const STUB = `
  window.__bridge = [];
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'utle-app') return;
    window.__bridge.push(data.command);
    const result = data.command.kind === 'openConversation'
      ? { ok: true, tab: { title: data.command.name, url: 'https://www.messenger.com/' } }
      : { ok: true };
    setTimeout(() => window.postMessage({ source: 'utle-extension', id: data.id, result }, window.location.origin), 50);
  });
`

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
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'et-EE' })
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

async function message(browser: Browser): Promise<void> {
  const page = await freshPage(browser, STUB, QUIET_MIC)
  await page.goto(BASE)
  await page.waitForSelector('#typed')

  const lines = [
    'Kirjuta Marile, et ma jõuan homme kell kolm',
    'Mitte kolm, vaid neli',
    'jah',
  ]
  for (const line of lines) {
    await typeLine(page, line)
    await page.waitForTimeout(150)
    await settled(page)
    console.log(`[6] "${line}" -> ${await understood(page)}`)
  }
  await page.screenshot({ path: `${OUT}/app-draft.png` })

  await typeLine(page, 'saada')
  await page.waitForSelector('[data-control="yes"]')
  console.log(`[6] "saada" -> ${await understood(page)}`)
  await page.screenshot({ path: `${OUT}/app-send-confirm.png` })

  await typeLine(page, 'jah')
  await page.waitForFunction('window.__bridge.length >= 2')
  await page.waitForTimeout(300)
  console.log(`[6] "jah" -> ${await understood(page)}`)
  const commands = await page.evaluate<unknown>('window.__bridge')
  console.log(`[6] recorded bridge commands: ${JSON.stringify(commands)}`)

  // Proof 7: one deliberately unclear Estonian utterance through the real model.
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
