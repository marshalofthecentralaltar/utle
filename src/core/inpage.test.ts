import { describe, expect, it } from 'vitest'
import type { BoxState, BrowserCommand, BrowserResult, PageContext } from '../browser/protocol.ts'
import { applyIntent, initialInpage, inpageInstant, inpageResult, inpageStep } from './inpage.ts'
import type { PageIntent } from './pageIntent.ts'
import type { InpageSession } from './inpage.ts'
import { inpagePreview } from './inpage.ts'
import { browserIntent } from './browserIntent.ts'
import { STRINGS } from './strings.ts'
import { deepFreeze } from './testUtil.ts'

const ET = STRINGS.et
const EN = STRINGS.en

function session(over: Partial<InpageSession> = {}): InpageSession {
  return deepFreeze({ ...initialInpage('et'), ...over })
}
function box(text: string): BoxState {
  return { present: true, text, armed: true }
}
const NO_BOX: BoxState = { present: false, text: '', armed: false }
const EMPTY: BoxState = box('')
/** A field the page focused by itself (a search bar): present, not armed. */
function unarmed(text: string): BoxState {
  return { present: true, text, armed: false, kind: 'search', label: 'Search' }
}
function page(b: BoxState, over: Partial<PageContext> = {}): PageContext {
  return { url: 'https://www.youtube.com/', title: 'YouTube', box: b, items: [], media: null, hints: false, ...over }
}

function only(command: BrowserCommand): BrowserCommand[] {
  return [command]
}
function setTextOf(commands: readonly BrowserCommand[]): string {
  const c = commands[0]
  if (commands.length !== 1 || c?.kind !== 'setText') throw new Error(`expected one setText, got ${JSON.stringify(commands)}`)
  return c.text
}
const OK: BrowserResult = { ok: true }

describe('rule 1: sleep and wake', () => {
  it.each(['puhka', 'Puhka.', 'ära kuula', 'maga', 'sleep', 'go to sleep', 'stop listening'])('"%s" puts it to sleep', (u) => {
    const step = inpageStep(session(), u, box('Tere'))
    expect(step.session.asleep).toBe(true)
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.inpage.sleeping)
  })

  it.each(['ärka üles', 'Ärka üles!', 'ärka', 'wake up', 'start listening'])('"%s" wakes it', (u) => {
    const step = inpageStep(session({ asleep: true }), u, box('Tere'))
    expect(step.session.asleep).toBe(false)
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.listeningAgain)
  })

  it.each(['saada', 'Ma jõuan homme', 'keri alla', 'kustuta kõik', 'võta tagasi', 'kirjuta Marile', '5', 'puhka'])(
    'asleep, "%s" is ignored',
    (u) => {
      const s = session({ asleep: true, hints: true, undo: ['a'] })
      const step = inpageStep(s, u, box('Tere'))
      expect(step.commands).toEqual([])
      expect(step.session).toEqual(s)
      expect(step.line).toBe(ET.inpage.resting)
    },
  )

  it('the wake phrase while awake says it already listens', () => {
    const step = inpageStep(session(), 'ärka üles', EMPTY)
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.alreadyListening)
  })

  it('English lines in an English session', () => {
    const step = inpageStep(session({ lang: 'en' }), 'puhka', EMPTY)
    expect(step.line).toBe(EN.inpage.sleeping)
    expect(inpageStep(step.session, 'hello', EMPTY).line).toBe(EN.inpage.resting)
  })
})

describe('rule 2: numbered labels', () => {
  it.each([
    ['viis', 5],
    ['5', 5],
    ['number viis', 5],
    ['Kolm.', 3],
    ['twelve', 12],
  ])('with labels showing, "%s" clicks %i', (u, n) => {
    const step = inpageStep(session({ hints: true }), u, box('Tere'))
    expect(step.commands).toEqual(only({ kind: 'clickHint', number: n }))
    expect(step.session.hints).toBe(false)
  })

  it.each([
    ['vajuta viis', 5],
    ['klõpsa 3', 3],
    ['click five', 5],
    ['press 7', 7],
  ])('"%s" clicks %i even without labels', (u, n) => {
    expect(inpageStep(session(), u, EMPTY).commands).toEqual(only({ kind: 'clickHint', number: n }))
  })

  it('without labels, a bare number is dictation', () => {
    expect(inpageStep(session(), 'viis', box('Kell on')).commands).toEqual(only({ kind: 'setText', text: 'Kell on viis' }))
  })

  it.each(['näita numbreid', 'show numbers'])('"%s" shows labels and sets hints', (u) => {
    const step = inpageStep(session(), u, EMPTY)
    expect(step.commands).toEqual(only({ kind: 'showHints' }))
    expect(step.session.hints).toBe(true)
  })

  it.each(['peida numbrid', 'hide numbers'])('"%s" hides labels and clears hints', (u) => {
    const step = inpageStep(session({ hints: true }), u, EMPTY)
    expect(step.commands).toEqual(only({ kind: 'hideHints' }))
    expect(step.session.hints).toBe(false)
  })

  it.each([
    ['keri alla', true],
    ['järgmine vaheleht', false],
    ['tagasi', false],
    ['ava messenger', false],
    ['kirjuta Marile', false],
  ])('labels showing, "%s" leaves hints %s', (u, hints) => {
    expect(inpageStep(session({ hints: true }), u, box('')).session.hints).toBe(hints)
  })

  it('dictation and send keep the labels', () => {
    expect(inpageStep(session({ hints: true }), 'tere tere vana kere', EMPTY).session.hints).toBe(true)
    expect(inpageStep(session({ hints: true }), 'saada', box('Tere')).session.hints).toBe(true)
  })
})

describe('rule 3: browser commands', () => {
  it.each<[string, BrowserCommand]>([
    ['järgmine vaheleht', { kind: 'switchTab', to: 'next' }],
    ['eelmine vaheleht', { kind: 'switchTab', to: 'previous' }],
    ['kolmas vaheleht', { kind: 'switchTab', to: { index: 3 } }],
    ['ava uus vaheleht', { kind: 'newTab' }],
    ['sulge vaheleht', { kind: 'closeTab' }],
    ['ava messenger', { kind: 'goTo', url: 'https://www.messenger.com/' }],
    ['otsi ilm tallinnas', { kind: 'siteSearch', query: 'ilm tallinnas' }],
    ['otsi googlest ilm tallinnas', { kind: 'goTo', url: 'https://www.google.com/search?q=ilm%20tallinnas' }],
    ['keri alla', { kind: 'scroll', direction: 'down' }],
    ['Keri üles.', { kind: 'scroll', direction: 'up' }],
    ['laadi uuesti', { kind: 'reload' }],
    ['mine tagasi', { kind: 'history', direction: 'back' }],
    ['next tab', { kind: 'switchTab', to: 'next' }],
    ['scroll down', { kind: 'scroll', direction: 'down' }],
    ['go to youtube', { kind: 'goTo', url: 'https://www.youtube.com/' }],
  ])('"%s"', (u, command) => {
    const step = inpageStep(session(), u, box('Tere'))
    expect(step.commands).toEqual(only(command))
    expect(step.line).toBe(ET.browserDoing(command))
  })

  it.each<[string, BrowserCommand]>([
    ['tagasi', { kind: 'history', direction: 'back' }],
    ['Tagasi.', { kind: 'history', direction: 'back' }],
    ['edasi', { kind: 'history', direction: 'forward' }],
    ['järgmine', { kind: 'switchTab', to: 'next' }],
    ['eelmine', { kind: 'switchTab', to: 'previous' }],
    ['back', { kind: 'history', direction: 'back' }],
    ['go back', { kind: 'history', direction: 'back' }],
    ['forward', { kind: 'history', direction: 'forward' }],
    ['next', { kind: 'switchTab', to: 'next' }],
    ['previous', { kind: 'switchTab', to: 'previous' }],
  ])('bare "%s" is the browser in this mode', (u, command) => {
    // An empty armed box: with words in it "tagasi" is undo and "edasi" a word of the message (section 22).
    expect(inpageStep(session(), u, box('')).commands).toEqual(only(command))
  })

  it('a page change empties undo, because the old texts belong to another box', () => {
    expect(inpageStep(session({ undo: ['a', 'b'] }), 'järgmine vaheleht', box('b c')).session.undo).toEqual([])
    expect(inpageStep(session({ undo: ['a', 'b'] }), 'keri alla', box('b c')).session.undo).toEqual(['a', 'b'])
  })
})

describe('rule 4: conversations', () => {
  it.each([
    ['ava vestlus Mariga', 'Mari'],
    ['Ava vestlus Jaaniga.', 'Jaani'],
    ['ava Mari vestlus', 'Mari'],
    ['kirjuta Marile', 'Mari'],
    ['Kirjuta Marile.', 'Mari'],
    ['sõnum Marile', 'Mari'],
    ['kirjuta sõnum Jaanile', 'Jaani'],
    ['ava vestlus Mari Tammega', 'Mari Tamme'],
    ['open chat with Mari', 'Mari'],
    ['open the conversation with John Smith', 'John Smith'],
    ['message Mari', 'Mari'],
    ['write to Mari', 'Mari'],
  ])('"%s" opens the conversation with %s', (u, name) => {
    const step = inpageStep(session(), u, box('vana tekst'))
    expect(step.commands).toEqual(only({ kind: 'openConversation', name }))
    expect(step.line).toBe(ET.browserDoing({ kind: 'openConversation', name }))
    expect(step.session.undo).toEqual([])
  })

  it('the one-breath form opens and types, and does not send', () => {
    const step = inpageStep(session({ undo: ['x'] }), 'kirjuta Marile, et ma jõuan homme kell kolm', box('vana'))
    expect(step.commands).toEqual([
      { kind: 'openConversation', name: 'Mari' },
      { kind: 'setText', text: 'Ma jõuan homme kell kolm.' },
    ])
    expect(step.session.undo).toEqual([''])
  })

  it('the English one-breath form', () => {
    const step = inpageStep(session({ lang: 'en' }), 'tell Mari that I will be late', EMPTY)
    expect(step.commands).toEqual([
      { kind: 'openConversation', name: 'Mari' },
      { kind: 'setText', text: 'I will be late.' },
    ])
  })

  it.each(['kirjuta mulle', 'Kirjuta talle', 'kirjuta meile'])('"%s" is a pronoun, so dictation', (u) => {
    expect(inpageStep(session(), u, EMPTY).commands[0]?.kind).toBe('setText')
  })

  it.each(['uus sõnum', 'kirjuta sõnum', 'new message'])('"%s" without a name asks for the name', (u) => {
    const step = inpageStep(session(), u, EMPTY)
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.inpage.sayWho)
  })
})

describe('rule 5: send', () => {
  it.each(['saada', 'Saada ära.', 'saada sõnum', 'saada see', 'send', 'send it', 'Send the message.'])('"%s" presses send', (u) => {
    const step = inpageStep(session({ undo: ['a'] }), u, box('Tere'))
    expect(step.commands).toEqual(only({ kind: 'pressSend' }))
    expect(step.line).toBe(ET.browserDoing({ kind: 'pressSend' }))
  })

  it.each([EMPTY, box('   '), NO_BOX])('nothing to send with box %j', (b) => {
    const step = inpageStep(session(), 'saada', b)
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.inpage.nothingToSend)
  })
})

