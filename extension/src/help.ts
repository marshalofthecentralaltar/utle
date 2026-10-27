// The help page (docs/ARCHITECTURE.md 30.2.3): what can I say, in Estonian, from src/core/phrases.ts.
// The groups are large dwellable cards; the open one is listed under them, and that list is the
// page's <main>, so "loe ette" reads only the open group (30.2.4). dist/page.js is loaded by
// help.html before this script, as on the new-tab page, because the service worker cannot inject
// into an extension page; page commands arrive as utle-page-run messages (30.2.5).

import { PHRASE_GROUPS, helpGroupForHash, phraseDoes, phraseSaid } from '../../src/core/phrases.ts'
import type { PhraseGroup } from '../../src/core/phrases.ts'
import { STRINGS } from '../../src/core/strings.ts'
import { createDwell } from '../../src/ui/dwell.ts'
import type { ToPage } from './messages.ts'
import { mountStrip } from './strip.ts'

const text = STRINGS.et.strip
const en = STRINGS.en.strip

function setText(id: string, value: string): void {
  const el = document.getElementById(id)
  if (el) el.textContent = value
}

/** Click or a 1 s dwell. */
function dwellable(el: HTMLElement, onFire: () => void): void {
  const dwell = createDwell({ onFire, onChange: (dwelling) => el.classList.toggle('dwelling', dwelling) })
  el.addEventListener('pointerenter', () => dwell.enter())
  el.addEventListener('pointerleave', () => dwell.leave())
  el.addEventListener('click', () => {
    if (dwell.click()) onFire()
  })
}

const cards = new Map<string, HTMLButtonElement>()

function renderCards(): void {
  const nav = document.getElementById('groups')
  if (!nav) return
  nav.replaceChildren()
  for (const group of PHRASE_GROUPS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'choice'
    b.dataset.group = group.id
    const fill = document.createElement('span')
    fill.className = 'fill'
    const name = document.createElement('span')
    name.textContent = group.name
    const sub = document.createElement('span')
    sub.className = 'sub'
    sub.textContent = group.nameEn
    b.append(fill, name, sub)
    dwellable(b, () => {
      if (location.hash !== `#${group.id}`) location.hash = group.id
      else renderOpen(group)
    })
    cards.set(group.id, b)
    nav.append(b)
  }
}

/** The open group: its name, its intro, and each phrase, Estonian first, the meaning, English dim under. */
function renderOpen(group: PhraseGroup): void {
  for (const [id, b] of cards) b.setAttribute('aria-pressed', String(id === group.id))
  const main = document.getElementById('open')
  if (!main) return
  main.dataset.group = group.id
  const h2 = document.createElement('h2')
  h2.textContent = group.name
  const nameEn = document.createElement('div')
  nameEn.className = 'en'
  nameEn.textContent = group.nameEn
  const intro = document.createElement('p')
  intro.id = 'intro'
  intro.textContent = group.intro
  const rows = group.phrases.map((phrase) => {
    const row = document.createElement('div')
    row.className = 'phrase'
    // One paragraph, one sentence for the reader: „keri alla“ või „keri üles“: kerib lehte …
    const said = document.createElement('p')
    said.className = 'said'
    const forms = document.createElement('span')
    forms.className = 'forms'
    forms.textContent = `${phraseSaid(phrase)}:`
    const does = document.createElement('span')
    does.className = 'does'
    does.textContent = ` ${phraseDoes(phrase)}`
    said.append(forms, does)
    // Not a paragraph: the reader leaves the English out.
    const english = document.createElement('div')
    english.className = 'en'
    english.textContent = phrase.en
    row.append(said, english)
    return row
  })
  main.replaceChildren(h2, nameEn, intro, ...rows)
}

/** A group named in the address ("abi kerimine", a card) is scrolled to its heading, so its phrases are in view. */
function fromHash(): void {
  renderOpen(helpGroupForHash(location.hash))
  if (location.hash !== '') document.getElementById('open')?.scrollIntoView({ block: 'start' })
}

document.title = text.helpTitle
setText('title', text.helpTitle)
setText('titleEn', en.helpTitle)
setText('hint', text.helpHint)
renderCards()
fromHash()
// A second "abi vormid" while the page is open changes only the hash.
window.addEventListener('hashchange', fromHash)

mountStrip()

// Page commands from the service worker, for this tab only (as on the new-tab page).
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
  if (myId !== null && myId !== message.tabId) return false
  void myTab.then((id) => {
    if (id === message.tabId) void answer(message, reply)
  })
  return true
})
