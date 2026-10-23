// Renders Ralf's LinkedIn profile banner from profile-banner.html at 2x: node docs/brand/render-profile.mjs
import { chromium } from 'playwright'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1700, height: 500 }, deviceScaleFactor: 2 })
await page.goto(pathToFileURL(join(here, 'profile-banner.html')).href, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.locator('#banner').screenshot({ path: join(here, 'ralf-linkedin-banner.png') })
await browser.close()
