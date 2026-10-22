import { describe, expect, it } from 'vitest'
import type { BrowserCommand } from '../browser/protocol.ts'
import { browserIntent, SITES } from './browserIntent.ts'
import { STRINGS } from './strings.ts'
import { initialInpage, inpageStep } from './inpage.ts'

const ROWS: Array<[string, BrowserCommand]> = [
  // New tab
  ['ava uus vaheleht', { kind: 'newTab' }],
  ['Uus vaheleht.', { kind: 'newTab' }],
  ['ava vaheleht', { kind: 'newTab' }],
  ['new tab', { kind: 'newTab' }],
  ['Open a new tab.', { kind: 'newTab' }],
  // Close
  ['sulge vaheleht', { kind: 'closeTab' }],
  ['Sulge see vaheleht.', { kind: 'closeTab' }],
  ['pane vaheleht kinni', { kind: 'closeTab' }],
  ['close tab', { kind: 'closeTab' }],
  ['close this tab', { kind: 'closeTab' }],
  // Next and previous
  ['järgmine vaheleht', { kind: 'switchTab', to: 'next' }],
  ['eelmine vaheleht', { kind: 'switchTab', to: 'previous' }],
  ['next tab', { kind: 'switchTab', to: 'next' }],
  ['previous tab', { kind: 'switchTab', to: 'previous' }],
  // By number
  ['kolmas vaheleht', { kind: 'switchTab', to: { index: 3 } }],
  ['vaheleht kolm', { kind: 'switchTab', to: { index: 3 } }],
  ['vaheleht number 3', { kind: 'switchTab', to: { index: 3 } }],
  ['mine kolmandale vahelehele', { kind: 'switchTab', to: { index: 3 } }],
  ['esimene vaheleht', { kind: 'switchTab', to: { index: 1 } }],
  ['tab three', { kind: 'switchTab', to: { index: 3 } }],
  ['third tab', { kind: 'switchTab', to: { index: 3 } }],
  ['go to tab 3', { kind: 'switchTab', to: { index: 3 } }],
  // Sites by name
  ['Ava WhatsApp.', { kind: 'goTo', url: 'https://web.whatsapp.com/' }],
  ['ava vatsap', { kind: 'goTo', url: 'https://web.whatsapp.com/' }],
  ['ava messenger', { kind: 'goTo', url: SITES.messenger }],
  ['Ava Messenger.', { kind: 'goTo', url: 'https://www.messenger.com/' }],
  ['ava gmail', { kind: 'goTo', url: 'https://mail.google.com/' }],
  ['mine lehele postimees.ee', { kind: 'goTo', url: 'https://postimees.ee' }],
  ['mine lehele postimees', { kind: 'goTo', url: 'https://www.postimees.ee/' }],
  ['ava facebook', { kind: 'goTo', url: 'https://www.facebook.com/' }],
  ['ava google', { kind: 'goTo', url: 'https://www.google.com/' }],
  ['ava youtube', { kind: 'goTo', url: 'https://www.youtube.com/' }],
  ['mine delfi', { kind: 'goTo', url: 'https://www.delfi.ee/' }],
  // Round 3 (23.2): the names as an Estonian ear spells them, and what sounds like them.
  ['ava juutuub', { kind: 'goTo', url: 'https://www.youtube.com/' }],
  ['ava juutuba', { kind: 'goTo', url: 'https://www.youtube.com/' }],
  ['mine juutuubi', { kind: 'goTo', url: 'https://www.youtube.com/' }],
  ['ava jutuub', { kind: 'goTo', url: 'https://www.youtube.com/' }],
  ['ava uutuub', { kind: 'goTo', url: 'https://www.youtube.com/' }],
  ['ava jutuup', { kind: 'goTo', url: 'https://www.youtube.com/' }],
  ['mine juutuubisse', { kind: 'goTo', url: 'https://www.youtube.com/' }],
  ['ava gugel', { kind: 'goTo', url: 'https://www.google.com/' }],
  ['ava guugel', { kind: 'goTo', url: 'https://www.google.com/' }],
  ['mine guuglisse', { kind: 'goTo', url: 'https://www.google.com/' }],
  ['ava gmeil', { kind: 'goTo', url: 'https://mail.google.com/' }],
  ['ava fäisbuk', { kind: 'goTo', url: 'https://www.facebook.com/' }],
  ['ava feisbuk', { kind: 'goTo', url: 'https://www.facebook.com/' }],
  ['ava feisbuki', { kind: 'goTo', url: 'https://www.facebook.com/' }],
  ['ava mesendžer', { kind: 'goTo', url: 'https://www.messenger.com/' }],
  ['ava messendžer', { kind: 'goTo', url: 'https://www.messenger.com/' }],
  ['ava postimehes', { kind: 'goTo', url: 'https://www.postimees.ee/' }],
  ['mine delfis', { kind: 'goTo', url: 'https://www.delfi.ee/' }],
  ['ava vatsapp', { kind: 'goTo', url: 'https://web.whatsapp.com/' }],
  ['ava vatsäp', { kind: 'goTo', url: 'https://web.whatsapp.com/' }],
  ['mine vatsapi', { kind: 'goTo', url: 'https://web.whatsapp.com/' }],
  ['ava whatsap', { kind: 'goTo', url: 'https://web.whatsapp.com/' }],
  ['ava err', { kind: 'goTo', url: 'https://www.err.ee/' }],
  ['ava linkedin', { kind: 'goTo', url: 'https://www.linkedin.com/' }],
  ['ava cv.ee', { kind: 'goTo', url: 'https://www.cv.ee/' }],
  ['ava cv punkt ee', { kind: 'goTo', url: 'https://www.cv.ee/' }],
  ['ava cvkeskus', { kind: 'goTo', url: 'https://www.cvkeskus.ee/' }],
  ['ava cv keskus', { kind: 'goTo', url: 'https://www.cvkeskus.ee/' }],
  ['ava töötukassa', { kind: 'goTo', url: 'https://www.tootukassa.ee/' }],
  ['open messenger', { kind: 'goTo', url: 'https://www.messenger.com/' }],
  ['go to gmail', { kind: 'goTo', url: 'https://mail.google.com/' }],
  // Bare addresses
  ['ava ekool.ee', { kind: 'goTo', url: 'https://ekool.ee' }],
  ['go to wikipedia.org', { kind: 'goTo', url: 'https://wikipedia.org' }],
  ['mine lehele www.riigiteataja.ee', { kind: 'goTo', url: 'https://www.riigiteataja.ee' }],
  // Search (M7: the site's own search; Google and YouTube by name)
  ['otsi ilm tallinnas', { kind: 'siteSearch', query: 'ilm tallinnas' }],
  ['search for bus times', { kind: 'siteSearch', query: 'bus times' }],
  ['otsi googlest ilm tallinnas', { kind: 'goTo', url: 'https://www.google.com/search?q=ilm%20tallinnas' }],
  ['guugelda ilm', { kind: 'goTo', url: 'https://www.google.com/search?q=ilm' }],
  ['google bus times', { kind: 'goTo', url: 'https://www.google.com/search?q=bus%20times' }],
  ["otsi youtube'ist kassid", { kind: 'goTo', url: 'https://www.youtube.com/results?search_query=kassid' }],
  ['search youtube for cats', { kind: 'goTo', url: 'https://www.youtube.com/results?search_query=cats' }],
  // M7 phrases
  ['uus leht', { kind: 'newTab' }],
  ['Ava uus aken.', { kind: 'newTab' }],
  ['new window', { kind: 'newTab' }],
  ['sulge', { kind: 'closeTab' }],
  ['close', { kind: 'closeTab' }],
  ['peida riba', { kind: 'bar', show: false }],
  ['show the bar', { kind: 'bar', show: true }],
  ['kirjuta siia', { kind: 'arm', on: true }],
  ['ära kirjuta siia', { kind: 'arm', on: false }],
  ['tühjenda otsing', { kind: 'clearField' }],
  ['clear the field', { kind: 'clearField' }],
  ['pane kinni', { kind: 'pressKey', key: 'Escape' }],
  ['Enter.', { kind: 'pressKey', key: 'Enter' }],
  ['paus', { kind: 'media', action: 'pause' }],
  ['heli valjemaks', { kind: 'media', action: 'volumeUp' }],
  ['keri tagasi', { kind: 'media', action: 'back' }],
  ['täisekraan', { kind: 'media', action: 'fullscreen' }],
  // Round 5: the page's size.
  ['suurenda', { kind: 'zoom', direction: 'in' }],
  ['Suurenda lehte.', { kind: 'zoom', direction: 'in' }],
  ['suumi sisse', { kind: 'zoom', direction: 'in' }],
  ['tee suuremaks', { kind: 'zoom', direction: 'in' }],
  ['suurem tekst', { kind: 'zoom', direction: 'in' }],
  ['tee tekst suuremaks', { kind: 'zoom', direction: 'in' }],
  ['zoom in', { kind: 'zoom', direction: 'in' }],
  ['make it bigger', { kind: 'zoom', direction: 'in' }],
  ['larger text', { kind: 'zoom', direction: 'in' }],
  ['vähenda', { kind: 'zoom', direction: 'out' }],
  ['suumi välja', { kind: 'zoom', direction: 'out' }],
  ['Tee väiksemaks.', { kind: 'zoom', direction: 'out' }],
  ['väiksem kiri', { kind: 'zoom', direction: 'out' }],
  ['zoom out', { kind: 'zoom', direction: 'out' }],
  ['make it smaller', { kind: 'zoom', direction: 'out' }],
  ['tavaline suurus', { kind: 'zoom', direction: 'reset' }],
  ['algne suurus', { kind: 'zoom', direction: 'reset' }],
  ['suumi tagasi', { kind: 'zoom', direction: 'reset' }],
  ['reset zoom', { kind: 'zoom', direction: 'reset' }],
  ['normal size', { kind: 'zoom', direction: 'reset' }],
  // History
  ['mine tagasi', { kind: 'history', direction: 'back' }],
  ['Tagasi.', { kind: 'history', direction: 'back' }],
  ['eelmine leht', { kind: 'history', direction: 'back' }],
  ['edasi', { kind: 'history', direction: 'forward' }],
  ['mine edasi', { kind: 'history', direction: 'forward' }],
  ['page back', { kind: 'history', direction: 'back' }],
  ['go back a page', { kind: 'history', direction: 'back' }],
  ['go forward', { kind: 'history', direction: 'forward' }],
  // Reload
  ['laadi uuesti', { kind: 'reload' }],
  ['värskenda', { kind: 'reload' }],
  ['reload', { kind: 'reload' }],
  ['refresh the page', { kind: 'reload' }],
  // Scroll
  ['keri alla', { kind: 'scroll', direction: 'down' }],
  ['keri üles', { kind: 'scroll', direction: 'up' }],
  ['lehe algusesse', { kind: 'scroll', direction: 'top' }],
  ['lehe lõppu', { kind: 'scroll', direction: 'bottom' }],
  ['scroll down', { kind: 'scroll', direction: 'down' }],
  ['scroll to the top', { kind: 'scroll', direction: 'top' }],
  // Round 3 (23.2): a little, slowly, stop.
  ['keri natuke alla', { kind: 'scroll', direction: 'down', mode: 'little' }],
  ['Natuke alla.', { kind: 'scroll', direction: 'down', mode: 'little' }],
  ['keri natuke üles', { kind: 'scroll', direction: 'up', mode: 'little' }],
  ['natuke üles', { kind: 'scroll', direction: 'up', mode: 'little' }],
  ['scroll down a little', { kind: 'scroll', direction: 'down', mode: 'little' }],
  ['keri aeglaselt alla', { kind: 'scroll', direction: 'down', mode: 'slow' }],
  ['keri tasa alla', { kind: 'scroll', direction: 'down', mode: 'slow' }],
  ['keri aeglaselt üles', { kind: 'scroll', direction: 'up', mode: 'slow' }],
  ['scroll slowly down', { kind: 'scroll', direction: 'down', mode: 'slow' }],
  ['scroll slowly up', { kind: 'scroll', direction: 'up', mode: 'slow' }],
  ['stopp', { kind: 'scroll', direction: 'down', mode: 'stop' }],
  ['Stopp.', { kind: 'scroll', direction: 'down', mode: 'stop' }],
  ['seis', { kind: 'scroll', direction: 'down', mode: 'stop' }],
  ['aitab', { kind: 'scroll', direction: 'down', mode: 'stop' }],
  ['lõpeta', { kind: 'scroll', direction: 'down', mode: 'stop' }],
  ['stop', { kind: 'scroll', direction: 'down', mode: 'stop' }],
  ['stop scrolling', { kind: 'scroll', direction: 'down', mode: 'stop' }],
  ['keri edasi', { kind: 'media', action: 'forward' }],
  // Numbers
  ['näita numbreid', { kind: 'showHints' }],
  ['show numbers', { kind: 'showHints' }],
  ['peida numbrid', { kind: 'hideHints' }],
  ['hide numbers', { kind: 'hideHints' }],
  ['vajuta viis', { kind: 'clickHint', number: 5 }],
  ['Vajuta 12.', { kind: 'clickHint', number: 12 }],
  ['klõpsa kaks', { kind: 'clickHint', number: 2 }],
  ['click five', { kind: 'clickHint', number: 5 }],
  ['press 7', { kind: 'clickHint', number: 7 }],
  // Round 3: editing inside the box (the word-bound forms are patterns in inpage.ts).
  ['mine algusesse', { kind: 'caret', to: 'start' }],
  ['Teksti lõppu.', { kind: 'caret', to: 'end' }],
  ['rea algusesse', { kind: 'caret', to: 'lineStart' }],
  ['lause lõppu', { kind: 'caret', to: 'sentenceEnd' }],
  ['sõna tagasi', { kind: 'caret', to: 'wordBack' }],
  ['go to the end', { kind: 'caret', to: 'end' }],
  ['vali kõik', { kind: 'select', what: 'all' }],
  ['vali viimane lause', { kind: 'select', what: 'lastSentence' }],
  ['select the word', { kind: 'select', what: 'word' }],
  ['kustuta täht', { kind: 'pressKey', key: 'Backspace' }],
  ['kustuta ees', { kind: 'pressKey', key: 'Delete' }],
  ['vasakule', { kind: 'pressKey', key: 'ArrowLeft' }],
  ['üks rida alla', { kind: 'pressKey', key: 'ArrowDown' }],
  ['tee uuesti', { kind: 'pressKey', key: 'Redo' }],
  ['järgmine väli', { kind: 'pressKey', key: 'Tab' }],
  ['next field', { kind: 'pressKey', key: 'Tab' }],
]

