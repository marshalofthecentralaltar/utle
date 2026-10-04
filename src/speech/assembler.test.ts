import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAssembler } from './assembler.ts'

describe('assembler', () => {
  let heard: string[]
  const make = () => createAssembler({ holdMs: 1200, onUtterance: (text) => heard.push(text) })

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

  it('releases a lone quick reply at once', () => {
    const a = make()
    a.final(' Yes. ')
    expect(heard).toEqual(['Yes.'])
    a.final('two')
    expect(heard).toEqual(['Yes.', 'two'])
  })

  it('joins a quick word that follows held text instead of releasing it alone', () => {
    const a = make()
    a.final('change the deadline')
    a.final('to')
    expect(heard).toEqual([])
    vi.advanceTimersByTime(1200)
    expect(heard).toEqual(['change the deadline to'])
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
