// The new-tab page (docs/ARCHITECTURE.md 21.3). Chrome lets no extension draw on its own new-tab
// page, so the extension provides it: the same strip as every page, and large tiles for the known
// sites. dist/page.js is loaded by newtab.html before this script, because the service worker
// cannot inject into an extension page; page commands arrive as utle-page-run messages instead.

import { SITES } from '../../src/core/browserIntent.ts'
import { STRINGS } from '../../src/core/strings.ts'
import { createDwell } from '../../src/ui/dwell.ts'
import type { ToPage } from './messages.ts'
import { mountStrip } from './strip.ts'

const text = STRINGS.et.strip

/** How each site is written on its tile. A site missing here shows its spoken name. */
const NAMES: Record<string, string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  facebook: 'Facebook',
  gmail: 'Gmail',
  google: 'Google',
  youtube: 'YouTube',
  postimees: 'Postimees',
  delfi: 'Delfi',
  err: 'ERR',
  linkedin: 'LinkedIn',
  'cv.ee': 'CV.ee',
  cvkeskus: 'CV Keskus',
  töötukassa: 'Töötukassa',
}

export interface Tile {
  name: string
  url: string
}

/** One tile per address in SITES, in its order, WhatsApp first. */
export function tiles(whatsappHome: string | null): Tile[] {
  const seen = new Set<string>()
  const list: Tile[] = []
  for (const [spoken, url] of Object.entries(SITES)) {
    if (seen.has(url)) continue
    seen.add(url)
    list.push({ name: NAMES[spoken] ?? spoken.charAt(0).toLocaleUpperCase() + spoken.slice(1), url })
  }
  const wa = list.findIndex((t) => t.url === SITES.whatsapp)
  if (wa > 0) list.unshift(...list.splice(wa, 1))
  const first = list[0]
  if (first && whatsappHome !== null && first.url === SITES.whatsapp) list[0] = { ...first, url: whatsappHome }
  return list
}

function render(list: Tile[]): void {
  const grid = document.getElementById('tiles')
  if (!grid) return
  grid.replaceChildren()
  for (const tile of list) {
    const a = document.createElement('a')
    a.className = 'tile'
    a.href = tile.url
    const fill = document.createElement('span')
    fill.className = 'fill'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = tile.name
    a.append(fill, name)
    const dwell = createDwell({
      onFire: () => location.assign(tile.url),
      onChange: (dwelling) => a.classList.toggle('dwelling', dwelling),
    })
    a.addEventListener('pointerenter', () => dwell.enter())
    a.addEventListener('pointerleave', () => dwell.leave())
    a.addEventListener('click', (event) => {
      if (!dwell.click()) event.preventDefault()
    })
    grid.append(a)
  }
}

document.title = text.newTabTitle
const heading = document.getElementById('title')
if (heading) heading.textContent = text.newTabTitle
const hint = document.getElementById('hint')
if (hint) hint.textContent = text.newTabHint

/** The three example phrases to show at offset `at` of the list, wrapping round. */
export function exampleWindow(list: readonly string[], at: number, count = 3): string[] {
  if (list.length === 0) return []
  const out: string[] = []
  for (let i = 0; i < Math.min(count, list.length); i++) out.push(list[(at + i) % list.length] ?? '')
  return out
}

/** Under the tiles: "Ütle:" and three example phrases, three more every 6 s. */
function examples(): void {
  const p = document.getElementById('examples')
  if (!p) return
  const lead = document.createElement('span')
  lead.className = 'lead'
  lead.textContent = text.examplesLead
  const spans = [0, 1, 2].map(() => {
    const span = document.createElement('span')
    span.className = 'ex'
    return span
  })
  p.replaceChildren(lead, ...spans)
  let at = 0
  const show = (): void => {
    const three = exampleWindow(text.examples, at)
    spans.forEach((span, i) => (span.textContent = three[i] ?? ''))
  }
  show()
  setInterval(() => {
    p.classList.add('fade')
    setTimeout(() => {
      at = (at + 3) % text.examples.length
      show()
      p.classList.remove('fade')
    }, 400)
  }, 6000)
}

render(tiles(null))
examples()
chrome.storage.local.get('messagingHome').then(
  ({ messagingHome }) => {
    if (typeof messagingHome === 'string' && messagingHome !== '') render(tiles(messagingHome))
  },
  () => undefined,
)

mountStrip()

// Page commands from the service worker, for this tab only.
let myId: number | null = null
const myTab: Promise<number | null> = chrome.tabs.getCurrent().then(
  (tab) => (myId = tab?.id ?? -1),
  () => (myId = -1),
)
const answer = async (message: ToPage, reply: (result: unknown) => void): Promise<void> => {
  const utle = globalThis.__utle
  reply(utle ? await utle.run(message.command) : { ok: false, code: 'failed', message: 'The page script is missing.' })
}
chrome.runtime.onMessage.addListener((message: ToPage, _sender, reply) => {
  if (!message || message.type !== 'utle-page-run') return false
  // Only the page whose tab it is answers; the others leave the message to it.
  if (myId !== null && myId !== message.tabId) return false
  void myTab.then((id) => {
    if (id === message.tabId) void answer(message, reply)
  })
  return true
})
