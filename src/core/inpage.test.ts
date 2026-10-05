import { describe, expect, it } from 'vitest'
import type { BoxState, BrowserCommand, BrowserResult } from '../browser/protocol.ts'
import { initialInpage, inpageInstant, inpageResult, inpageStep } from './inpage.ts'
import type { InpageSession } from './inpage.ts'
import { STRINGS } from './strings.ts'
import { deepFreeze } from './testUtil.ts'

const ET = STRINGS.et
const EN = STRINGS.en

function session(over: Partial<InpageSession> = {}): InpageSession {
  return deepFreeze({ ...initialInpage('et'), ...over })
}
function box(text: string): BoxState {
  return { present: true, text }
}
const NO_BOX: BoxState = { present: false, text: '' }
const EMPTY: BoxState = box('')

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
    ['otsi ilm tallinnas', { kind: 'goTo', url: 'https://www.google.com/search?q=ilm%20tallinnas' }],
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
    expect(inpageStep(session(), u, box('Tere')).commands).toEqual(only(command))
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
    ['Ma ei tule.', 'Sest olen haige', 'Ma ei tule, sest olen haige'],
    ['Ma tulen.', 'aga hiljem', 'Ma tulen, aga hiljem'],
    ['Nägin Mari juures', 'Mari ütles', 'Nägin Mari juures Mari ütles'],
    ['Kirjutasin Marile', 'Mari ei vastanud', 'Kirjutasin Marile mari ei vastanud'],
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
]

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
    const step = inpageStep(session(), u, box('kolm kolm. Tere'))
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
    const step = inpageStep(session({ hints: true }), u, box('kolm kolm. Tere'))
    for (const c of step.commands) {
      if (c.kind === 'setText') expect(c.text.toLowerCase()).not.toContain(u.toLowerCase())
      if (c.kind === 'insertText') throw new Error('in-page mode never uses insertText')
    }
  })
})