// ---------- document mode (29.2) ----------

describe('format (29.2): the formatting phrases of the browser table', () => {
  const FORMAT_ROWS: ReadonlyArray<readonly [string, BrowserCommand]> = [
    ['paksuks', { kind: 'format', style: 'bold' }],
    ['Tee paksuks.', { kind: 'format', style: 'bold' }],
    ['rasvaseks', { kind: 'format', style: 'bold' }],
    ['bold', { kind: 'format', style: 'bold' }],
    ['kaldkirja', { kind: 'format', style: 'italic' }],
    ['tee kaldkirja', { kind: 'format', style: 'italic' }],
    ['italic', { kind: 'format', style: 'italic' }],
    ['allajoonitud', { kind: 'format', style: 'underline' }],
    ['jooni alla', { kind: 'format', style: 'underline' }],
    ['underline', { kind: 'format', style: 'underline' }],
    ['pealkirjaks', { kind: 'format', style: 'heading' }],
    ['tee pealkirjaks', { kind: 'format', style: 'heading' }],
    ['heading', { kind: 'format', style: 'heading' }],
    ['tavaline tekst', { kind: 'format', style: 'normal' }],
    ['tavaliseks', { kind: 'format', style: 'normal' }],
    ['normal text', { kind: 'format', style: 'normal' }],
    ['loendiks', { kind: 'format', style: 'list' }],
    ['tee loendiks', { kind: 'format', style: 'list' }],
    ['bulleted list', { kind: 'format', style: 'list' }],
    ['uus lõik', { kind: 'format', style: 'paragraph' }],
    ['new paragraph', { kind: 'format', style: 'paragraph' }],
  ]
  for (const [phrase, command] of FORMAT_ROWS) {
    it(`format: "${phrase}" is ${JSON.stringify(command)}`, () => {
      expect(browserIntent(phrase)).toEqual(command)
    })
  }

  it('format: "tee uuesti" stays redo and "tavaline suurus" stays the zoom reset', () => {
    expect(browserIntent('tee uuesti')).toEqual({ kind: 'pressKey', key: 'Redo' })
    expect(browserIntent('tavaline suurus')).toEqual({ kind: 'zoom', direction: 'reset' })
  })

  it('selection (29.2): "vali lõik" and "select the paragraph" select the paragraph', () => {
    expect(browserIntent('vali lõik')).toEqual({ kind: 'select', what: 'paragraph' })
    expect(browserIntent('vali see lõik')).toEqual({ kind: 'select', what: 'paragraph' })
    expect(browserIntent('select the paragraph')).toEqual({ kind: 'select', what: 'paragraph' })
  })
})

