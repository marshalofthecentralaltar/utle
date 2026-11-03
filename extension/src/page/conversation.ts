// Open a conversation by name on a messaging site.

import type { Site } from '../sites.ts'
import { isTextField, visible } from '../box.ts'
import type { PageResult } from './common.ts'
import { fail } from './common.ts'
import { pick } from './items.ts'
import { selectAllIn, typeAtSelection, waitFor } from './messageBox.ts'
import { activate } from './read.ts'

/** openConversation keeps looking this long for the name (lists render after load). */
const FIND_TIMEOUT_MS = 4000
/** On a site whose address does not change, how long a conversation may take to open. */
const OPEN_TIMEOUT_MS = 3000
/** clickItem on a chat row: how long the row itself gets to open the chat before its name is clicked. */
const ROW_REACT_MS = 800

function normalize(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function stemMatch(a: string, b: string): boolean {
  const shorter = Math.min(a.length, b.length)
  let p = 0
  while (p < shorter && a[p] === b[p]) p++
  return p >= 3 && p >= shorter - 2
}

function score(query: string, name: string): number {
  if (!query || !name) return 0
  if (name === query) return 100
  const words = name.split(' ')
  const spoken = query.split(' ')
  if (spoken.every((w) => words.includes(w))) return 80
  if (spoken.every((w) => words.some((x) => x.startsWith(w)))) return 60
  if (name.includes(query)) return 40
  // Estonian case endings change the stem (Jaanile -> jaani, Märdile -> mardi, Peetrile ->
  // peetri): a spoken word matches a name word sharing a prefix of at least 3 letters that is
  // at least all but the last two letters of the shorter word.
  if (spoken.every((w) => words.some((x) => stemMatch(w, x)))) return 20
  return 0
}

function nameOf(el: HTMLElement, site: Site | null): string {
  if (site?.rowName && site.conversationRows && el.matches(site.conversationRows)) {
    const titled = el.querySelector(site.rowName)
    const title = titled?.getAttribute('title')
    if (title && title.trim()) return title
  }
  const label = el.getAttribute('aria-label')
  if (label && label.trim()) return label
  const text = (el.innerText || el.textContent || '').trim()
  return text.split('\n')[0] ?? ''
}

const GENERIC_CANDIDATES = 'a[href], [role="link"], li, [role="listitem"], [role="row"], [role="option"]'

/** One pass: the best visible match, and whether a conversation list is on screen at all. */
function findConversation(query: string, site: Site | null): { best: HTMLElement | null; listSeen: boolean } {
  const own = site ? site.conversationRows ?? site.conversationLinks ?? null : null
  const selectors = own ? [own, GENERIC_CANDIDATES] : [GENERIC_CANDIDATES]
  let listSeen = site?.chatList ? document.querySelector(site.chatList) !== null : false
  for (const [i, selector] of selectors.entries()) {
    let best: HTMLElement | null = null
    let bestScore = 0
    let bestLength = Infinity
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (!visible(el)) continue
      if (i === 0 && own) listSeen = true
      const candidate = normalize(nameOf(el, site))
      const s = score(query, candidate)
      if (s > bestScore || (s === bestScore && s > 0 && candidate.length < bestLength)) {
        best = el
        bestScore = s
        bestLength = candidate.length
      }
    }
    if (best) return { best, listSeen }
    // On a site with its own rows, the generic search would match messages and buttons.
    if (site?.conversationRows) break
  }
  return { best: null, listSeen }
}

async function search(name: string, site: Site): Promise<boolean> {
  if (!site.searchField) return false
  const field = document.querySelector<HTMLElement>(site.searchField)
  if (!field || !isTextField(field)) return false
  await selectAllIn(field)
  await typeAtSelection(field, name)
  return true
}

export async function openConversation(name: string, site: Site | null): Promise<PageResult> {
  const query = normalize(name)
  if (!query) return fail('not_found', 'No name was given.')
  let last: { best: HTMLElement | null; listSeen: boolean } = { best: null, listSeen: false }
  const look = (): HTMLElement | null => {
    last = findConversation(query, site)
    return last.best
  }
  // On a site with a search field, look briefly first, then search.
  const searchable = site?.searchField !== undefined
  let best = await waitFor(look, searchable ? 1200 : FIND_TIMEOUT_MS)
  if (!best && site && searchable && (await search(name, site))) best = await waitFor(look, FIND_TIMEOUT_MS)
  if (!best) {
    if (site && !last.listSeen) return fail('not_found', 'There is no conversation list on this page. The site may need logging in.')
    return fail('not_found', `No conversation called "${name}" is visible here.`)
  }
  if (site?.conversationRows && best.matches(site.conversationRows)) return openRow(best, site)
  // A list item is not clickable itself; click the link inside it when there is one.
  const clickable = best.matches('a[href], [role="link"], [role="button"]') ? best : best.querySelector<HTMLElement>('a[href], [role="link"], [role="button"]') ?? best
  const href = clickable instanceof HTMLAnchorElement ? clickable.href : ''
  activate(clickable)
  // background.ts waits for the address to change and strips href before answering.
  return { ok: true, href }
}

/** True once the conversation called wanted is open: its composer is visible and its header says the name. */
function conversationOpen(site: Site, wanted: string): true | null {
  const composer = document.querySelector<HTMLElement>(site.composer)
  if (!composer || !visible(composer)) return null
  if (!site.openChatName) return true
  const header = document.querySelector(site.openChatName)
  // When the header is not found (an unverified selector), the composer alone is taken as proof.
  if (!header) return true
  return normalize(header.getAttribute('title') ?? header.textContent) === wanted ? true : null
}

/** The chat is open: the next words belong in its composer, which is armed. */
function settleInComposer(site: Site): PageResult {
  const composer = document.querySelector<HTMLElement>(site.composer)
  if (composer) pick(composer)
  return { ok: true, href: '', settled: true }
}

/** A chat row that opens without changing the address: wait here for its composer and its name. */
export async function openRow(row: HTMLElement, site: Site): Promise<PageResult> {
  const wanted = normalize(nameOf(row, site))
  const target = row.querySelector<HTMLElement>(site.rowName ?? 'span[title]') ?? row
  activate(target)
  const opened = await waitFor(() => conversationOpen(site, wanted), OPEN_TIMEOUT_MS)
  if (!opened) return fail('failed', 'The conversation did not open, so nothing will be typed. Try again or use the numbers.')
  return settleInComposer(site)
}

/** clickItem on a chat row: the row itself first; when the chat does not open, the name inside it. */
export async function clickRow(row: HTMLElement, site: Site): Promise<PageResult> {
  const wanted = normalize(nameOf(row, site))
  activate(row)
  let opened = await waitFor(() => conversationOpen(site, wanted), ROW_REACT_MS)
  if (!opened) {
    const name = row.querySelector<HTMLElement>(site.rowName ?? 'span[title]')
    if (name) activate(name)
    opened = await waitFor(() => conversationOpen(site, wanted), OPEN_TIMEOUT_MS)
  }
  if (!opened) return fail('failed', 'The conversation did not open. Try again or use the numbers.')
  return settleInComposer(site)
}
