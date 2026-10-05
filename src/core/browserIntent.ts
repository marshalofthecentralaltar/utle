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

phrases(
  { kind: 'newTab' },
  'ava uus vaheleht',
  'uus vaheleht',
  'ava vaheleht',
  'new tab',
  'open a new tab',
  'open new tab',
  // M7 (section 22): the words he used.
  'uus leht',
  'ava uus leht',
  'uus aken',
  'ava uus aken',
  'new page',
  'new window',
  'open a new page',
  'open a new window',
  'open new window',
)
phrases(
  { kind: 'closeTab' },
  'sulge vaheleht',
  'sulge see vaheleht',
  'pane vaheleht kinni',
  'close tab',
  'close the tab',
  'close this tab',
  'sulge',
  'close',
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

// M7 (docs/ARCHITECTURE.md section 22): the strip, the field in front, keys and the video.
phrases({ kind: 'bar', show: false }, 'peida riba', 'peida ütle', 'peida ütle ära', 'hide the bar', 'hide bar')
phrases({ kind: 'bar', show: true }, 'näita riba', 'näita ütle', 'show the bar', 'show bar')
phrases({ kind: 'arm', on: true }, 'kirjuta siia', 'siia', 'write here', 'type here')
phrases({ kind: 'arm', on: false }, 'ära kirjuta siia', 'ära siia kirjuta', 'do not write here', 'dont write here')
phrases(
  { kind: 'clearField' },
  'tühjenda otsing',
  'kustuta otsing',
  'tühjenda kast',
  'kustuta kast',
  'tühjenda väli',
  'clear the search',
  'clear search',
  'clear the field',
  'clear the box',
)
phrases({ kind: 'pressKey', key: 'Escape' }, 'sulge aken', 'pane kinni', 'välja', 'escape', 'close this', 'close the window')
phrases({ kind: 'pressKey', key: 'Enter' }, 'enter', 'sisesta', 'kinnita')
phrases({ kind: 'media', action: 'play' }, 'mängi', 'esita', 'play', 'play the video', 'jätka videot')
phrases({ kind: 'media', action: 'pause' }, 'paus', 'peata', 'peata video', 'pause', 'stop the video', 'pause the video')
phrases({ kind: 'media', action: 'mute' }, 'vaigista', 'heli maha', 'heli välja', 'mute')
phrases({ kind: 'media', action: 'unmute' }, 'heli tagasi', 'heli peale', 'heli sisse', 'unmute')
phrases(
  { kind: 'media', action: 'volumeUp' },
  'heli valjemaks',
  'valjemaks',
  'kõvemaks',
  'heli kõvemaks',
  'pane heli valjemaks',
  'pane heli kõvemaks',
  'louder',
  'volume up',
  'turn it up',
)
phrases(
  { kind: 'media', action: 'volumeDown' },
  'heli vaiksemaks',
  'vaiksemaks',
  'pane heli vaiksemaks',
  'tee heli vaiksemaks',
  'quieter',
  'volume down',
  'turn it down',
)
phrases({ kind: 'media', action: 'fullscreen' }, 'täisekraan', 'täisekraanile', 'full screen', 'fullscreen')
phrases({ kind: 'media', action: 'exitFullscreen' }, 'välju täisekraanist', 'täisekraanist välja', 'exit full screen', 'exit fullscreen')
phrases({ kind: 'media', action: 'forward' }, 'keri edasi', 'skip forward')
phrases({ kind: 'media', action: 'back' }, 'keri tagasi', 'skip back')

// Round 3, the edit lane (docs/ARCHITECTURE.md 21.1 "Editing"): the caret, a selection and the editing
// keys inside the armed box, as whole phrases. The box-dependent forms ("mine sõna X ette", "vali X",
// "kustuta kolm tähte", "kirjuta siia vahele X") are patterns in inpage.ts; act there refuses all of
// these when there is no box in front.
phrases({ kind: 'caret', to: 'start' }, 'mine algusesse', 'teksti algusesse', 'mine teksti algusesse', 'go to the start', 'go to the beginning', 'start of the text')
phrases({ kind: 'caret', to: 'end' }, 'mine lõppu', 'teksti lõppu', 'mine teksti lõppu', 'go to the end', 'end of the text')
phrases({ kind: 'caret', to: 'lineStart' }, 'rea algusesse', 'mine rea algusesse', 'start of the line', 'line start', 'go to the start of the line')
phrases({ kind: 'caret', to: 'lineEnd' }, 'rea lõppu', 'mine rea lõppu', 'end of the line', 'line end', 'go to the end of the line')
phrases({ kind: 'caret', to: 'sentenceStart' }, 'lause algusesse', 'mine lause algusesse', 'start of the sentence', 'sentence start', 'go to the start of the sentence')
phrases({ kind: 'caret', to: 'sentenceEnd' }, 'lause lõppu', 'mine lause lõppu', 'end of the sentence', 'sentence end', 'go to the end of the sentence')
phrases({ kind: 'caret', to: 'wordBack' }, 'sõna tagasi', 'üks sõna tagasi', 'word back', 'one word back', 'back a word', 'back one word')
phrases({ kind: 'caret', to: 'wordForward' }, 'sõna edasi', 'üks sõna edasi', 'word forward', 'one word forward', 'forward a word', 'forward one word')
phrases({ kind: 'select', what: 'all' }, 'vali kõik', 'vali kogu tekst', 'select all', 'select everything')
phrases({ kind: 'select', what: 'word' }, 'vali see sõna', 'vali sõna', 'select the word', 'select this word')
phrases({ kind: 'select', what: 'sentence' }, 'vali see lause', 'vali lause', 'select the sentence', 'select this sentence')
phrases({ kind: 'select', what: 'line' }, 'vali see rida', 'vali rida', 'select the line', 'select this line')
phrases({ kind: 'select', what: 'lastWord' }, 'vali viimane sõna', 'select the last word', 'select last word')
phrases({ kind: 'select', what: 'lastSentence' }, 'vali viimane lause', 'select the last sentence', 'select last sentence')
phrases(
  { kind: 'pressKey', key: 'Backspace' },
  'kustuta täht',
  'kustuta üks täht',
  'kustuta tagant',
  'kustuta valitud',
  'kustuta see',
  'delete a letter',
  'delete one letter',
  'delete the letter',
  'delete the selection',
  'delete selection',
  'delete this',
  'backspace',
)
phrases({ kind: 'pressKey', key: 'Delete' }, 'kustuta ees', 'kustuta eest', 'kustuta järgmine täht', 'delete forward', 'delete the next letter', 'delete next letter')
phrases({ kind: 'pressKey', key: 'ArrowLeft' }, 'vasakule', 'üks vasakule', 'üks täht vasakule', 'arrow left', 'go left', 'one left', 'one to the left')
phrases({ kind: 'pressKey', key: 'ArrowRight' }, 'paremale', 'üks paremale', 'üks täht paremale', 'arrow right', 'go right', 'one right', 'one to the right')
phrases({ kind: 'pressKey', key: 'ArrowUp' }, 'üks rida üles', 'rida üles', 'line up', 'one line up', 'arrow up')
phrases({ kind: 'pressKey', key: 'ArrowDown' }, 'üks rida alla', 'rida alla', 'line down', 'one line down', 'arrow down')
phrases({ kind: 'pressKey', key: 'Redo' }, 'tee uuesti', 'redo', 'redo that')
phrases({ kind: 'pressKey', key: 'Tab' }, 'järgmine väli', 'mine järgmisele väljale', 'next field', 'go to the next field')

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

/** "otsi googlest X", "guugelda X", "google X", "search google for X" (cleanForBrowser drops the apostrophe of "google'ist"). */
const GOOGLE = /^(?:(?:otsi|search) (?:googlest|googlist|googleist|googlei|google|guuglist|guuglest)(?: for)?|guugelda|googelda|google) (.+)$/
/** "otsi youtube'ist X", "otsi youtubest X", "search youtube for X". */
const YOUTUBE = /^(?:otsi|search) (?:you ?tubest|you ?tubeist|you ?tubist|you ?tubei|you ?tube)(?: for)? (.+)$/

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

  // M7: "otsi X" is the site's own search (the extension falls back to Google); Google and YouTube by name.
  const google = GOOGLE.exec(s)
  if (google?.[1]) return plain({ kind: 'goTo', url: `https://www.google.com/search?q=${encodeURIComponent(google[1])}` })
  const youtube = YOUTUBE.exec(s)
  if (youtube?.[1]) return plain({ kind: 'goTo', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(youtube[1])}` })
  const search = /^(?:otsi|search for|search|look up) (.+)$/.exec(s)
  if (search?.[1]) return plain({ kind: 'siteSearch', query: search[1] })

  const go = /^(mine lehele|ava leht|ava lehekülg|go to|open|ava|mine) (.+)$/.exec(s)
  if (go?.[1] && go[2]) {
    const site = siteUrl(go[2])
    if (site) return { command: { kind: 'goTo', url: site.url }, understood: site.key === null ? null : `${go[1]} ${site.key}` }
  }
  return null
}