describe('browserIntent: the phrase table', () => {
  it.each(ROWS)('%s', (text, command) => {
    expect(browserIntent(text)).toEqual(command)
  })
})

describe('browserIntent: what is not a browser command', () => {
  it.each([
    // Unknown site names go on to the interpreter.
    'ava eelarve',
    'mine kokkuvõtte juurde',
    'ava kass',
    'mine koju',
    'ava aken',
    'ava mari',
    'open the budget section',
    // The document's own words.
    'järgmine',
    'eelmine',
    'go back',
    'next',
    'top',
    // Sentences that only start like a command.
    'ava messenger ja kirjuta Marile',
    'vajuta',
    'otsi',
    'google',
    'search',
    'vaheleht',
    'scroll',
    '',
    // Round 3: the word-bound editing forms live in inpage.ts, where the box text is known.
    'mine sõna homme ette',
    'vali homme',
    'kustuta kolm tähte',
    // Review R3 M6: "kustuta see" depends on what came before (a select, or the last utterance): inpage.ts.
    'kustuta see',
    'delete this',
  ])('%s', (text) => {
    expect(browserIntent(text)).toBeNull()
  })
})

describe('round 8: media forward and back by an amount (29.1)', () => {
  const ROWS_SEEK: Array<[string, 'forward' | 'back', number]> = [
    ['keri edasi üks minut', 'forward', 60],
    ['keri üks minut edasi', 'forward', 60],
    ['keri edasi minut', 'forward', 60],
    ['keri tagasi kolmkümmend sekundit', 'back', 30],
    ['keri kolmkümmend sekundit tagasi', 'back', 30],
    ['keri edasi poolteist minutit', 'forward', 90],
    ['keri tagasi pool minutit', 'back', 30],
    ['keri kaks minutit edasi', 'forward', 120],
    ['keri edasi kümme sekundit', 'forward', 10],
    ['keri edasi 30 sekundit', 'forward', 30],
    ['keri edasi kaks ja pool minutit', 'forward', 150],
    ['keri tagasi viis minutit', 'back', 300],
    ['keri minut edasi', 'forward', 60],
    ['Keri edasi üks minut.', 'forward', 60],
    ['KERI TAGASI VIIS MINUTIT!', 'back', 300],
    ['keri edasi kolm kümmend sekundit', 'forward', 30],
    ['keri edasi 120 sekundit', 'forward', 120],
    ['skip forward one minute', 'forward', 60],
    ['skip back thirty seconds', 'back', 30],
    ['forward 90 seconds', 'forward', 90],
    ['go back two minutes', 'back', 120],
    ['skip ahead a minute and a half', 'forward', 90],
    ['rewind 10 seconds', 'back', 10],
  ]
  it.each(ROWS_SEEK)('%s -> %s %d s', (text, action, seconds) => {
    expect(browserIntent(text)).toEqual({ kind: 'media', action, seconds })
  })

  it('"keri edasi" and "keri tagasi" alone carry no seconds (the 10 s default)', () => {
    expect(browserIntent('keri edasi')).toEqual({ kind: 'media', action: 'forward' })
    expect(browserIntent('keri tagasi')).toEqual({ kind: 'media', action: 'back' })
    expect(browserIntent('skip forward')).toEqual({ kind: 'media', action: 'forward' })
    expect(browserIntent('Keri tagasi.')).toEqual({ kind: 'media', action: 'back' })
  })

  it('a scroll phrase is never a seek', () => {
    for (const text of ['keri alla kolm korda', 'keri alla', 'keri natuke alla', 'keri üles kaks minutit', 'keri alla edasi']) {
      expect(browserIntent(text)?.kind).not.toBe('media')
    }
    expect(browserIntent('keri alla')).toEqual({ kind: 'scroll', direction: 'down' })
  })

  it('an amount out of bounds, or not an amount, is not a seek', () => {
    for (const text of ['keri edasi null sekundit', 'keri edasi 5000 sekundit', 'keri edasi kolm korda', 'keri edasi kiiresti', 'go back two pages']) {
      expect(browserIntent(text)).toBeNull()
    }
  })
})

