import { chromium } from 'playwright'
const out = process.argv[2]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await b.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 2 })
await p.goto('file://' + new URL('.', import.meta.url).pathname + 'poster.html')
await p.waitForTimeout(500)
await p.screenshot({ path: out + '.png', fullPage: false })
await p.pdf({ path: out + '.pdf', width: '1240px', height: '1754px', printBackground: true })
await b.close()
