import type { BrowserCommand } from '../browser/protocol.ts'
import { spokenNumber } from './quickReply.ts'

/**
 * Browser commands answered without the model and without yes (docs/ARCHITECTURE.md 20.3).
 * Whole utterances only. The reducer tries document commands first, so an utterance that means
 * something in the document never reaches this table.
 */

/** The message of a failed result when the extension did not answer a command in time. */
export const BRIDGE_TIMED_OUT = 'timed_out'

export const SITES: Record<string, string> = {
  whatsapp: 'https://web.whatsapp.com/',
  'whats app': 'https://web.whatsapp.com/',
  vatsap: 'https://web.whatsapp.com/',
  vatsapp: 'https://web.whatsapp.com/',
  whatsup: 'https://web.whatsapp.com/',
  'whats up': 'https://web.whatsapp.com/',
  votsap: 'https://web.whatsapp.com/',
  votsapp: 'https://web.whatsapp.com/',
  messenger: 'https://www.messenger.com/',
  facebook: 'https://www.facebook.com/',
  'face book': 'https://www.facebook.com/',
  gmail: 'https://mail.google.com/',
  google: 'https://www.google.com/',
  youtube: 'https://www.youtube.com/',
  'you tube': 'https://www.youtube.com/',
  postimees: 'https://www.postimees.ee/',
  // The stem changes before a case ending (postimehesse); section 21.3.
  postimehe: 'https://www.postimees.ee/',
  delfi: 'https://www.delfi.ee/',
  err: 'https://www.err.ee/',
  linkedin: 'https://www.linkedin.com/',
  'linked in': 'https://www.linkedin.com/',
  'cv.ee': 'https://www.cv.ee/',
  cvkeskus: 'https://www.cvkeskus.ee/',
  'cv keskus': 'https://www.cvkeskus.ee/',
  töötukassa: 'https://www.tootukassa.ee/',
}

const FIXED: Record<string, BrowserCommand> = {}
function phrases(command: BrowserCommand, ...list: string[]): void {
  for (const phrase of list) FIXED[phrase] = command
}

phrases({ kind: 'newTab' }, 'ava uus vaheleht', 'uus vaheleht', 'ava vaheleht', 'new tab', 'open a new tab', 'open new tab')
phrases(
  { kind: 'closeTab' },
  'sulge vaheleht',
  'sulge see vaheleht',
  'pane vaheleht kinni',
  'close tab',
  'close the tab',
  'close this tab',
)
phrases({ kind: 'switchTab', to: 'next' }, 'järgmine vaheleht', 'mine järgmisele vahelehele', 'next tab')
phrases({ kind: 'switchTab', to: 'previous' }, 'eelmine vaheleht', 'mine eelmisele vahelehele', 'previous tab')
phrases(
  { kind: 'history', direction: 'back' },
  'mine tagasi',
  'tagasi',
  'eelmine leht',
  'mine eelmisele lehele',
  'page back',
  'go back a page',
  'back a page',
  'previous page',
  'browser back',
)
phrases(
  { kind: 'history', direction: 'forward' },
  'mine edasi',
  'edasi',
  'järgmine leht',
  'go forward',
  'forward',
  'page forward',
  'next page',
)
phrases(
  { kind: 'reload' },
  'laadi uuesti',
  'lae uuesti',
  'laadi leht uuesti',
  'värskenda',
  'värskenda lehte',
  'reload',
  'refresh',
  'reload the page',
  'refresh the page',
)
phrases({ kind: 'scroll', direction: 'down' }, 'keri alla', 'keri allapoole', 'scroll down')
phrases({ kind: 'scroll', direction: 'up' }, 'keri üles', 'keri ülespoole', 'scroll up')
phrases({ kind: 'scroll', direction: 'top' }, 'lehe algusesse', 'keri algusesse', 'scroll to the top', 'scroll to top')
phrases({ kind: 'scroll', direction: 'bottom' }, 'lehe lõppu', 'keri lõppu', 'scroll to the bottom', 'scroll to bottom')
phrases({ kind: 'showHints' }, 'näita numbreid', 'näita numbrid', 'show numbers', 'show the numbers', 'show hints')
phrases({ kind: 'hideHints' }, 'peida numbrid', 'peida numbrid ära', 'hide numbers', 'hide the numbers', 'hide hints')

