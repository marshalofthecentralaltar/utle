import { describe, expect, it } from 'vitest'
import type { BoxState, PageContext } from '../browser/protocol.ts'
import { besideCommands, choicePick, formInProgress, ranOf, recentFrom, RECENT_RAN_CHARS } from './meant.ts'
import { applyIntent, initialInpage, inpageStep } from './inpage.ts'
import { STRINGS } from './strings.ts'

// Round 10 (#5, ARCHITECTURE 34): what he meant, on the page he is on.

const NO_BOX: BoxState = { present: false, text: '', armed: false }
const page = (over: Partial<PageContext> = {}): PageContext => ({ url: 'https://www.err.ee/', title: 'ERR', box: NO_BOX, items: [], media: null, hints: false, ...over })

describe('formInProgress (34.3): a login or a form he is in the middle of', () => {
  it.each([
    ['https://console.anthropic.com/login?returnTo=%2Fsettings', 'Anthropic Console'],
    ['https://accounts.google.com/v3/signin/identifier', 'Google'],
    ['https://example.ee/', 'Verify your email | Example'],
    ['https://www.eesti.ee/', 'Logi sisse | eesti.ee'],
    ['https://pood.ee/kassa', 'Kinnita tellimus'],
    ['https://example.com/signup', 'Create your account'],
  ])('%s "%s" is in progress', (url, title) => {
    expect(formInProgress(page({ url, title }))).toBe(true)
  })

  it('a password or code field, or words he has not sent, are in progress', () => {
    expect(formInProgress(page({ box: { present: true, text: '', armed: false, kind: 'field', fieldKind: 'password', single: true } }))).toBe(true)
    expect(formInProgress(page({ box: { present: true, text: '', armed: false, kind: 'field', fieldKind: 'code', single: true } }))).toBe(true)
    expect(formInProgress(page({ box: { present: true, text: 'Tulen homme', armed: true, kind: 'composer' } }))).toBe(true)
  })

  it('a page with only a search box, an empty composer or a newsletter field is not', () => {
    expect(formInProgress(page())).toBe(false)
    expect(formInProgress(page({ box: { present: true, text: 'kassid', armed: false, kind: 'search' } }))).toBe(false)
    expect(formInProgress(page({ box: { present: true, text: '', armed: true, kind: 'composer' } }))).toBe(false)
    expect(formInProgress(page({ box: { present: true, text: '', armed: false, kind: 'field', fieldKind: 'email', single: true } }))).toBe(false)
    expect(formInProgress(page({ url: 'https://www.youtube.com/', title: 'Logistika ja tarneahelad - YouTube' }))).toBe(false)
  })
})

describe('besideCommands (34.3): a site opened while a login is in progress goes to a new tab', () => {
  const login = page({ url: 'https://console.anthropic.com/login', title: 'Log in | Anthropic Console' })
  it('goTo becomes newTab with the same address; the tab in front is not touched', () => {
    expect(besideCommands([{ kind: 'goTo', url: 'https://mail.google.com/' }], login)).toEqual([{ kind: 'newTab', url: 'https://mail.google.com/' }])
  })
  it('anything else, or a page not in progress, is unchanged', () => {
    const click = [{ kind: 'clickItem' as const, id: 3 }]
    expect(besideCommands(click, login)).toBe(click)
    const go = [{ kind: 'goTo' as const, url: 'https://mail.google.com/' }]
    expect(besideCommands(go, page())).toBe(go)
  })
})

describe('ranOf (34.2): what ran, for the recent commands the model sees', () => {
  it('names each command with its target, and an item by its text when the page is known', () => {
    const items = [{ id: 13, role: 'row', text: 'Anthropic · Verify your email address' }]
    expect(ranOf([{ kind: 'newTab', url: 'https://mail.google.com/' }], '')).toBe('newTab https://mail.google.com/')
    expect(ranOf([{ kind: 'clickItem', id: 13 }], '', items)).toBe('clickItem 13 "Anthropic · Verify your email address"')
    expect(ranOf([{ kind: 'switchTab', to: { index: 2 } }], '')).toBe('switchTab {"index":2}')
    expect(ranOf([{ kind: 'history', direction: 'back' }], '')).toBe('history back')
    expect(ranOf([{ kind: 'setText', text: 'Tere' }, { kind: 'pressSend' }], '')).toBe('typed into the box; pressSend')
  })
  it('a step with nothing to run says what the strip said', () => {
    expect(ranOf([], 'Puhkan.')).toBe('nothing; said "Puhkan."')
  })
  it('recentFrom joins the steps and clips them to the schema', () => {
    expect(recentFrom('ava email', ['newTab https://mail.google.com/'], true, '2 "Log in"')).toEqual({ utterance: 'ava email', ran: 'newTab https://mail.google.com/', ok: true, from: '2 "Log in"' })
    expect(recentFrom('a'.repeat(300), ['x'.repeat(150), 'y'.repeat(150)], false).ran).toHaveLength(RECENT_RAN_CHARS)
    expect(recentFrom('a'.repeat(300), [], false).utterance).toHaveLength(200)
  })
})

describe('the tie (34.4): "Kumb: 1 …, 2 …?" and the answer', () => {
  const tie = page({ items: [{ id: 4, role: 'link', text: 'Ava' }, { id: 7, role: 'link', text: '[allpool] Ava kiri' }] })
  const asked = () => applyIntent(initialInpage('et'), { kind: 'choose', ids: [4, 7] }, tie)

  it('choose runs nothing and asks one question with the two numbers', () => {
    const step = asked()
    expect(step.commands).toEqual([])
    expect(step.line).toBe('Kumb: 1 Ava, 2 Ava kiri?')
    expect(step.session.choosingItems).toEqual([4, 7])
    expect(applyIntent(initialInpage('en'), { kind: 'choose', ids: [7, 4] }, tie).line).toBe('Which one: 1 Ava kiri, 2 Ava?')
  })

  it.each([
    ['üks', 4], ['kaks', 7], ['esimene', 4], ['teine', 7], ['Teine.', 7], ['1', 4], ['2', 7], ['number kaks', 7], ['esimest', 4], ['one', 4], ['second', 7],
  ])('"%s" clicks its item and ends the question', (utterance, id) => {
    const step = inpageStep(asked().session, utterance, NO_BOX)
    expect(step.commands).toEqual([{ kind: 'clickItem', id }])
    expect(step.ask).toBeUndefined()
    expect(step.session.choosingItems ?? null).toBeNull()
  })

  it('anything else cancels the question and is heard as usual', () => {
    const step = inpageStep(asked().session, 'uus leht', NO_BOX)
    expect(step.commands).toEqual([{ kind: 'newTab' }])
    expect(step.session.choosingItems ?? null).toBeNull()
    // The question is over: "kaks" now is what it always was.
    expect(inpageStep(step.session, 'kaks', NO_BOX).commands).not.toEqual([{ kind: 'clickItem', id: 7 }])
  })

  it('the answer wins over the numbered labels', () => {
    const step = inpageStep({ ...asked().session, hints: true }, 'kaks', NO_BOX)
    expect(step.commands).toEqual([{ kind: 'clickItem', id: 7 }])
  })

  it('choicePick reads the answer words only', () => {
    expect(choicePick('kaks')).toBe(1)
    expect(choicePick('number üks')).toBe(0)
    expect(choicePick('kolm')).toBeNull()
    expect(choicePick('ava kiri')).toBeNull()
    expect(STRINGS.et.inpage.whichItem(['Ava', 'Ava kiri'])).toBe('Kumb: 1 Ava, 2 Ava kiri?')
  })
})