describe('rule 6: repairs', () => {
  it.each([
    ['mitte kolm, vaid neli', 'Ma tulen kell kolm.', 'Ma tulen kell neli.'],
    ['Mitte kolm vaid neli.', 'Ma tulen kell kolm.', 'Ma tulen kell neli.'],
    ['kolm asemel neli', 'Ma tulen kell kolm.', 'Ma tulen kell neli.'],
    ['kolme asemel neli', 'Ma tulen kell kolm.', 'Ma tulen kell neli.'],
    ['asenda kolm sõnaga neli', 'Ma tulen kell kolm.', 'Ma tulen kell neli.'],
    ['not three but four', 'I come at three.', 'I come at four.'],
    ['replace three with four', 'I come at three.', 'I come at four.'],
    ['change three to four', 'I come at three.', 'I come at four.'],
    ['mitte kolm vaid neli', 'Kolm või kolm.', 'Kolm või neli.'],
    ['mitte KOLM vaid neli', 'Kell kolm.', 'Kell neli.'],
    ['mitte homme kell kolm vaid ülehomme', 'Tulen homme kell kolm.', 'Tulen ülehomme.'],
    ['mitte ma vaid sina', 'Ma tulen. Ma jään.', 'Ma tulen. Sina jään.'],
    ['mitte Kolm, vaid neli', 'kolm õuna ja kolmas', 'neli õuna ja kolmas'],
  ])('"%s" turns "%s" into "%s"', (u, before, after) => {
    const step = inpageStep(session(), u, box(before))
    expect(setTextOf(step.commands)).toBe(after)
    expect(step.session.undo).toEqual([before])
  })

  it('X not found: no command, the line quotes X', () => {
    const step = inpageStep(session(), 'mitte viis, vaid kuus', box('Ma tulen kell kolm.'))
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.inpage.notInText('viis'))
  })

  it('whole words only: "kolm" is not found inside "kolmas"', () => {
    expect(inpageStep(session(), 'mitte kolm vaid neli', box('See on kolmas.')).commands).toEqual([])
  })

  it('"X asemel Y" with long sides is a dictated sentence', () => {
    const u = 'ma tulen täna bussi asemel hoopis rongiga'
    expect(inpageStep(session(), u, box('')).commands).toEqual(only({ kind: 'setText', text: 'Ma tulen täna bussi asemel hoopis rongiga.' }))
  })

  it.each([
    ['kustuta viimane sõna', 'Ma tulen kell kolm.', 'Ma tulen kell'],
    ['Kustuta viimane sõna.', 'Tere', ''],
    ['delete the last word', 'I come at three', 'I come at'],
    ['kustuta viimane lause', 'Tere. Ma tulen kell kolm.', 'Tere.'],
    ['kustuta viimane lause', 'Tere! Ma tulen', 'Tere!'],
    ['kustuta viimane lause', 'Tere\nMa tulen.', 'Tere\n'],
    ['kustuta viimane lause', 'Ma tulen.', ''],
    ['delete the last sentence', 'Hi. I come.', 'Hi.'],
    ['kustuta kõik', 'Tere. Ma tulen.', ''],
    ['tühjenda', 'Tere', ''],
    ['alusta uuesti', 'Tere', ''],
    ['katkesta sõnum', 'Tere', ''],
    ['delete everything', 'Hi', ''],
    ['clear', 'Hi', ''],
    ['uus rida', 'Tere', 'Tere\n'],
    ['new line', 'Hi', 'Hi\n'],
    ['punkt', 'Tere', 'Tere.'],
    ['Koma.', 'Tere', 'Tere,'],
    ['küsimärk', 'Kas tuled.', 'Kas tuled?'],
    ['hüüumärk', 'Tere ', 'Tere!'],
    ['question mark', 'Are you coming', 'Are you coming?'],
    ['full stop', 'Hi', 'Hi.'],
    ['comma', 'Hi', 'Hi,'],
  ])('"%s" turns %j into %j', (u, before, after) => {
    const step = inpageStep(session(), u, box(before))
    expect(setTextOf(step.commands)).toBe(after)
    expect(step.session.undo).toEqual([before])
  })

  it.each(['kustuta viimane sõna', 'kustuta viimane lause', 'kustuta kõik', 'punkt', 'mitte kolm vaid neli'])(
    '"%s" on an empty box says it is empty',
    (u) => {
      const step = inpageStep(session(), u, EMPTY)
      expect(step.commands).toEqual([])
      expect(step.line).toBe(ET.inpage.boxEmpty)
    },
  )

  it.each(['kustuta viimane sõna', 'uus rida', 'mitte kolm vaid neli', 'võta tagasi'])('"%s" without a box asks for one', (u) => {
    const step = inpageStep(session({ undo: ['a'] }), u, NO_BOX)
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.inpage.pickField)
  })

  it.each(['võta tagasi', 'Võta tagasi.', 'undo', 'undo that'])('"%s" puts the previous text back', (u) => {
    const step = inpageStep(session({ undo: ['a', 'Tere'] }), u, box('Tere kõik'))
    expect(step.commands).toEqual(only({ kind: 'setText', text: 'Tere' }))
    expect(step.line).toBe(ET.inpage.undoing)
    // The entry leaves undo only when the setText succeeds.
    expect(step.session.undo).toEqual(['a', 'Tere'])
    expect(inpageResult(step.session, step.commands, OK).session.undo).toEqual(['a'])
  })

  it('nothing to undo', () => {
    const step = inpageStep(session(), 'võta tagasi', box('Tere'))
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.nothingToUndo)
  })

  it('undo keeps at most 30 entries, dropping the oldest', () => {
    let s = session()
    let text = ''
    for (let i = 0; i < 35; i++) {
      const step = inpageStep(s, `sõna${i}`, box(text))
      text = setTextOf(step.commands)
      s = inpageResult(step.session, step.commands, OK).session
    }
    expect(s.undo).toHaveLength(30)
    expect(s.undo[0]).toBe('Sõna0 sõna1 sõna2 sõna3 sõna4')
    expect(s.undo.at(-1)).toBe(text.replace(/ sõna34$/, ''))
  })
})

describe('rule 7: dictation', () => {
  it.each([
    ['', 'Ma jõuan homme kell kolm', 'Ma jõuan homme kell kolm.'],
    ['', 'ma jõuan', 'Ma jõuan'],
    ['', 'Jah', 'Jah'],
    ['Tere', 'Kuidas läheb', 'Tere kuidas läheb'],
    ['Tere.', 'kuidas läheb', 'Tere. Kuidas läheb'],
    ['Tere!', 'kuidas läheb', 'Tere! Kuidas läheb'],
    ['Tere?', 'kuidas läheb', 'Tere? Kuidas läheb'],
    ['Tere\n', 'kuidas läheb', 'Tere\nKuidas läheb'],
    ['Tere   ', 'Kuidas', 'Tere kuidas'],
    ['Ma jõuan homme kell neli.', 'Ja võtan koogi kaasa', 'Ma jõuan homme kell neli ja võtan koogi kaasa.'],
    ['Ma ei tule.', 'Sest olen haige', 'Ma ei tule, sest olen haige.'],
    ['Ma tulen.', 'aga hiljem', 'Ma tulen, aga hiljem'],
    ['Nägin Mari juures', 'Mari ütles', 'Nägin Mari juures Mari ütles'],
    ['Kirjutasin Marile', 'Mari ei vastanud', 'Kirjutasin Marile mari ei vastanud.'],
    ['Ma nägin Marit ja', 'Marit', 'Ma nägin Marit ja Marit'],
    ['Vaatasin', 'ERR uudiseid', 'Vaatasin ERR uudiseid'],
    ['Yes', 'I will come', 'Yes I will come.'],
    ['Tere', 'Kas sa tuled?', 'Tere kas sa tuled?'],
    ['Tere', 'Kas sa tuled homme,', 'Tere kas sa tuled homme,'],
    ['Tere', 'Hästi', 'Tere hästi'],
  ])('%j + "%s" is %j', (before, u, after) => {
    const step = inpageStep(session(), u, box(before))
    expect(step.commands).toEqual(only({ kind: 'setText', text: after }))
    expect(step.session.undo).toEqual([before])
    expect(step.line).toBe(ET.browserDoing({ kind: 'setText', text: after }))
  })

  it('without a box, dictation asks for one', () => {
    const step = inpageStep(session(), 'Ma jõuan homme', NO_BOX)
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.inpage.pickField)
    expect(inpageStep(session({ lang: 'en' }), 'hello there', NO_BOX).line).toBe(EN.inpage.pickField)
  })

  it('an empty utterance does nothing', () => {
    const step = inpageStep(session(), '  ', box('Tere'))
    expect(step.commands).toEqual([])
  })
})

describe('inpageResult', () => {
  it('a successful send says "Saadetud." and empties undo', () => {
    const r = inpageResult(session({ undo: ['a', 'b'] }), [{ kind: 'pressSend' }], OK)
    expect(r.line).toBe('Saadetud.')
    expect(r.session.undo).toEqual([])
  })

  it('tab and navigation commands give the tab title', () => {
    const r = inpageResult(session(), [{ kind: 'switchTab', to: 'next' }], { ok: true, tab: { title: 'WhatsApp', url: 'https://web.whatsapp.com/' } })
    expect(r.line).toBe('Vaheleht: WhatsApp.')
  })

  it('showHints gives the label count, and a failure clears hints', () => {
    expect(inpageResult(session({ hints: true }), [{ kind: 'showHints' }], { ok: true, hints: 12 }).line).toBe(
      ET.browserDone({ kind: 'showHints' }, null, 12),
    )
    const failed = inpageResult(session({ hints: true }), [{ kind: 'showHints' }], { ok: false, code: 'not_allowed', message: 'x' })
    expect(failed.session.hints).toBe(false)
    expect(failed.line).toBe(ET.browserFailed({ kind: 'showHints' }, 'not_allowed'))
  })

  it('a conversation that opens is named', () => {
    expect(inpageResult(session(), [{ kind: 'openConversation', name: 'Mari' }], OK).line).toBe(ET.inpage.conversationOpen('Mari'))
  })

  it('a conversation that is not found says so in Estonian', () => {
    const commands: BrowserCommand[] = [
      { kind: 'openConversation', name: 'Mari' },
      { kind: 'setText', text: 'Tere.' },
    ]
    const r = inpageResult(session({ undo: [''] }), commands, { ok: false, code: 'not_found', message: 'No conversation matches "Mari"' })
    expect(r.line).toBe('Vestlust „Mari“ ei leitud.')
    expect(r.session.undo).toEqual([])
  })

  it('no_target is plain Estonian, never the extension message', () => {
    const r = inpageResult(session(), [{ kind: 'scroll', direction: 'down' }], { ok: false, code: 'no_target', message: 'No window' })
    expect(r.line).toBe(ET.browserFailed({ kind: 'scroll', direction: 'down' }, 'no_target'))
    expect(r.line).not.toContain('No window')
  })

  it('a failed setText removes the undo entry it pushed', () => {
    const step = inpageStep(session({ undo: ['a'] }), 'Tere', box('b'))
    expect(step.session.undo).toEqual(['a', 'b'])
    const r = inpageResult(step.session, step.commands, { ok: false, code: 'not_found', message: 'x' })
    expect(r.session.undo).toEqual(['a'])
    expect(r.line).toBe(ET.inpage.boxNotFound)
  })

  it('a failed undo keeps the entry so it can be tried again', () => {
    const step = inpageStep(session({ undo: ['a', 'b'] }), 'võta tagasi', box('b c'))
    const r = inpageResult(step.session, step.commands, { ok: false, code: 'failed', message: 'x' })
    expect(r.session.undo).toEqual(['a', 'b'])
  })

  it('a successful setText says it is done and keeps undo', () => {
    const r = inpageResult(session({ undo: ['a'] }), [{ kind: 'setText', text: 'a b' }], OK)
    expect(r.line).toBe(ET.inpage.written)
    expect(r.session.undo).toEqual(['a'])
  })

  it('a failed send says it did not send, and a timed-out send warns it may have gone', () => {
    const failed = inpageResult(session({ undo: ['a'] }), [{ kind: 'pressSend' }], { ok: false, code: 'not_found', message: 'x' })
    expect(failed.line).toBe(ET.inpage.notSent(ET.inpage.boxNotFound))
    expect(failed.session.undo).toEqual(['a'])
    const timedOut = inpageResult(session(), [{ kind: 'pressSend' }], { ok: false, code: 'failed', message: 'timed_out' })
    expect(timedOut.line).toBe(ET.sendTimedOut)
  })

  it('English session, English lines', () => {
    expect(inpageResult(session({ lang: 'en' }), [{ kind: 'pressSend' }], OK).line).toBe('Sent.')
  })
})

