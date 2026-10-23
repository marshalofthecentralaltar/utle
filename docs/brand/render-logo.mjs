// Renders the two square logos from logo.html: node docs/brand/render-logo.mjs
import { chromium } from 'playwright'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 2200, height: 1120 }, deviceScaleFactor: 1 })
await page.goto(pathToFileURL(join(here, 'logo.html')).href, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.locator('#mark').screenshot({ path: join(here, 'utle-logo-mark.png') })
await page.locator('#word').screenshot({ path: join(here, 'utle-logo-wordmark.png') })
await browser.close()
