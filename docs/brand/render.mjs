// Renders the LinkedIn images from linkedin.html at 2x: node docs/brand/render.mjs
// Needs Playwright's Chromium and the network (the fonts come from Google Fonts).
import { chromium } from 'playwright'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 2200 }, deviceScaleFactor: 2 })
await page.goto(pathToFileURL(join(here, 'linkedin.html')).href, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
for (const [id, name] of [['square', 'square'], ['wide', 'banner']]) {
  await page.locator('#' + id).screenshot({ path: join(here, `utle-linkedin-${name}.png`) })
}
await browser.close()