describe('a whole conversation', () => {
  it('opens, writes, repairs, appends, deletes, undoes and sends', () => {
    let s = session()
    let page: BoxState = box('')
    const texts: string[] = []
    const ran: BrowserCommand[][] = []
    function say(u: string): string {
      const step = inpageStep(s, u, page)
      ran.push(step.commands)
      for (const c of step.commands) {
        if (c.kind === 'setText') {
          page = box(c.text)
          texts.push(c.text)
        }
      }
      const r = inpageResult(step.session, step.commands, OK)
      s = r.session
      return r.line
    }

    expect(s.asleep).toBe(false)
    say('kirjuta Marile')
    expect(ran.at(-1)).toEqual([{ kind: 'openConversation', name: 'Mari' }])
    say('Ma jõuan homme kell kolm')
    expect(page.text).toBe('Ma jõuan homme kell kolm.')
    say('mitte kolm, vaid neli')
    expect(page.text).toBe('Ma jõuan homme kell neli.')
    say('Ja võtan koogi kaasa')
    expect(page.text).toBe('Ma jõuan homme kell neli ja võtan koogi kaasa.')
    say('kustuta viimane sõna')
    expect(page.text).toBe('Ma jõuan homme kell neli ja võtan koogi')
    say('võta tagasi')
    expect(page.text).toBe('Ma jõuan homme kell neli ja võtan koogi kaasa.')
    const line = say('saada')
    expect(ran.at(-1)).toEqual([{ kind: 'pressSend' }])
    expect(line).toBe('Saadetud.')
    expect(s.undo).toEqual([])
    expect(texts).toEqual([
      'Ma jõuan homme kell kolm.',
      'Ma jõuan homme kell neli.',
      'Ma jõuan homme kell neli ja võtan koogi kaasa.',
      'Ma jõuan homme kell neli ja võtan koogi',
      'Ma jõuan homme kell neli ja võtan koogi kaasa.',
    ])
  })
})

const COMMAND_PHRASES = [
  'puhka', 'ära kuula', 'maga', 'sleep', 'stop listening', 'ärka üles', 'wake up',
  'vajuta viis', 'click five', 'näita numbreid', 'peida numbrid', 'show numbers',
  'järgmine vaheleht', 'eelmine vaheleht', 'kolmas vaheleht', 'ava uus vaheleht', 'sulge vaheleht', 'ava messenger',
  'otsi ilm', 'keri alla', 'keri üles', 'laadi uuesti', 'tagasi', 'edasi', 'järgmine', 'eelmine', 'back', 'go back',
  'forward', 'next', 'previous', 'next tab', 'scroll down',
  'ava vestlus Mariga', 'ava Mari vestlus', 'kirjuta Marile', 'sõnum Marile', 'open chat with Mari', 'message Mari',
  'uus sõnum',
  'saada', 'saada ära', 'saada sõnum', 'send', 'send it',
  'mitte kolm, vaid neli', 'mitte kolm vaid neli', 'kolme asemel neli', 'asenda kolm sõnaga neli', 'not three but four',
  'replace three with four', 'change three to four',
  'kustuta viimane sõna', 'kustuta viimane lause', 'kustuta kõik', 'tühjenda', 'alusta uuesti', 'delete the last word',
  'delete the last sentence', 'delete everything', 'clear',
  'võta tagasi', 'undo', 'uus rida', 'new line', 'punkt', 'koma', 'küsimärk', 'hüüumärk', 'full stop', 'comma', 'question mark',
  // M7 (section 22).
  'uus leht', 'ava uus leht', 'uus aken', 'ava uus aken', 'new page', 'new window', 'open a new page',
  'sulge', 'close', 'peida riba', 'peida ütle', 'hide the bar', 'näita riba', 'show the bar',
  'kirjuta siia', 'siia', 'write here', 'type here', 'ära kirjuta siia', 'do not write here',
  'tühjenda otsing', 'kustuta otsing', 'tühjenda kast', 'clear the search', 'clear the field',
  'sulge aken', 'pane kinni', 'välja', 'escape', 'close this', 'enter', 'sisesta', 'kinnita',
  'otsi googlest ilm', 'guugelda ilm', 'google weather', "otsi youtube'ist kassid", 'otsi youtubest kassid', 'search youtube for cats',
  'mängi', 'esita', 'play', 'paus', 'peata', 'pause', 'stop the video', 'vaigista', 'heli maha', 'mute', 'heli tagasi', 'heli peale',
  'unmute', 'heli valjemaks', 'valjemaks', 'kõvemaks', 'louder', 'volume up', 'heli vaiksemaks', 'vaiksemaks', 'quieter', 'volume down',
  'pane heli vaiksemaks', 'täisekraan', 'full screen', 'välju täisekraanist', 'exit full screen', 'keri edasi', 'keri tagasi',
  // Round 3 (editing): the fixed phrases and the counted ones; the ones with a word need that word in the box (below).
  'mine algusesse', 'teksti lõppu', 'rea algusesse', 'rea lõppu', 'lause algusesse', 'lause lõppu', 'sõna tagasi', 'sõna edasi',
  'go to the start', 'go to the end', 'word back', 'vali kõik', 'vali see sõna', 'vali see lause', 'vali viimane sõna', 'vali viimane lause',
  'select all', 'select the word', 'kustuta täht', 'kustuta üks täht', 'kustuta kolm tähte', 'kustuta valitud', 'kustuta see', 'kustuta ees',
  'delete a letter', 'delete three letters', 'vasakule', 'paremale', 'vasakule kolm korda', 'kolm paremale', 'üks rida üles', 'üks rida alla',
  'kaks rida alla', 'line up', 'tee uuesti', 'redo', 'järgmine väli', 'next field', 'kolm sõna tagasi', 'two words forward',
  'kirjuta siia vahele homme', 'lisa siia homme', 'sisesta homme', 'insert homme',
]

/** One-word fixed phrases that are ordinary words of a message: commands only with an empty or unarmed box (section 22). */
const SOFT_WORDS = ['välja', 'siia', 'edasi', 'sulge', 'enter', 'sisesta', 'kinnita', 'paus', 'peata', 'mängi', 'esita', 'close', 'play', 'pause', 'forward', 'escape']

const DICTATION = [
  'Ma jõuan homme kell kolm',
  'ja võtan koogi kaasa',
  'Kas sa tuled täna õhtul kinno?',
  'Tere Mari',
  'Ma olen natuke hiljaks jäämas',
  'kirjuta mulle kui jõuad',
  'Aitäh, et aitasid',
  'Ma tulen bussi asemel hoopis rongiga täna',
  'I will be there at three',
  'see you tomorrow',
]

describe('inpageInstant agrees with inpageStep', () => {
  it.each(COMMAND_PHRASES)('"%s" is instant and not dictation', (u) => {
    expect(inpageInstant(session(), u)).toBe(true)
    // The soft one-word phrases are dictation while the armed box holds words (section 22): an empty box here.
    const step = inpageStep(session(), u, box(SOFT_WORDS.includes(u) ? '' : 'kolm kolm. Tere'))
    const dictated = step.commands.length === 1 && step.commands[0]?.kind === 'setText' && step.commands[0].text.endsWith(u)
    expect(dictated).toBe(false)
  })

  it.each(DICTATION)('"%s" is dictation and not instant', (u) => {
    expect(inpageInstant(session(), u)).toBe(false)
    const step = inpageStep(session(), u, box('Tere.'))
    expect(step.commands).toHaveLength(1)
    expect(step.commands[0]?.kind).toBe('setText')
  })

  it('the one-breath form is not instant', () => {
    expect(inpageInstant(session(), 'kirjuta Marile, et ma jõuan homme')).toBe(false)
    expect(inpageInstant(session(), 'tell Mari that I am late')).toBe(false)
  })

  it('a bare number is instant only while labels show', () => {
    expect(inpageInstant(session({ hints: true }), 'viis')).toBe(true)
    expect(inpageInstant(session(), 'viis')).toBe(false)
  })

  it('everything is instant while asleep, because it is ignored', () => {
    expect(inpageInstant(session({ asleep: true }), 'Ma jõuan homme kell kolm')).toBe(true)
  })
})

