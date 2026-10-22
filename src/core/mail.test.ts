import { describe, expect, it } from 'vitest'
import type { BoxState } from '../browser/protocol.ts'
import { initialInpage, inpageStep } from './inpage.ts'
import { GMAIL_HOME, composeUrl, mailCommand } from './mail.ts'

// Round 8 (docs/ARCHITECTURE.md 29.3.1, 29.3.2, 29.3.4): mail by voice.

describe('mail (29.3): compose by the rules', () => {
  it.each([
    ['kirjuta meil Marile', { kind: 'compose', to: 'Mari' }],
    ['Kirjuta meil Marile.', { kind: 'compose', to: 'Mari' }],
    ['kirjuta kiri Marile', { kind: 'compose', to: 'Mari' }],
    ['saada meil Jaanile', { kind: 'compose', to: 'Jaan' }],
    ['koosta e-kiri Mari Maasikale', { kind: 'compose', to: 'Mari Maasika' }],
    ['kirjuta meil Marile, et tulen homme', { kind: 'compose', to: 'Mari', body: 'Tulen homme.' }],
    ['uus meil', { kind: 'compose' }],
    ['uus kiri', { kind: 'compose' }],
    ['kirjuta meil', { kind: 'compose' }],
    ['kirjuta uus meil', { kind: 'compose' }],
    ['new email', { kind: 'compose' }],
    ['compose an email', { kind: 'compose' }],
    ['write an email to Mari', { kind: 'compose', to: 'Mari' }],
    ['send an email to Mari saying I will come tomorrow', { kind: 'compose', to: 'Mari', body: 'I will come tomorrow.' }],
  ])('"%s" is %j', (said, command) => {
    expect(mailCommand(said)).toEqual(command)
  })

  it.each(['kirjuta kirja lõppu aitäh', 'kirjuta Marile', 'meil on homme koosolek', 'saada', 'kirjuta et tulen', 'uus vaheleht'])('"%s" is not a mail command', (said) => {
    expect(mailCommand(said)).toBeNull()
  })
})

describe('mail (29.3): subject and cc by the rules', () => {
  it.each([
    ['teema: Koosolek', { kind: 'mailField', field: 'subject', text: 'Koosolek' }],
    ['teema koosolek homme', { kind: 'mailField', field: 'subject', text: 'Koosolek homme' }],
    ['teemaks reisipildid', { kind: 'mailField', field: 'subject', text: 'Reisipildid' }],
    ['subject: Meeting', { kind: 'mailField', field: 'subject', text: 'Meeting' }],
    ['lisa koopia', { kind: 'mailField', field: 'cc' }],
    ['Lisa koopia.', { kind: 'mailField', field: 'cc' }],
    ['lisa koopia Jaanile', { kind: 'mailField', field: 'cc', text: 'Jaan' }],
    ['add cc', { kind: 'mailField', field: 'cc' }],
    ['add a cc to Jaan', { kind: 'mailField', field: 'cc', text: 'Jaan' }],
  ])('"%s" is %j', (said, command) => {
    expect(mailCommand(said)).toEqual(command)
  })

  it.each(['teema', 'koopia', 'lisa', 'teemat ei ole'])('"%s" is not a mail command', (said) => {
    expect(mailCommand(said)).toBeNull()
  })
})

describe('mail (29.3): through inpageStep, the rules the engine runs', () => {
  const session = initialInpage('et')
  const NONE: BoxState = { present: false, text: '', armed: false, kind: 'none' }
  const TO: BoxState = { present: true, text: 'mari@example.ee', armed: true, kind: 'field', single: true, fieldKind: 'email', label: 'Saaja' }
  const SUBJECT: BoxState = { present: true, text: 'Koosolek', armed: true, kind: 'field', single: true, fieldKind: 'text', label: 'Teema' }
  const BODY: BoxState = { present: true, text: 'Tulen homme.', armed: true, kind: 'composer', label: 'Sõnum' }

  it('"kirjuta meil Marile" composes to Mari and is never a chat with "Meil Mari"', () => {
    const step = inpageStep(session, 'kirjuta meil Marile', NONE)
    expect(step.commands).toEqual([{ kind: 'compose', to: 'Mari' }])
    expect(step.ask).toBeUndefined()
    expect(inpageStep(session, 'kirjuta meil Marile, et tulen homme', NONE).commands).toEqual([{ kind: 'compose', to: 'Mari', body: 'Tulen homme.' }])
  })

  it('round 5 stays: "kirjuta meil" with a spelled address is that address, not a mail', () => {
    expect(mailCommand('kirjuta meil ralf ät gmail punkt com')).toBeNull()
    const step = inpageStep(session, 'kirjuta meil ralf ät gmail punkt com', TO)
    expect(step.commands).toEqual([{ kind: 'setText', text: 'ralf@gmail.com' }])
  })

  it('"teema: Koosolek" and "lisa koopia" run in the compose window, whatever box is armed', () => {
    expect(inpageStep(session, 'teema: Koosolek', TO).commands).toEqual([{ kind: 'mailField', field: 'subject', text: 'Koosolek' }])
    expect(inpageStep(session, 'lisa koopia', BODY).commands).toEqual([{ kind: 'mailField', field: 'cc' }])
  })

  it('"valmis" and "järgmine väli" in To and Subject move to the next field (Tab)', () => {
    expect(inpageStep(session, 'valmis', TO).commands).toEqual([{ kind: 'pressKey', key: 'Tab' }])
    expect(inpageStep(session, 'järgmine väli', SUBJECT).commands).toEqual([{ kind: 'pressKey', key: 'Tab' }])
    expect(inpageStep(initialInpage('en'), 'next field', TO).commands).toEqual([{ kind: 'pressKey', key: 'Tab' }])
  })

  it('"saada" in the mail body sends it', () => {
    expect(inpageStep(session, 'saada', BODY).commands).toEqual([{ kind: 'pressSend' }])
    expect(inpageStep(session, 'saada ära', BODY).commands).toEqual([{ kind: 'pressSend' }])
  })
})

describe('mail (29.3.4): the Gmail compose address', () => {
  it('to and subject, encoded; the body only when dictated', () => {
    expect(GMAIL_HOME).toBe('https://mail.google.com/mail/')
    expect(composeUrl(GMAIL_HOME, { to: 'mari@example.ee', subject: 'CV ja kiri' })).toBe('https://mail.google.com/mail/?view=cm&fs=1&to=mari%40example.ee&su=CV%20ja%20kiri')
    expect(composeUrl(GMAIL_HOME, { to: 'mari@example.ee', body: 'Tulen homme & aitäh.' })).toBe('https://mail.google.com/mail/?view=cm&fs=1&to=mari%40example.ee&body=Tulen%20homme%20%26%20ait%C3%A4h.')
    expect(composeUrl(GMAIL_HOME, {})).toBe('https://mail.google.com/mail/?view=cm&fs=1')
  })

  it('a base with a query of its own gets & instead of ?', () => {
    expect(composeUrl('http://127.0.0.1:5183/fixtures/gmail.html?x=1', { to: 'a@b.ee' })).toBe('http://127.0.0.1:5183/fixtures/gmail.html?x=1&view=cm&fs=1&to=a%40b.ee')
  })
})