describe('round 8: the line for a seek says the amount (29.1)', () => {
  it('Estonian and English', () => {
    expect(STRINGS.et.browserDoing({ kind: 'media', action: 'forward', seconds: 60 })).toBe('Edasi üks minut.')
    expect(STRINGS.et.browserDoing({ kind: 'media', action: 'back', seconds: 120 })).toBe('Tagasi 2 minutit.')
    expect(STRINGS.et.browserDoing({ kind: 'media', action: 'forward', seconds: 90 })).toBe('Edasi 90 sekundit.')
    expect(STRINGS.et.browserDoing({ kind: 'media', action: 'forward' })).toBe('Edasi kümme sekundit.')
    expect(STRINGS.en.browserDoing({ kind: 'media', action: 'back', seconds: 30 })).toBe('Back 30 seconds.')
    expect(STRINGS.en.browserDoing({ kind: 'media', action: 'forward', seconds: 60 })).toBe('Forward one minute.')
  })
})

// ---------- reading aloud (29.5) ----------
describe('reading aloud (29.5): read phrases', () => {
  const READ_ROWS: Array<[string, BrowserCommand]> = [
    ['loe ette', { kind: 'read', what: 'page' }],
    ['Loe lehte ette.', { kind: 'read', what: 'page' }],
    ['loe leht ette', { kind: 'read', what: 'page' }],
    ['loe see leht ette', { kind: 'read', what: 'page' }],
    ['read the page', { kind: 'read', what: 'page' }],
    ['Read it out', { kind: 'read', what: 'page' }],
    ['read this page', { kind: 'read', what: 'page' }],
    ['loe see ette', { kind: 'read', what: 'box' }],
    ['loe kasti ette', { kind: 'read', what: 'box' }],
    ['loe kast ette', { kind: 'read', what: 'box' }],
    ['read this', { kind: 'read', what: 'box' }],
    ['read the box', { kind: 'read', what: 'box' }],
    ['loe valitud ette', { kind: 'read', what: 'selection' }],
    ['loe valik ette', { kind: 'read', what: 'selection' }],
    ['read the selection', { kind: 'read', what: 'selection' }],
    ['loe edasi', { kind: 'read', what: 'continue' }],
    ['Jätka lugemist!', { kind: 'read', what: 'continue' }],
    ['continue reading', { kind: 'read', what: 'continue' }],
    ['lõpeta lugemine', { kind: 'read', what: 'stop' }],
    ['stop reading', { kind: 'read', what: 'stop' }],
    ['lugemine seis', { kind: 'read', what: 'stop' }],
  ]
  for (const [said, command] of READ_ROWS) {
    it(`read: "${said}" is ${command.kind === 'read' ? command.what : ''}`, () => {
      expect(browserIntent(said)).toEqual(command)
    })
  }

  it('read: "stopp" and "aitab" alone stay the scroll stop in the table (the engine stops a reading first)', () => {
    expect(browserIntent('stopp')).toEqual({ kind: 'scroll', direction: 'down', mode: 'stop' })
    expect(browserIntent('aitab')).toEqual({ kind: 'scroll', direction: 'down', mode: 'stop' })
    expect(browserIntent('edasi')).toEqual({ kind: 'history', direction: 'forward' })
  })

  it('read: the rules turn the read phrases into the read command, with and without an armed box with words', () => {
    const session = initialInpage('et')
    for (const box of [{ present: false, text: '', armed: false }, { present: true, text: 'Tere, kuidas läheb', armed: true }]) {
      expect(inpageStep(session, 'loe lehte ette', box).commands).toEqual([{ kind: 'read', what: 'page' }])
      expect(inpageStep(session, 'loe kasti ette', box).commands).toEqual([{ kind: 'read', what: 'box' }])
      expect(inpageStep(session, 'loe edasi', box).commands).toEqual([{ kind: 'read', what: 'continue' }])
      expect(inpageStep(session, 'lõpeta lugemine', box).commands).toEqual([{ kind: 'read', what: 'stop' }])
    }
  })

  it('read: "loe ette" and "loe see ette" read the armed box with words aloud (DOCS, 29.2), and the page without one', () => {
    const session = initialInpage('et')
    for (const said of ['loe ette', 'loe see ette']) {
      const inBox = inpageStep(session, said, { present: true, text: 'Tere, kuidas läheb', armed: true })
      expect(inBox.commands).toEqual([])
      expect(inBox.speak).toBe('Tere, kuidas läheb')
      for (const box of [{ present: false, text: '', armed: false }, { present: true, text: 'kassid', armed: false }, { present: true, text: '', armed: true }]) {
        expect(inpageStep(session, said, box).commands).toEqual([{ kind: 'read', what: 'page' }])
      }
    }
  })

  it('read: the lines say what is happening, in Estonian and English', () => {
    expect(STRINGS.et.browserDoing({ kind: 'read', what: 'page' })).toBe('Loen ette…')
    expect(STRINGS.en.browserDoing({ kind: 'read', what: 'box' })).toBe('Reading…')
    expect(STRINGS.et.browserDoing({ kind: 'read', what: 'continue' })).toBe('Loen edasi…')
    expect(STRINGS.et.browserDoing({ kind: 'read', what: 'stop' })).toBe('Lugemine seis.')
    expect(STRINGS.et.browserFailed({ kind: 'read', what: 'page' }, 'not_allowed')).toBe("Selles brauseris pole eesti häält. Edge'is on.")
    expect(STRINGS.en.browserFailed({ kind: 'read', what: 'page' }, 'not_allowed')).toBe('This browser has no Estonian voice; Edge has one.')
    expect(STRINGS.et.browserFailed({ kind: 'read', what: 'continue' }, 'not_found')).toBe('Lugemine on lõppenud.')
    expect(STRINGS.en.browserFailed({ kind: 'read', what: 'continue' }, 'not_found')).toBe('Nothing more to read.')
    expect(STRINGS.et.browserFailed({ kind: 'read', what: 'page' }, 'not_found')).toBe('Siin pole midagi ette lugeda.')
    expect(STRINGS.et.read.skipped).toBe('Jätsin ühe lause vahele.')
  })
})