describe('properties', () => {
  it.each([...COMMAND_PHRASES, ...DICTATION])('asleep, "%s" emits nothing and changes nothing', (u) => {
    if (['ärka üles', 'wake up'].includes(u)) return
    const s = session({ asleep: true, undo: ['a'] })
    const step = inpageStep(s, u, box('Tere'))
    expect(step.commands).toEqual([])
    expect(step.session).toEqual(s)
  })

  it.each(DICTATION)('dictation "%s" emits exactly one setText that keeps the old text as its start', (u) => {
    for (const before of ['', 'Tere', 'Tere.', 'Rida\n']) {
      const step = inpageStep(session(), u, box(before))
      const text = setTextOf(step.commands)
      expect(text.startsWith(before.replace(/\.$/, ''))).toBe(true)
      expect(text.length).toBeGreaterThan(before.length - 1)
    }
  })

  it.each(COMMAND_PHRASES)('command "%s" never types its own words', (u) => {
    const step = inpageStep(session({ hints: true }), u, box(SOFT_WORDS.includes(u) ? '' : 'kolm kolm. Tere'))
    for (const c of step.commands) {
      if (c.kind === 'setText') expect(c.text.toLowerCase()).not.toContain(u.toLowerCase())
      if (c.kind === 'insertText') throw new Error('in-page mode never uses insertText')
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Section 21.3: live words (inpagePreview), site names with endings, one-letter mishearings.

function preview(partial: string, before: string | BoxState = '', s: InpageSession = session()): string | null {
  return inpagePreview(s, partial, typeof before === 'string' ? box(before) : before)
}
function prefixes(phrase: string): string[] {
  const words = phrase.split(' ')
  return words.map((_, i) => words.slice(0, i + 1).join(' '))
}

const LIVE_ET = [
  'Ma jõuan homme kell kolm koju',
  'Kas sa tuled täna õhtul kinno',
  'Ma olen natuke hiljaks jäämas',
  'Tänan sind väga abi eest',
  'Homme on ilus ilm ja päike paistab',
  'Ostsin poest leiba ja piima',
  'Kus sa praegu oled',
  'Ema helistas eile õhtul mulle',
  'Ma ootan sind bussipeatuses',
  'Kas me saame reedel kokku',
  'Mul on täna sünnipäev',
  'Vabandust et ma hiljaks jäin',
]
const LIVE_EN = ['I will be there at three', 'See you tomorrow at the station', 'Can you call me later today', 'Thanks for the lovely dinner']

describe('inpagePreview: the words grow in the box and agree with the final', () => {
  it.each([...LIVE_ET, ...LIVE_EN])('"%s"', (sentence) => {
    for (const before of ['', 'Tere, Mari!', 'Ma tulen homme']) {
      let last: string | null = null
      for (const [i, partial] of prefixes(sentence).entries()) {
        const p = preview(partial, before)
        if (i >= 3) expect(p, `${partial} after ${JSON.stringify(before)}`).not.toBeNull()
        if (p !== null) {
          expect(p.startsWith(before)).toBe(true)
          expect(p.endsWith('.')).toBe(false)
        }
        last = p
      }
      const final = setTextOf(inpageStep(session(), sentence, box(before)).commands)
      expect([last, `${last}.`]).toContain(final)
    }
  })

  it('the join rules are the dictation ones: capital, joining word, a name kept', () => {
    expect(preview('ma jõuan homme', '')).toBe('Ma jõuan homme')
    expect(preview('ma jõuan homme', 'Tere.')).toBe('Tere. Ma jõuan homme')
    expect(preview('Ja võtan koogi', 'Ma tulen.')).toBe('Ma tulen ja võtan koogi')
    expect(preview('Sest olen haige', 'Ma ei tule.')).toBe('Ma ei tule, sest olen haige')
    expect(preview('Kuidas läheb sul', 'Tere')).toBe('Tere kuidas läheb sul')
    expect(preview('uus rida tuleb', 'Tere\n')).toBe('Tere\nUus rida tuleb')
  })
})

const PATTERN_PREFIXES = [
  'mitte kolm, vaid neli',
  'mitte homme kell kolm vaid ülehomme',
  'kirjuta Marile, et ma jõuan homme',
  'kirjuta Mari Tammele',
  'ava vestlus Mariga',
  'ava vestlus koos Mari Tammega',
  'otsi ilmateade',
  'asenda kolm sõnaga neli',
  'kolme asemel neli',
  'sulge vaheleht',
  'mine järgmisele vahelehele',
  'mine kolmandale vahelehele',
  'vajuta number viis',
  'tell Mari that I am late',
  'write to Mari that I am late',
  'open the conversation with John Smith',
  'write a message to Mari',
  'mine lehele delfi',
  'Mina whatsappi',
  'keeri alla',
  'sulge vahe leht',
  'saada sõnum Marile',
]
const NEVER_FLASH = [...new Set([...COMMAND_PHRASES, ...PATTERN_PREFIXES].flatMap(prefixes))]

describe('inpagePreview: no command ever flashes in the box', () => {
  it.each(NEVER_FLASH)('"%s" previews nothing', (partial) => {
    expect(preview(partial, 'Tere')).toBeNull()
    expect(preview(partial, '')).toBeNull()
  })

  it.each(['Otsi', 'otsi ilm', 'Otsi mulle see raamat'])('"%s" is a search command, never a preview', (partial) => {
    expect(preview(partial, 'Tere')).toBeNull()
  })
})

describe('inpagePreview: a sentence that starts like a command previews once it outgrows it', () => {
  it.each([
    ['Saada mulle palun aadress', 2],
    ['Mine sa homme poodi', 4],
    ['Ava uks kui tuled', 4],
    // Round 3: "kustuta see" is a command (Backspace on the selection), so the words show from the third.
    ['Kustuta see pilt ära palun', 3],
    ['Tagasi tulen kell viis', 2],
    ['Järgmine nädal sobib', 2],
    ['Kirjuta mulle kui jõuad', 2],
    ['Mitte keegi ei tulnud täna kohale', 6],
  ])('"%s" first previews at word %i', (sentence, first) => {
    const at = prefixes(sentence).findIndex((p) => preview(p, '') !== null) + 1
    expect(at).toBe(first)
    expect(setTextOf(inpageStep(session(), sentence, EMPTY).commands).startsWith(preview(sentence, '') ?? '?')).toBe(true)
  })
})

describe('inpagePreview: null cases', () => {
  it('asleep, no box, an empty partial', () => {
    expect(preview('Ma jõuan homme kell kolm', '', session({ asleep: true }))).toBeNull()
    expect(preview('ärka üles', '', session({ asleep: true }))).toBeNull()
    expect(preview('Ma jõuan homme kell kolm', NO_BOX)).toBeNull()
    expect(preview('', 'Tere')).toBeNull()
    expect(preview('   ', 'Tere')).toBeNull()
  })

  it.each(['viis', '5', 'number viis', 'Kolm.', 'twelve'])('labels showing, the number "%s" previews nothing', (n) => {
    expect(preview(n, 'Tere', session({ hints: true }))).toBeNull()
  })
})

describe('site names with Estonian endings', () => {
  const WA = 'https://web.whatsapp.com/'
  it.each([
    ['mine whatsappi', WA],
    ['mine WhatsAppi', WA],
    ['Mine WhatsAppi.', WA],
    ['ava messengeri', 'https://www.messenger.com/'],
    ['mine gmaili', 'https://mail.google.com/'],
    ['mine facebooki', 'https://www.facebook.com/'],
    ["mine youtube'i", 'https://www.youtube.com/'],
    ['mine youtube’i', 'https://www.youtube.com/'],
    ['mine postimehesse', 'https://www.postimees.ee/'],
    ['mine delfisse', 'https://www.delfi.ee/'],
    ['mine googlesse', 'https://www.google.com/'],
    ['ava youtube', 'https://www.youtube.com/'],
    ['ava vatsap', WA],
    ['ava vatsapp', WA],
    ['mine vatsappi', WA],
    ['ava whats app', WA],
    ['mine whats appi', WA],
    ['ava whatsup', WA],
    ['ava votsap', WA],
    ['mine votsapi', WA],
  ])('"%s" goes to %s', (u, url) => {
    const command: BrowserCommand = { kind: 'goTo', url }
    const step = inpageStep(session(), u, box('Tere'))
    expect(step.commands).toEqual(only(command))
    expect(step.line.endsWith(ET.browserDoing(command))).toBe(true)
    expect(inpageInstant(session(), u)).toBe(true)
    expect(browserIntent(u)).toEqual(command)
  })

  it('an ending that was taken off is named in the line', () => {
    const command: BrowserCommand = { kind: 'goTo', url: 'https://web.whatsapp.com/' }
    expect(inpageStep(session(), 'mine whatsappi', EMPTY).line).toBe(`${ET.inpage.understood('mine whatsapp')} ${ET.browserDoing(command)}`)
    expect(inpageStep(session(), 'ava whatsapp', EMPTY).line).toBe(ET.browserDoing(command))
  })

  it.each(['mine koju', 'ava aken', 'mine sinna', 'mine poodi'])('"%s" is not a site', (u) => {
    expect(browserIntent(u)).toBeNull()
  })
})

describe('one-letter mishearings', () => {
  it.each<[string, string, BrowserCommand]>([
    ['Mina whatsappi', 'mine whatsappi', { kind: 'goTo', url: 'https://web.whatsapp.com/' }],
    ['mina WhatsAppi.', 'mine whatsappi', { kind: 'goTo', url: 'https://web.whatsapp.com/' }],
    ['keeri alla', 'keri alla', { kind: 'scroll', direction: 'down' }],
    ['keri allla', 'keri alla', { kind: 'scroll', direction: 'down' }],
    ['kerri üles', 'keri üles', { kind: 'scroll', direction: 'up' }],
    ['näite numbreid', 'näita numbreid', { kind: 'showHints' }],
    ['näita numbreit', 'näita numbreid', { kind: 'showHints' }],
    ['peida numbreid', 'peida numbrid', { kind: 'hideHints' }],
    ['järgmine vahelehte', 'järgmine vaheleht', { kind: 'switchTab', to: 'next' }],
    ['eelmine vahelehte', 'eelmine vaheleht', { kind: 'switchTab', to: 'previous' }],
    ['sulge vahe leht', 'sulge vaheleht', { kind: 'closeTab' }],
    ['laadi uuesi', 'laadi uuesti', { kind: 'reload' }],
    ['lehe lõpu', 'lehe lõppu', { kind: 'scroll', direction: 'bottom' }],
    ['ava mesenger', 'ava messenger', { kind: 'goTo', url: 'https://www.messenger.com/' }],
    ['scroll dawn', 'scroll down', { kind: 'scroll', direction: 'down' }],
    ['nest tab', 'next tab', { kind: 'switchTab', to: 'next' }],
    ['go forwad', 'go forward', { kind: 'history', direction: 'forward' }],
  ])('"%s" is "%s"', (u, understood, command) => {
    const step = inpageStep(session(), u, box('Tere'))
    expect(step.commands).toEqual(only(command))
    expect(inpageInstant(session(), u)).toBe(true)
    expect(step.line).toBe(`${ET.inpage.understood(understood)} ${ET.browserDoing(command)}`)
    expect(preview(u, 'Tere')).toBeNull()
  })

  it('"kirjutta Marile" opens the conversation and says what it understood', () => {
    const step = inpageStep(session(), 'kirjutta Marile', box('Tere'))
    expect(step.commands).toEqual(only({ kind: 'openConversation', name: 'Mari' }))
    expect(step.line.startsWith(ET.inpage.understood('kirjuta marile'))).toBe(true)
    expect(inpageInstant(session(), 'kirjutta Marile')).toBe(true)
  })

  it('a repair heard one letter off', () => {
    const step = inpageStep(session(), 'kustuta viimane sona', box('Ma tulen kell kolm.'))
    expect(setTextOf(step.commands)).toBe('Ma tulen kell')
    expect(step.line).toBe(`${ET.inpage.understood('kustuta viimane sõna')} ${ET.inpage.deletingWord}`)
    expect(inpageInstant(session(), 'kustuta viimane sona')).toBe(true)
  })

  it('English session, English line', () => {
    const command: BrowserCommand = { kind: 'scroll', direction: 'down' }
    expect(inpageStep(session({ lang: 'en' }), 'keeri alla', EMPTY).line).toBe(`${EN.inpage.understood('keri alla')} ${EN.browserDoing(command)}`)
  })

  it('a single word is never corrected', () => {
    expect(inpageInstant(session(), 'kama')).toBe(false)
    expect(inpageInstant(session(), 'tagasy')).toBe(false)
  })
})

const SHORT_ET = [
  'Mina tulen ka', 'Mina ei tea', 'Tere hommikust', 'Aitäh sulle', 'Kell kolm', 'Ma tulen', 'Olen kodus', 'Jah, sobib',
  'Ei saa', 'Saadan homme', 'Tulen tagasi kell viis', 'Otsin sind', 'Kus sa oled', 'Mina ka', 'Kohe tulen', 'Selge, aitäh',
  'Tore kuulda', 'Head ööd', 'Näeme homme', 'Olen teel', 'Mis kell', 'Jõuan varsti', 'Võtan tagasi', 'Kustutan kõik',
  'Kirjutan hiljem', 'Sulle ka', 'Lähen koju', 'Mine magama', 'Ava aken', 'Pole viga', 'Kõik hästi', 'Armastan sind',
  'Uus aasta', 'Järgmine kord', 'Helista mulle', 'Vasta palun', 'Ootan sind', 'Mina sinna', 'Lahe uudis', 'Kama on otsas',
  'Selge pilt', 'Kirjutas Marile', 'Otsid mind', 'Sulgen akna',
]
const SHORT_EN = ['See you soon', 'Thank you', 'On my way', 'Love you too', 'Call me later', 'Next time maybe', 'I am back home', 'Sounds good', 'Text me', 'Clean the room']

describe('short real messages are not taken for commands', () => {
  it.each([...SHORT_ET, ...SHORT_EN])('"%s" is dictation', (u) => {
    const step = inpageStep(session(), u, box('Tere.'))
    expect(step.commands).toHaveLength(1)
    expect(step.commands[0]?.kind).toBe('setText')
    expect(inpageInstant(session(), u)).toBe(false)
  })
})

describe('send, sleep, wake and undo are never corrected', () => {
  it.each([
    'saadan', 'saadab', 'sada', 'puhkan', 'ärkan', 'saadan ära', 'sada ära', 'saadab sõnumi', 'saata sõnum', 'puhkan nüüd',
    'ärkan üles', 'võtan tagasi', 'võtta tagasi', 'sennd it', 'wake upp',
  ])('"%s" is dictation', (u) => {
    const step = inpageStep(session(), u, box('Tere.'))
    expect(step.commands).toHaveLength(1)
    expect(step.commands[0]?.kind).toBe('setText')
    expect(step.session.asleep).toBe(false)
    expect(inpageInstant(session(), u)).toBe(false)
  })

  it('asleep, a phrase one letter from the wake phrase stays ignored', () => {
    expect(inpageStep(session({ asleep: true }), 'ärkan üles', box('Tere')).session.asleep).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// Section 22 (M7): the armed box, "tagasi" as undo, the new phrases, numbers, applyIntent.

describe('M7 the armed box: words go only where he asked', () => {
  it.each(['Ma jõuan homme', 'tere', 'kassid', 'I will be late'])('dictation "%s" into a field the page focused is refused', (u) => {
    const s = session({ undo: ['a'] })
    const step = inpageStep(s, u, unarmed(''))
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.inpage.noPlaceToWrite)
    expect(step.ask).toBe(true)
    expect(step.session).toEqual(s)
  })

  it('the line is in the session language, and pickField stays for no box at all', () => {
    expect(inpageStep(session({ lang: 'en' }), 'hello there', unarmed('')).line).toBe(EN.inpage.noPlaceToWrite)
    expect(inpageStep(session(), 'hello there', NO_BOX).line).toBe(ET.inpage.pickField)
    expect(inpageStep(session(), 'hello there', NO_BOX).ask).toBe(true)
  })

  it.each(['kustuta viimane sõna', 'mitte kolm vaid neli', 'punkt', 'uus rida', 'võta tagasi', 'undo'])('repair "%s" needs an armed box', (u) => {
    const step = inpageStep(session({ undo: ['Tere'] }), u, unarmed('Ma tulen kell kolm.'))
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.inpage.noPlaceToWrite)
  })

  it('send needs an armed box; an absent box still says there is nothing to send', () => {
    const step = inpageStep(session(), 'saada', unarmed('Tere'))
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.inpage.noPlaceToWrite)
    expect(inpageStep(session(), 'saada', NO_BOX).line).toBe(ET.inpage.nothingToSend)
  })

  it('the preview never types into an unarmed field', () => {
    expect(inpagePreview(session(), 'Ma jõuan homme kell', unarmed(''))).toBeNull()
    expect(inpagePreview(session(), 'Ma jõuan homme kell', box(''))).toBe('Ma jõuan homme kell')
  })

  it('the armed box takes dictation, repairs, undo and send as before', () => {
    expect(setTextOf(inpageStep(session(), 'kuidas läheb', box('Tere')).commands)).toBe('Tere kuidas läheb')
    expect(setTextOf(inpageStep(session(), 'kustuta viimane sõna', box('Tere Mari')).commands)).toBe('Tere')
    expect(inpageStep(session(), 'saada', box('Tere')).commands).toEqual(only({ kind: 'pressSend' }))
  })

  it('the one-breath form and opening a conversation do not look at the box', () => {
    expect(inpageStep(session(), 'kirjuta Marile, et tulen', unarmed('x')).commands).toEqual([
      { kind: 'openConversation', name: 'Mari' },
      { kind: 'setText', text: 'Tulen.' },
    ])
    expect(inpageStep(session(), 'kirjuta Marile', unarmed('x')).commands).toEqual(only({ kind: 'openConversation', name: 'Mari' }))
    expect(inpageStep(session(), 'keri alla', unarmed('x')).commands).toEqual(only({ kind: 'scroll', direction: 'down' }))
  })
})

describe('M7 "tagasi" takes the words back when there are words to take back', () => {
  it.each(['tagasi', 'Tagasi.', 'back', 'go back'])('"%s" with text and an undo entry is undo', (u) => {
    const step = inpageStep(session({ undo: ['a', 'Tere'] }), u, box('Tere kõik'))
    expect(step.commands).toEqual(only({ kind: 'setText', text: 'Tere' }))
    expect(step.line).toBe(ET.inpage.undoing)
    expect(inpageInstant(session({ undo: ['Tere'] }), u)).toBe(true)
  })

  it.each<[string, BoxState]>([
    ['an empty box', box('')],
    ['a box of spaces', box('  ')],
  ])('with %s and an undo entry it is still undo: the words just cleared come back, the page stays', (_what, b) => {
    for (const u of ['tagasi', 'back', 'go back']) {
      const step = inpageStep(session({ undo: ['Tere'] }), u, b)
      expect(step.commands).toEqual(only({ kind: 'setText', text: 'Tere' }))
      expect(step.line).toBe(ET.inpage.undoing)
    }
  })

  it('with words in the armed box and nothing to undo it says so and never leaves the page', () => {
    for (const u of ['tagasi', 'back', 'go back']) {
      const step = inpageStep(session({ undo: [] }), u, box('Tere kõik'))
      expect(step.commands).toEqual([])
      expect(step.line).toBe(ET.nothingToUndo)
    }
  })

  it.each<[string, BoxState, string[]]>([
    ['an empty armed box and nothing to undo', box(''), []],
    ['an unarmed field', unarmed('Tere kõik'), ['Tere']],
    ['no box', NO_BOX, ['Tere']],
  ])('with %s it is the page history', (_what, b, undo) => {
    for (const u of ['tagasi', 'back', 'go back']) {
      const step = inpageStep(session({ undo }), u, b)
      expect(step.commands).toEqual(only({ kind: 'history', direction: 'back' }))
      expect(step.line).toBe(ET.browserDoing({ kind: 'history', direction: 'back' }))
      expect(step.session.undo).toEqual([])
    }
  })

  it('"võta tagasi" stays undo whatever the box, "mine tagasi" stays the page history', () => {
    expect(inpageStep(session({ undo: ['Tere'] }), 'võta tagasi', box('')).commands).toEqual(only({ kind: 'setText', text: 'Tere' }))
    expect(inpageStep(session({ undo: ['Tere'] }), 'mine tagasi', box('Tere kõik')).commands).toEqual(only({ kind: 'history', direction: 'back' }))
  })

  it.each(['go bak', 'tagasy', 'go backk'])('"%s", one letter off, is never an undo: dictation', (u) => {
    const step = inpageStep(session({ undo: ['Tere'] }), u, box('Tere kõik'))
    expect(step.line).not.toBe(ET.inpage.undoing)
    expect(step.commands).not.toEqual(only({ kind: 'history', direction: 'back' }))
    expect(step.ask).toBe(true)
  })
})

describe('M7 soft words: one ordinary word while he is writing is a word of the message', () => {
  it.each(SOFT_WORDS)('"%s" with words in the armed box is dictation, asked of the model', (u) => {
    const step = inpageStep(session(), u, box('Tulen'))
    expect(step.commands).toEqual(only({ kind: 'setText', text: `Tulen ${u}` }))
    expect(step.ask).toBe(true)
  })

  it.each(['välja', 'siia', 'enter', 'sulge', 'edasi'])('"%s" with an empty, unarmed or absent box is the command', (u) => {
    for (const b of [box(''), box('  '), unarmed('Tere'), NO_BOX]) {
      const step = inpageStep(session(), u, b)
      expect(step.commands).toHaveLength(1)
      expect(step.commands[0]?.kind).not.toBe('setText')
      expect(step.ask).toBeUndefined()
    }
  })

  it('a two-word phrase is a command whatever the box ("pane kinni", "kirjuta siia")', () => {
    expect(inpageStep(session(), 'pane kinni', box('Tulen')).commands).toEqual(only({ kind: 'pressKey', key: 'Escape' }))
    expect(inpageStep(session(), 'kirjuta siia', box('Tulen')).commands).toEqual(only({ kind: 'arm', on: true }))
  })
})

describe('M7 the new phrases', () => {
  const YT = (q: string): BrowserCommand => ({ kind: 'goTo', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` })
  const G = (q: string): BrowserCommand => ({ kind: 'goTo', url: `https://www.google.com/search?q=${encodeURIComponent(q)}` })
  it.each<[string, BrowserCommand]>([
    ['uus leht', { kind: 'newTab' }],
    ['Ava uus leht.', { kind: 'newTab' }],
    ['uus aken', { kind: 'newTab' }],
    ['ava uus aken', { kind: 'newTab' }],
    ['new page', { kind: 'newTab' }],
    ['new window', { kind: 'newTab' }],
    ['open a new page', { kind: 'newTab' }],
    ['open a new window', { kind: 'newTab' }],
    ['sulge', { kind: 'closeTab' }],
    ['Sulge.', { kind: 'closeTab' }],
    ['close', { kind: 'closeTab' }],
    ['peida riba', { kind: 'bar', show: false }],
    ['peida ütle', { kind: 'bar', show: false }],
    ['hide the bar', { kind: 'bar', show: false }],
    ['näita riba', { kind: 'bar', show: true }],
    ['show the bar', { kind: 'bar', show: true }],
    ['kirjuta siia', { kind: 'arm', on: true }],
    ['Kirjuta siia.', { kind: 'arm', on: true }],
    ['siia', { kind: 'arm', on: true }],
    ['write here', { kind: 'arm', on: true }],
    ['type here', { kind: 'arm', on: true }],
    ['ära kirjuta siia', { kind: 'arm', on: false }],
    ['do not write here', { kind: 'arm', on: false }],
    ["don't write here", { kind: 'arm', on: false }],
    ['tühjenda otsing', { kind: 'clearField' }],
    ['kustuta otsing', { kind: 'clearField' }],
    ['tühjenda kast', { kind: 'clearField' }],
    ['clear the search', { kind: 'clearField' }],
    ['clear the field', { kind: 'clearField' }],
    ['sulge aken', { kind: 'pressKey', key: 'Escape' }],
    ['pane kinni', { kind: 'pressKey', key: 'Escape' }],
    ['välja', { kind: 'pressKey', key: 'Escape' }],
    ['escape', { kind: 'pressKey', key: 'Escape' }],
    ['close this', { kind: 'pressKey', key: 'Escape' }],
    ['enter', { kind: 'pressKey', key: 'Enter' }],
    ['sisesta', { kind: 'pressKey', key: 'Enter' }],
    ['kinnita', { kind: 'pressKey', key: 'Enter' }],
    ['otsi kassid', { kind: 'siteSearch', query: 'kassid' }],
    ['Otsi ilm Tallinnas.', { kind: 'siteSearch', query: 'ilm tallinnas' }],
    ['search for cats', { kind: 'siteSearch', query: 'cats' }],
    ['search cats', { kind: 'siteSearch', query: 'cats' }],
    ['otsi googlest ilm tallinnas', G('ilm tallinnas')],
    ['otsi google ilm', G('ilm')],
    ['guugelda ilm tallinnas', G('ilm tallinnas')],
    ['google ilm tallinnas', G('ilm tallinnas')],
    ['search google for bus times', G('bus times')],
    ["otsi youtube'ist kassid", YT('kassid')],
    ['otsi youtube’ist kassid', YT('kassid')],
    ['otsi youtubest kassid', YT('kassid')],
    ['otsi youtubeist kassid', YT('kassid')],
    ['search youtube for cats', YT('cats')],
    ['mängi', { kind: 'media', action: 'play' }],
    ['esita', { kind: 'media', action: 'play' }],
    ['play', { kind: 'media', action: 'play' }],
    ['paus', { kind: 'media', action: 'pause' }],
    ['peata', { kind: 'media', action: 'pause' }],
    ['pause', { kind: 'media', action: 'pause' }],
    ['stop the video', { kind: 'media', action: 'pause' }],
    ['vaigista', { kind: 'media', action: 'mute' }],
    ['heli maha', { kind: 'media', action: 'mute' }],
    ['mute', { kind: 'media', action: 'mute' }],
    ['heli tagasi', { kind: 'media', action: 'unmute' }],
    ['heli peale', { kind: 'media', action: 'unmute' }],
    ['unmute', { kind: 'media', action: 'unmute' }],
    ['heli valjemaks', { kind: 'media', action: 'volumeUp' }],
    ['valjemaks', { kind: 'media', action: 'volumeUp' }],
    ['kõvemaks', { kind: 'media', action: 'volumeUp' }],
    ['louder', { kind: 'media', action: 'volumeUp' }],
    ['volume up', { kind: 'media', action: 'volumeUp' }],
    ['heli vaiksemaks', { kind: 'media', action: 'volumeDown' }],
    ['pane heli vaiksemaks', { kind: 'media', action: 'volumeDown' }],
    ['vaiksemaks', { kind: 'media', action: 'volumeDown' }],
    ['quieter', { kind: 'media', action: 'volumeDown' }],
    ['volume down', { kind: 'media', action: 'volumeDown' }],
    ['täisekraan', { kind: 'media', action: 'fullscreen' }],
    ['full screen', { kind: 'media', action: 'fullscreen' }],
    ['välju täisekraanist', { kind: 'media', action: 'exitFullscreen' }],
    ['exit full screen', { kind: 'media', action: 'exitFullscreen' }],
    ['keri edasi', { kind: 'media', action: 'forward' }],
    ['keri tagasi', { kind: 'media', action: 'back' }],
  ])('"%s"', (u, command) => {
    // An empty armed box: with words in it the soft one-word phrases are dictation (below).
    const step = inpageStep(session({ undo: ['Tere'] }), u, box(''))
    expect(step.commands).toEqual(only(command))
    expect(step.line).toBe(ET.browserDoing(command))
    expect(step.ask).toBeUndefined()
    expect(inpageInstant(session(), u)).toBe(true)
    expect(inpagePreview(session(), u, box('Tere'))).toBeNull()
  })

  it('the new phrases work without any box', () => {
    expect(inpageStep(session(), 'uus leht', NO_BOX).commands).toEqual(only({ kind: 'newTab' }))
    expect(inpageStep(session(), 'paus', unarmed('')).commands).toEqual(only({ kind: 'media', action: 'pause' }))
  })

  it('media, bar and arm leave the labels and the undo texts; a search or a key does not', () => {
    const s = session({ hints: true, undo: ['a'] })
    for (const u of ['paus', 'heli valjemaks', 'peida riba', 'kirjuta siia', 'tühjenda kast']) {
      const step = inpageStep(s, u, box(''))
      expect(step.session.hints, u).toBe(true)
      expect(step.session.undo, u).toEqual(['a'])
    }
    for (const u of ['otsi kassid', 'sulge aken', 'enter', 'sulge']) {
      const step = inpageStep(s, u, box(''))
      expect(step.session.hints, u).toBe(false)
      expect(step.session.undo, u).toEqual([])
    }
  })

  it.each(['Ava aken', 'Sulgen akna', 'Mängin homme', 'Selge pilt', 'Sulle ka', 'Tulen siis homme', 'Uus aasta', 'Siia ma ei tule', 'Pane see kinni homme'])(
    '"%s" is still dictation',
    (u) => {
      const step = inpageStep(session(), u, box('Tere.'))
      expect(step.commands[0]?.kind).toBe('setText')
      expect(step.ask).toBe(true)
    },
  )

  it.each(['kirjuta siis', 'pane kinn'])('"%s" is never corrected into arming or a key', (u) => {
    const step = inpageStep(session(), u, EMPTY)
    expect(step.commands.some((c) => c.kind === 'arm' || c.kind === 'pressKey')).toBe(false)
  })

  it('a misheard new phrase is corrected and named', () => {
    const step = inpageStep(session(), 'heli valjemas', EMPTY)
    expect(step.commands).toEqual(only({ kind: 'media', action: 'volumeUp' }))
    expect(step.line).toBe(`${ET.inpage.understood('heli valjemaks')} ${ET.browserDoing({ kind: 'media', action: 'volumeUp' })}`)
  })
})

describe('M7 numbers while labels show', () => {
  it.each<[string, number]>([
    ['number viis', 5],
    ['vajuta viis', 5],
    ['vajuta number viis', 5],
    ['ava viis', 5],
    ['vali viis', 5],
    ['ava 12', 12],
    ['Vali 7.', 7],
    ['12.', 12],
    ['3,', 3],
    ['üksteist', 11],
    ['kaksteist', 12],
    ['Kolmteist.', 13],
    ['üheksateist', 19],
    ['kakskümmend', 20],
    ['kakskümmend üks', 21],
    ['kaks kümmend üks', 21],
    ['kakskümmend üheksa', 29],
    ['kolmkümmend', 30],
    ['ava kakskümmend kaks', 22],
    ['twenty one', 21],
    ['open five', 5],
    ['choose 4', 4],
  ])('"%s" clicks %i', (u, n) => {
    const step = inpageStep(session({ hints: true }), u, unarmed(''))
    expect(step.commands).toEqual(only({ kind: 'clickHint', number: n }))
    expect(step.session.hints).toBe(false)
    expect(inpageInstant(session({ hints: true }), u)).toBe(true)
    expect(inpagePreview(session({ hints: true }), u, box('Tere'))).toBeNull()
  })

  it.each(['ava viis', 'vali viis', 'üksteist', 'kakskümmend üks'])('without labels "%s" is not a click', (u) => {
    expect(inpageStep(session(), u, box('')).commands.some((c) => c.kind === 'clickHint')).toBe(false)
  })

  it.each(['stopp', 'stop', 'Stopp.', 'lõpeta'])('"%s" while labels show hides them', (u) => {
    const step = inpageStep(session({ hints: true }), u, box('Tere'))
    expect(step.commands).toEqual(only({ kind: 'hideHints' }))
    expect(step.session.hints).toBe(false)
    expect(inpageInstant(session({ hints: true }), u)).toBe(true)
  })

  it('"stopp" without labels is left to dictation (and so to the model)', () => {
    expect(inpageStep(session(), 'stopp', box('')).ask).toBe(true)
  })
})

describe('M7 applyIntent: the model\'s intent goes through the same act as the rules', () => {
  const intent = (i: PageIntent): PageIntent => i

  it('dictation into the armed box', () => {
    const step = applyIntent(session(), intent({ kind: 'dictate', text: ' kuidas  läheb ' }), page(box('Tere')))
    expect(step.commands).toEqual(only({ kind: 'setText', text: 'Tere kuidas läheb' }))
    expect(step.session.undo).toEqual(['Tere'])
    expect(step.line).toBe(ET.browserDoing({ kind: 'setText', text: 'Tere kuidas läheb' }))
    expect(step.ask).toBeUndefined()
  })

  it('dictation into an unarmed field is refused', () => {
    const s = session()
    const step = applyIntent(s, intent({ kind: 'dictate', text: 'kassid' }), page(unarmed('')))
    expect(step.commands).toEqual([])
    expect(step.line).toBe(ET.inpage.noPlaceToWrite)
    expect(step.session).toEqual(s)
    expect(applyIntent(s, intent({ kind: 'dictate', text: 'kassid' }), page(NO_BOX)).line).toBe(ET.inpage.pickField)
  })

  it.each<BrowserCommand>([
    { kind: 'media', action: 'volumeDown' },
    { kind: 'clickItem', id: 3 },
    { kind: 'siteSearch', query: 'kassid' },
    { kind: 'newTab' },
    { kind: 'bar', show: false },
  ])('command %j is one browser command with its line', (command) => {
    const step = applyIntent(session({ hints: true }), intent({ kind: 'command', command }), page(unarmed('')))
    expect(step.commands).toEqual(only(command))
    expect(step.line).toBe(ET.browserDoing(command))
  })

  it('a command that changes the page clears the labels and the undo texts', () => {
    const step = applyIntent(session({ hints: true, undo: ['a'] }), intent({ kind: 'command', command: { kind: 'clickItem', id: 3 } }), page(box('b')))
    expect(step.session.hints).toBe(false)
    expect(step.session.undo).toEqual([])
  })

  it('edit: undo and replace', () => {
    const undo = applyIntent(session({ undo: ['Tere'] }), intent({ kind: 'edit', edit: { kind: 'undo' } }), page(box('Tere kõik')))
    expect(undo.commands).toEqual(only({ kind: 'setText', text: 'Tere' }))
    expect(undo.line).toBe(ET.inpage.undoing)
    const replace = applyIntent(session(), intent({ kind: 'edit', edit: { kind: 'replace', from: 'kolm', to: 'neli' } }), page(box('Kell kolm.')))
    expect(replace.commands).toEqual(only({ kind: 'setText', text: 'Kell neli.' }))
    expect(replace.session.undo).toEqual(['Kell kolm.'])
    const unarmedEdit = applyIntent(session({ undo: ['x'] }), intent({ kind: 'edit', edit: { kind: 'clear' } }), page(unarmed('Tere')))
    expect(unarmedEdit.commands).toEqual([])
    expect(unarmedEdit.line).toBe(ET.inpage.noPlaceToWrite)
  })

  it('send, sleep and wake', () => {
    expect(applyIntent(session(), intent({ kind: 'send' }), page(box('Tere'))).commands).toEqual(only({ kind: 'pressSend' }))
    expect(applyIntent(session(), intent({ kind: 'send' }), page(unarmed('Tere'))).line).toBe(ET.inpage.noPlaceToWrite)
    expect(applyIntent(session(), intent({ kind: 'sleep' }), page(EMPTY)).session.asleep).toBe(true)
    expect(applyIntent(session({ asleep: true }), intent({ kind: 'wake' }), page(EMPTY)).session.asleep).toBe(false)
  })

  it('unclear gives its say, or the fixed line when it has none', () => {
    const s = session({ undo: ['a'] })
    const step = applyIntent(s, intent({ kind: 'unclear', say: 'Kas sa mõtlesid videot?' }), page(box('Tere')))
    expect(step.commands).toEqual([])
    expect(step.line).toBe('Kas sa mõtlesid videot?')
    expect(step.session).toEqual(s)
    expect(applyIntent(s, intent({ kind: 'unclear', say: '' }), page(box('Tere'))).line).toBe(ET.inpage.notUnderstood)
    expect(applyIntent(session({ lang: 'en' }), intent({ kind: 'unclear', say: '' }), page(box('Tere'))).line).toBe(EN.inpage.notUnderstood)
  })

  it('say comes first as "Sain aru: …"', () => {
    const command: BrowserCommand = { kind: 'newTab' }
    const step = applyIntent(session(), intent({ kind: 'command', command }), page(EMPTY), 'ava uus leht')
    expect(step.line).toBe(`${ET.inpage.understood('ava uus leht')} ${ET.browserDoing(command)}`)
    expect(step.line.startsWith('Sain aru: „ava uus leht“.')).toBe(true)
    const en = applyIntent(session({ lang: 'en' }), intent({ kind: 'command', command }), page(EMPTY), 'new tab')
    expect(en.line).toBe(`${EN.inpage.understood('new tab')} ${EN.browserDoing(command)}`)
  })
})

// ---------------------------------------------------------------------------------------------
// Round 3, the edit lane: the caret, a selection, typing at the caret and the editing keys.

describe('Round 3 editing: the fixed phrases', () => {
  const ESSAY = box('Tere homme. Kõik hästi, kell kolm sobib.')
  it.each<[string, BrowserCommand]>([
    ['mine algusesse', { kind: 'caret', to: 'start' }],
    ['Teksti algusesse.', { kind: 'caret', to: 'start' }],
    ['go to the start', { kind: 'caret', to: 'start' }],
    ['mine lõppu', { kind: 'caret', to: 'end' }],
    ['teksti lõppu', { kind: 'caret', to: 'end' }],
    ['go to the end', { kind: 'caret', to: 'end' }],
    ['rea algusesse', { kind: 'caret', to: 'lineStart' }],
    ['start of the line', { kind: 'caret', to: 'lineStart' }],
    ['rea lõppu', { kind: 'caret', to: 'lineEnd' }],
    ['end of the line', { kind: 'caret', to: 'lineEnd' }],
    ['lause algusesse', { kind: 'caret', to: 'sentenceStart' }],
    ['mine lause algusesse', { kind: 'caret', to: 'sentenceStart' }],
    ['start of the sentence', { kind: 'caret', to: 'sentenceStart' }],
    ['lause lõppu', { kind: 'caret', to: 'sentenceEnd' }],
    ['end of the sentence', { kind: 'caret', to: 'sentenceEnd' }],
    ['sõna tagasi', { kind: 'caret', to: 'wordBack' }],
    ['üks sõna tagasi', { kind: 'caret', to: 'wordBack' }],
    ['word back', { kind: 'caret', to: 'wordBack' }],
    ['sõna edasi', { kind: 'caret', to: 'wordForward' }],
    ['word forward', { kind: 'caret', to: 'wordForward' }],
    ['vali kõik', { kind: 'select', what: 'all' }],
    ['select all', { kind: 'select', what: 'all' }],
    ['vali see sõna', { kind: 'select', what: 'word' }],
    ['vali sõna', { kind: 'select', what: 'word' }],
    ['select the word', { kind: 'select', what: 'word' }],
    ['vali see lause', { kind: 'select', what: 'sentence' }],
    ['select the sentence', { kind: 'select', what: 'sentence' }],
    ['vali see rida', { kind: 'select', what: 'line' }],
    ['select the line', { kind: 'select', what: 'line' }],
    ['vali viimane sõna', { kind: 'select', what: 'lastWord' }],
    ['select the last word', { kind: 'select', what: 'lastWord' }],
    ['vali viimane lause', { kind: 'select', what: 'lastSentence' }],
    ['select the last sentence', { kind: 'select', what: 'lastSentence' }],
    ['kustuta täht', { kind: 'pressKey', key: 'Backspace' }],
    ['Kustuta üks täht.', { kind: 'pressKey', key: 'Backspace' }],
    ['kustuta valitud', { kind: 'pressKey', key: 'Backspace' }],
    ['kustuta see', { kind: 'pressKey', key: 'Backspace' }],
    ['delete a letter', { kind: 'pressKey', key: 'Backspace' }],
    ['delete the selection', { kind: 'pressKey', key: 'Backspace' }],
    ['kustuta ees', { kind: 'pressKey', key: 'Delete' }],
    ['delete forward', { kind: 'pressKey', key: 'Delete' }],
    ['vasakule', { kind: 'pressKey', key: 'ArrowLeft' }],
    ['arrow left', { kind: 'pressKey', key: 'ArrowLeft' }],
    ['paremale', { kind: 'pressKey', key: 'ArrowRight' }],
    ['arrow right', { kind: 'pressKey', key: 'ArrowRight' }],
    ['üks rida üles', { kind: 'pressKey', key: 'ArrowUp' }],
    ['rida üles', { kind: 'pressKey', key: 'ArrowUp' }],
    ['line up', { kind: 'pressKey', key: 'ArrowUp' }],
    ['üks rida alla', { kind: 'pressKey', key: 'ArrowDown' }],
    ['line down', { kind: 'pressKey', key: 'ArrowDown' }],
    ['tee uuesti', { kind: 'pressKey', key: 'Redo' }],
    ['redo', { kind: 'pressKey', key: 'Redo' }],
    ['järgmine väli', { kind: 'pressKey', key: 'Tab' }],
    ['next field', { kind: 'pressKey', key: 'Tab' }],
    // Counts.
    ['kustuta kolm tähte', { kind: 'pressKey', key: 'Backspace', times: 3 }],
    ['kustuta 3 tähte', { kind: 'pressKey', key: 'Backspace', times: 3 }],
    ['kustuta kaksteist tähte', { kind: 'pressKey', key: 'Backspace', times: 12 }],
    ['delete three letters', { kind: 'pressKey', key: 'Backspace', times: 3 }],
    ['vasakule kolm korda', { kind: 'pressKey', key: 'ArrowLeft', times: 3 }],
    ['kolm korda vasakule', { kind: 'pressKey', key: 'ArrowLeft', times: 3 }],
    ['kolm vasakule', { kind: 'pressKey', key: 'ArrowLeft', times: 3 }],
    ['paremale viis korda', { kind: 'pressKey', key: 'ArrowRight', times: 5 }],
    ['kaks paremale', { kind: 'pressKey', key: 'ArrowRight', times: 2 }],
    ['left three times', { kind: 'pressKey', key: 'ArrowLeft', times: 3 }],
    ['three times right', { kind: 'pressKey', key: 'ArrowRight', times: 3 }],
    ['kaks rida üles', { kind: 'pressKey', key: 'ArrowUp', times: 2 }],
    ['kolm rida alla', { kind: 'pressKey', key: 'ArrowDown', times: 3 }],
    ['two lines down', { kind: 'pressKey', key: 'ArrowDown', times: 2 }],
    // Typing at the caret: the words as said, without the closing full stop.
    ['kirjuta siia vahele homme kell viis.', { kind: 'typeText', text: 'homme kell viis' }],
    ['Kirjuta siia vahele väga.', { kind: 'typeText', text: 'väga' }],
    ['lisa siia tere', { kind: 'typeText', text: 'tere' }],
    ['sisesta homme kell viis', { kind: 'typeText', text: 'homme kell viis' }],
    ['insert hello there', { kind: 'typeText', text: 'hello there' }],
    ['type here hello', { kind: 'typeText', text: 'hello' }],
  ])('"%s"', (u, command) => {
    const step = inpageStep(session({ undo: ['x'] }), u, ESSAY)
    expect(step.commands).toEqual(only(command))
    expect(step.line).toBe(ET.browserDoing(command))
    expect(step.ask).toBeUndefined()
    expect(inpageInstant(session(), u)).toBe(true)
    expect(inpagePreview(session(), u, ESSAY)).toBeNull()
  })

  it('"kirjuta siia" alone still arms, "sisesta" alone is still Enter', () => {
    expect(inpageStep(session(), 'kirjuta siia', EMPTY).commands).toEqual(only({ kind: 'arm', on: true }))
    expect(inpageStep(session(), 'sisesta', EMPTY).commands).toEqual(only({ kind: 'pressKey', key: 'Enter' }))
  })

  it('"kolm sõna tagasi" is the caret command three times', () => {
    const back: BrowserCommand = { kind: 'caret', to: 'wordBack' }
    const step = inpageStep(session(), 'kolm sõna tagasi', ESSAY)
    expect(step.commands).toEqual([back, back, back])
    expect(step.line).toBe(ET.browserDoing(back))
    const forward: BrowserCommand = { kind: 'caret', to: 'wordForward' }
    expect(inpageStep(session(), 'two words forward', ESSAY).commands).toEqual([forward, forward])
    expect(inpageStep(session(), 'kaks sõna edasi', ESSAY).commands).toEqual([forward, forward])
  })

  it('"mitte X, vaid Y" stays the whole-box replacement', () => {
    expect(inpageStep(session(), 'mitte kolm, vaid neli', ESSAY).commands).toEqual(only({ kind: 'setText', text: 'Tere homme. Kõik hästi, kell neli sobib.' }))
  })

  it('English lines in an English session', () => {
    const step = inpageStep(session({ lang: 'en' }), 'vali kõik', ESSAY)
    expect(step.line).toBe(EN.browserDoing({ kind: 'select', what: 'all' }))
  })
})

describe('Round 3 editing: by a word that is in the box', () => {
  const ESSAY = box('Tere homme. Kõik hästi, kell kolm sobib. Lähen kooli.')
  it.each<[string, BrowserCommand]>([
    ['mine sõna homme ette', { kind: 'caret', to: { find: 'homme', where: 'before' } }],
    ['Mine sõna homme juurde.', { kind: 'caret', to: { find: 'homme', where: 'before' } }],
    ['sõna homme ette', { kind: 'caret', to: { find: 'homme', where: 'before' } }],
    ['enne sõna homme', { kind: 'caret', to: { find: 'homme', where: 'before' } }],
    ['mine sõna homme taha', { kind: 'caret', to: { find: 'homme', where: 'after' } }],
    ['mine sõna homme järele', { kind: 'caret', to: { find: 'homme', where: 'after' } }],
    ['pärast sõna homme', { kind: 'caret', to: { find: 'homme', where: 'after' } }],
    ['mine homme juurde', { kind: 'caret', to: { find: 'homme', where: 'before' } }],
    ['mine kell kolm juurde', { kind: 'caret', to: { find: 'kell kolm', where: 'before' } }],
    ['mine sõna kell kolm taha', { kind: 'caret', to: { find: 'kell kolm', where: 'after' } }],
    ['mine homme taha', { kind: 'caret', to: { find: 'homme', where: 'after' } }],
    ['go before homme', { kind: 'caret', to: { find: 'homme', where: 'before' } }],
    ['go to before the word homme', { kind: 'caret', to: { find: 'homme', where: 'before' } }],
    ['go after homme', { kind: 'caret', to: { find: 'homme', where: 'after' } }],
    ['vali sõna homme', { kind: 'select', what: { find: 'homme' } }],
    ['Vali homme.', { kind: 'select', what: { find: 'homme' } }],
    ['vali kell kolm', { kind: 'select', what: { find: 'kell kolm' } }],
    ['select homme', { kind: 'select', what: { find: 'homme' } }],
    ['select the word homme', { kind: 'select', what: { find: 'homme' } }],
    // "mine kooli juurde": the genitive extends the word in the box by a letter.
    ['mine kooli juurde', { kind: 'caret', to: { find: 'kooli', where: 'before' } }],
    ['vali kooli', { kind: 'select', what: { find: 'kooli' } }],
  ])('"%s"', (u, command) => {
    const step = inpageStep(session({ undo: ['x'], hints: true }), u, ESSAY)
    expect(step.commands).toEqual(only(command))
    expect(step.line).toBe(ET.browserDoing(command))
    expect(step.ask).toBeUndefined()
    expect(step.session.undo).toEqual(['x'])
    expect(step.session.hints).toBe(true)
    expect(inpageInstant(session(), u)).toBe(true)
    expect(inpagePreview(session(), u, ESSAY)).toBeNull()
  })

  it('"kustuta sõna X" selects the word and presses Backspace, with the old text to take back', () => {
    const step = inpageStep(session(), 'kustuta sõna homme', ESSAY)
    expect(step.commands).toEqual([{ kind: 'select', what: { find: 'homme' } }, { kind: 'pressKey', key: 'Backspace' }])
    expect(step.line).toBe(ET.inpage.deletingNamed('homme'))
    expect(step.session.undo).toEqual([ESSAY.text])
    expect(inpageStep(session({ lang: 'en' }), 'delete the word homme', ESSAY).line).toBe(EN.inpage.deletingNamed('homme'))
    expect(inpageInstant(session(), 'kustuta sõna homme')).toBe(true)
  })

  it.each(['vali Eesti', 'mine kokkuvõtte juurde', 'go before lunch', 'kustuta sõna kass', 'select Estonia'])(
    '"%s", a word that is not in the box, goes to the model as dictation would',
    (u) => {
      const step = inpageStep(session(), u, ESSAY)
      expect(step.ask).toBe(true)
      expect(setTextOf(step.commands).startsWith(ESSAY.text)).toBe(true)
      expect(step.line).toBe(ET.browserDoing(step.commands[0] ?? { kind: 'ping' }))
      const none = inpageStep(session(), u, NO_BOX)
      expect(none.ask).toBe(true)
      expect(none.commands).toEqual([])
      expect(none.line).toBe(ET.inpage.pickField)
    },
  )

  it('a one-letter correction never reaches a word-bound command', () => {
    const step = inpageStep(session(), 'valy homme', ESSAY)
    expect(step.commands[0]?.kind).toBe('setText')
    expect(step.ask).toBe(true)
  })
})

describe('Round 3 editing: the box, the undo texts and the labels', () => {
  it.each(['mine algusesse', 'vali kõik', 'kustuta täht', 'vasakule', 'kirjuta siia vahele tere', 'kolm sõna tagasi', 'tee uuesti'])(
    '"%s" without any box says to pick a field and emits nothing',
    (u) => {
      const s = session({ undo: ['x'] })
      const step = inpageStep(s, u, NO_BOX)
      expect(step.commands).toEqual([])
      expect(step.line).toBe(ET.inpage.pickField)
      expect(step.session).toEqual(s)
      expect(step.ask).toBeUndefined()
    },
  )

  it('a field the page focused by itself can still be edited (the caret is where he is)', () => {
    expect(inpageStep(session(), 'mine algusesse', unarmed('abc')).commands).toEqual(only({ kind: 'caret', to: 'start' }))
  })

  it('typing at the caret and the deleting keys push the old text for "võta tagasi"; moving does not', () => {
    const b = box('Tere homme')
    expect(inpageStep(session(), 'kirjuta siia vahele kell viis', b).session.undo).toEqual(['Tere homme'])
    expect(inpageStep(session(), 'kustuta täht', b).session.undo).toEqual(['Tere homme'])
    expect(inpageStep(session(), 'kustuta kolm tähte', b).session.undo).toEqual(['Tere homme'])
    expect(inpageStep(session(), 'kustuta ees', b).session.undo).toEqual(['Tere homme'])
    for (const u of ['vasakule', 'mine algusesse', 'vali kõik', 'tee uuesti', 'kolm sõna tagasi']) {
      expect(inpageStep(session(), u, b).session.undo, u).toEqual([])
    }
    const typed = inpageStep(session(), 'kirjuta siia vahele kell viis', b)
    const undone = inpageStep(typed.session, 'võta tagasi', box('Tere kell viis homme'))
    expect(undone.commands).toEqual(only({ kind: 'setText', text: 'Tere homme' }))
  })

  it('a failed typeText or deletion drops the entry it pushed; a success keeps it', () => {
    const b = box('Tere homme')
    const typed = inpageStep(session(), 'kirjuta siia vahele kell viis', b)
    const failed = inpageResult(typed.session, typed.commands, { ok: false, code: 'not_found', message: 'x' })
    expect(failed.session.undo).toEqual([])
    expect(failed.line).toBe(ET.browserFailed({ kind: 'typeText', text: 'kell viis' }, 'not_found'))
    const fine = inpageResult(typed.session, typed.commands, { ok: true, box: box('Tere kell viis homme') })
    expect(fine.session.undo).toEqual(['Tere homme'])
    expect(fine.line).toBe(ET.browserDone({ kind: 'typeText', text: 'kell viis' }, null, null))
    const named = inpageStep(session(), 'kustuta sõna homme', b)
    expect(inpageResult(named.session, named.commands, { ok: false, code: 'not_found', message: 'x' }).session.undo).toEqual([])
    const moved = inpageStep(session({ undo: ['a'] }), 'vasakule', b)
    expect(inpageResult(moved.session, moved.commands, { ok: false, code: 'failed', message: 'x' }).session.undo).toEqual(['a'])
  })

  it('editing keeps the labels and the undo texts; Escape, Enter and Tab do not', () => {
    const s = session({ hints: true, undo: ['a'] })
    for (const u of ['mine algusesse', 'vali kõik', 'vasakule', 'tee uuesti', 'sõna tagasi', 'kirjuta siia vahele tere']) {
      const step = inpageStep(s, u, box('Tere'))
      expect(step.session.hints, u).toBe(true)
      expect(step.session.undo[0], u).toBe('a')
    }
    for (const u of ['järgmine väli', 'enter', 'pane kinni']) {
      const step = inpageStep(s, u, box(''))
      expect(step.session.hints, u).toBe(false)
      expect(step.session.undo, u).toEqual([])
    }
  })

  it('the model may answer with the editing commands; they go through the same refusal', () => {
    const command: BrowserCommand = { kind: 'select', what: { find: 'homme' } }
    const step = applyIntent(session(), { kind: 'command', command }, page(box('Tere homme')), 'vali homme')
    expect(step.commands).toEqual(only(command))
    expect(applyIntent(session(), { kind: 'command', command }, page(NO_BOX)).line).toBe(ET.inpage.pickField)
    const typed = applyIntent(session(), { kind: 'command', command: { kind: 'typeText', text: 'kell viis' } }, page(box('Tere homme')))
    expect(typed.session.undo).toEqual(['Tere homme'])
  })

  it.each(['mine sõna homme ette', 'kustuta kolm tähte', 'kirjuta siia vahele homme kell viis', 'kolm sõna tagasi', 'vali viimane lause', 'vasakule kolm korda', 'go before homme', 'delete three letters'])(
    'no prefix of "%s" is ever typed as a preview',
    (u) => {
      for (const p of prefixes(u)) expect(preview(p, 'Tere homme'), p).toBeNull()
    },
  )

  it.each(['kustuta tähht', 'kolm sõna tagasy'])('"%s", a letter off a key or a count, is not corrected into it', (u) => {
    const step = inpageStep(session(), u, box('Tere homme'))
    expect(step.commands.some((c) => c.kind === 'pressKey')).toBe(false)
  })

  it('a misheard fixed editing phrase is corrected and named', () => {
    const step = inpageStep(session(), 'mine algusese', box('Tere'))
    expect(step.commands).toEqual(only({ kind: 'caret', to: 'start' }))
    expect(step.line).toBe(`${ET.inpage.understood('mine algusesse')} ${ET.browserDoing({ kind: 'caret', to: 'start' })}`)
  })
})