const ORDINALS: Record<string, number> = {
  esimene: 1, teine: 2, kolmas: 3, neljas: 4, viies: 5, kuues: 6, seitsmes: 7, kaheksas: 8, üheksas: 9, kümnes: 10,
}
/** "Mine kolmandale vahelehele": the allative of the ordinal. */
const ORDINALS_TO: Record<string, number> = {
  esimesele: 1, teisele: 2, kolmandale: 3, neljandale: 4, viiendale: 5, kuuendale: 6, seitsmendale: 7,
  kaheksandale: 8, üheksandale: 9, kümnendale: 10,
}

/** Lowercase, punctuation dropped except dots inside an address; "punkt" or "dot" between words is a dot. */
export function cleanForBrowser(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+(?:punkt|dot)\s+/g, '.')
    .replace(/[^\p{L}\p{N}\s.]/gu, '')
    .replace(/\.+(?=\s|$)/g, '')
    .replace(/(^|\s)\.+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const ADDRESS = /^(?:www\.)?[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[a-z]{2,}$/u

/** Estonian case endings taken off a site name (section 21.3), longest first. */
const ENDINGS = ['isse', 'sse', 'ile', 'le', 'is', 'it', 'i', 's', 't']

/**
 * The address for a site name or a bare domain, or null. key is the site table's name when an
 * Estonian case ending had to come off first ("whatsappi" is whatsapp), else null.
 */
function siteUrl(name: string): { url: string; key: string | null } | null {
  const known = SITES[name]
  if (known) return { url: known, key: null }
  for (const ending of ENDINGS) {
    if (name.length - ending.length < 3 || !name.endsWith(ending)) continue
    const key = name.slice(0, -ending.length)
    const url = SITES[key]
    if (url) return { url, key }
  }
  return ADDRESS.test(name) ? { url: `https://${name}`, key: null } : null
}

function ordinal(word: string): number | null {
  return ORDINALS[word] ?? spokenNumber(word)
}

function tabIndex(s: string): number | null {
  let m = /^(?:mine )?(?:vaheleht|vahelehele) (?:number )?(\S+)$/.exec(s)
  if (m?.[1]) return spokenNumber(m[1])
  m = /^(\S+) vaheleht$/.exec(s)
  if (m?.[1]) return ORDINALS[m[1]] ?? null
  m = /^mine (\S+) vahelehele$/.exec(s)
  if (m?.[1]) return ORDINALS_TO[m[1]] ?? null
  m = /^(?:go to |switch to )?tab (?:number )?(\S+)$/.exec(s)
  if (m?.[1]) return spokenNumber(m[1])
  m = /^(?:go to |switch to )?(?:the )?(\S+) tab$/.exec(s)
  if (m?.[1]) return ordinal(m[1])
  return null
}

/** Every fixed phrase of the table, for the in-page command vocabulary (section 21.3). */
export const BROWSER_PHRASES: readonly string[] = Object.keys(FIXED)

export function browserIntent(text: string): BrowserCommand | null {
  return browserUnderstood(text)?.command ?? null
}

/**
 * browserIntent, plus what it was taken to be when a case ending came off a site name
 * ("mine whatsappi" is understood as "mine whatsapp"); understood is null otherwise.
 */
export function browserUnderstood(text: string): { command: BrowserCommand; understood: string | null } | null {
  const s = cleanForBrowser(text)
  if (s === '') return null
  const plain = (command: BrowserCommand): { command: BrowserCommand; understood: null } => ({ command, understood: null })

  const fixed = FIXED[s]
  if (fixed) return plain(fixed)

  const index = tabIndex(s)
  if (index !== null && index >= 1) return plain({ kind: 'switchTab', to: { index } })

  const click = /^(?:vajuta|klõpsa|kliki|click|press)(?: number)? (.+)$/.exec(s)
  if (click?.[1]) {
    const number = spokenNumber(click[1])
    return number === null ? null : plain({ kind: 'clickHint', number })
  }

  const search = /^(?:otsi|search for|search) (.+)$/.exec(s)
  if (search?.[1]) return plain({ kind: 'goTo', url: `https://www.google.com/search?q=${encodeURIComponent(search[1])}` })

  const go = /^(mine lehele|ava leht|ava lehekülg|go to|open|ava|mine) (.+)$/.exec(s)
  if (go?.[1] && go[2]) {
    const site = siteUrl(go[2])
    if (site) return { command: { kind: 'goTo', url: site.url }, understood: site.key === null ? null : `${go[1]} ${site.key}` }
  }
  return null
}
