import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTIVE_HOLD_MS } from '../core/chain.ts'
import { quickReply } from '../core/quickReply.ts'
import { createAssembler } from './assembler.ts'

describe('assembler', () => {
  let heard: string[]
  const make = () =>
    createAssembler({
      holdMs: 1200,
      onUtterance: (text) => heard.push(text),
      isInstant: (text) => quickReply(text, { expectNumber: true }) !== null || text === 'next',
    })

  beforeEach(() => {
    vi.useFakeTimers()
    heard = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('releases a final after the hold', () => {
    const a = make()
    a.final('change the deadline to Friday')
    vi.advanceTimersByTime(1199)
    expect(heard).toEqual([])
    vi.advanceTimersByTime(1)
    expect(heard).toEqual(['change the deadline to Friday'])
  })

  it('joins two finals that arrive inside the hold', () => {
    const a = make()
    a.final('change the deadline')
    vi.advanceTimersByTime(800)
    a.final('to Friday')
    vi.advanceTimersByTime(1200)
    expect(heard).toEqual(['change the deadline to Friday'])
  })

  it('lets speech activity restart the hold', () => {
    const a = make()
    a.final('change the deadline')
    vi.advanceTimersByTime(1000)
    a.activity()
    vi.advanceTimersByTime(1000)
    expect(heard).toEqual([])
    vi.advanceTimersByTime(200)
    expect(heard).toEqual(['change the deadline'])
  })

  it('releases a lone instant command at once', () => {
    const a = make()
    a.final(' Yes. ')
    expect(heard).toEqual(['Yes.'])
    a.final('two')
    a.final('next')
    expect(heard).toEqual(['Yes.', 'two', 'next'])
  })

  it('joins an instant word that follows held text instead of releasing it alone', () => {
    const a = make()
    a.final('change the deadline')
    a.final('to')
    expect(heard).toEqual([])
    vi.advanceTimersByTime(1200)
    expect(heard).toEqual(['change the deadline to'])
  })

  it('takes the alternative that is an instant command when the first reading is not', () => {
    const a = make()
    a.final('yes sir', ['yes'])
    expect(heard).toEqual(['yes'])
  })

  it('prefers the first reading when it is itself instant', () => {
    const a = make()
    a.final('no', ['yes'])
    expect(heard).toEqual(['no'])
  })

  it('ignores alternatives once something is held', () => {
    const a = make()
    a.final('change the deadline')
    a.final('too Friday', ['two'])
    vi.advanceTimersByTime(1200)
    expect(heard).toEqual(['change the deadline too Friday'])
  })

  it('holds the first reading when no reading is instant', () => {
    const a = make()
    a.final('change it', ['chain it'])
    expect(heard).toEqual([])
    vi.advanceTimersByTime(1200)
    expect(heard).toEqual(['change it'])
  })

  it('ignores empty finals and activity with nothing held', () => {
    const a = make()
    a.final('   ')
    a.activity()
    vi.advanceTimersByTime(5000)
    expect(heard).toEqual([])
  })

  it('cancels a pending release on dispose', () => {
    const a = make()
    a.final('change the deadline')
    a.dispose()
    vi.advanceTimersByTime(5000)
    expect(heard).toEqual([])
  })
})

describe('assembler: chains across pauses (round 4)', () => {
  let heard: string[]
  let continued: Array<[string, string]>
  const make = (withContinue = true) =>
    createAssembler({
      holdMs: 700,
      connectiveHoldMs: CONNECTIVE_HOLD_MS,
      onUtterance: (text) => heard.push(text),
      ...(withContinue ? { onUtteranceContinued: (text: string, added: string) => continued.push([text, added]) } : {}),
      isInstant: (text) => text === 'jah' || text === 'keri alla ja',
    })

  beforeEach(() => {
    vi.useFakeTimers()
    heard = []
    continued = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds a final that ends with a connective for the long hold, and joins the next one', () => {
    const a = make()
    a.final('mine whatsappi ja')
    vi.advanceTimersByTime(CONNECTIVE_HOLD_MS - 1)
    expect(heard).toEqual([])
    a.final('ava Karin')
    vi.advanceTimersByTime(700)
    expect(heard).toEqual(['mine whatsappi ja ava Karin'])
  })

  it('delivers a connective-ending final on its own once the long hold passes', () => {
    const a = make()
    a.final('mine whatsappi ja siis')
    vi.advanceTimersByTime(CONNECTIVE_HOLD_MS)
    expect(heard).toEqual(['mine whatsappi ja siis'])
  })

  it('the hold is the long one whenever the held text ends with a connective, the normal one otherwise', () => {
    const a = make()
    a.final('mine whatsappi')
    a.final('ja')
    vi.advanceTimersByTime(700)
    expect(heard).toEqual([])
    vi.advanceTimersByTime(CONNECTIVE_HOLD_MS - 700)
    expect(heard).toEqual(['mine whatsappi ja'])
  })

  it('never releases a connective-ending text as instant', () => {
    const a = make()
    a.final('keri alla ja')
    expect(heard).toEqual([])
    vi.advanceTimersByTime(CONNECTIVE_HOLD_MS)
    expect(heard).toEqual(['keri alla ja'])
  })

  it('a final that starts with a connective soon after a delivery continues it', () => {
    const a = make()
    a.final('mine whatsappi')
    vi.advanceTimersByTime(700)
    expect(heard).toEqual(['mine whatsappi'])
    vi.advanceTimersByTime(1000)
    a.final('siis ava Karin')
    vi.advanceTimersByTime(700)
    expect(heard).toEqual(['mine whatsappi'])
    expect(continued).toEqual([['mine whatsappi siis ava Karin', 'siis ava Karin']])
  })

  it('a continuation may itself be continued, and joins what follows inside its hold', () => {
    const a = make()
    a.final('mine whatsappi')
    vi.advanceTimersByTime(700)
    a.final('siis ava Karin ja')
    vi.advanceTimersByTime(1000)
    a.final('kustuta see')
    vi.advanceTimersByTime(700)
    expect(continued).toEqual([['mine whatsappi siis ava Karin ja kustuta see', 'siis ava Karin ja kustuta see']])
    vi.advanceTimersByTime(1000)
    a.final('seejärel saada')
    vi.advanceTimersByTime(700)
    expect(continued.at(-1)).toEqual(['mine whatsappi siis ava Karin ja kustuta see seejärel saada', 'seejärel saada'])
    expect(heard).toEqual(['mine whatsappi'])
  })

  it('too long after the delivery, a connective-led final is an utterance of its own', () => {
    const a = make()
    a.final('mine whatsappi')
    vi.advanceTimersByTime(700)
    vi.advanceTimersByTime(CONNECTIVE_HOLD_MS)
    a.final('siis ava Karin')
    vi.advanceTimersByTime(700)
    expect(heard).toEqual(['mine whatsappi', 'siis ava Karin'])
    expect(continued).toEqual([])
  })

  it('a quick reply delivered at once can be continued too', () => {
    const a = make()
    a.final('jah')
    expect(heard).toEqual(['jah'])
    a.final('siis keri alla')
    vi.advanceTimersByTime(700)
    expect(continued).toEqual([['jah siis keri alla', 'siis keri alla']])
  })

  it('without a continuation handler, the final is delivered as its own utterance', () => {
    const a = make(false)
    a.final('mine whatsappi')
    vi.advanceTimersByTime(700)
    a.final('siis ava Karin')
    vi.advanceTimersByTime(700)
    expect(heard).toEqual(['mine whatsappi', 'siis ava Karin'])
  })

  it('a connective-led final while something is held simply joins it', () => {
    const a = make()
    a.final('mine whatsappi')
    a.final('siis ava Karin')
    vi.advanceTimersByTime(700)
    expect(heard).toEqual(['mine whatsappi siis ava Karin'])
    expect(continued).toEqual([])
  })
})
