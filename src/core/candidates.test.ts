import { describe, expect, it } from 'vitest'
import { markCandidates } from './candidates.ts'
import type { Block } from './document.ts'

const block: Block = {
  id: 'b4',
  type: 'p',
  text: 'First supplier sentence. Second supplier sentence. Third one.',
}

describe('markCandidates', () => {
  it('highlights each quote, numbers it, and leaves the text between plain', () => {
    const parts = markCandidates(block, [
      { blockId: 'b4', quote: 'First supplier sentence.' },
      { blockId: 'b4', quote: 'Second supplier sentence.' },
    ])
    expect(parts).toEqual([
      { text: 'First supplier sentence.', badges: [1], highlight: true },
      { text: ' ', badges: [], highlight: false },
      { text: 'Second supplier sentence.', badges: [2], highlight: true },
      { text: ' Third one.', badges: [], highlight: false },
    ])
  })

  it('keeps the text before the first quote plain', () => {
    const parts = markCandidates(block, [{ blockId: 'b4', quote: 'Second supplier sentence.' }])
    expect(parts[0]).toEqual({ text: 'First supplier sentence. ', badges: [], highlight: false })
    expect(parts[1]).toEqual({ text: 'Second supplier sentence.', badges: [1], highlight: true })
  })

  it('uses the position of the candidate in the whole list as its number', () => {
    const parts = markCandidates(block, [
      { blockId: 'b9', quote: 'elsewhere' },
      { blockId: 'b4', quote: 'Third one.' },
    ])
    expect(parts.at(-1)).toEqual({ text: 'Third one.', badges: [2], highlight: true })
  })

  it('puts the number at the start of the block when a quote is not found', () => {
    const parts = markCandidates(block, [{ blockId: 'b4', quote: 'not in the text' }])
    expect(parts).toEqual([
      { text: '', badges: [1], highlight: false },
      { text: block.text, badges: [], highlight: false },
    ])
  })

  it('returns the whole block plain when no candidate names it', () => {
    expect(markCandidates(block, [{ blockId: 'b9', quote: 'x' }])).toEqual([
      { text: block.text, badges: [], highlight: false },
    ])
  })

  it('gives two candidates with the same quote one highlighted part with both numbers', () => {
    const parts = markCandidates(block, [
      { blockId: 'b4', quote: 'Third one.' },
      { blockId: 'b4', quote: 'Third one.' },
    ])
    expect(parts.at(-1)).toEqual({ text: 'Third one.', badges: [1, 2], highlight: true })
  })

  it('never overlaps: a quote that runs into the next one is cut where the next begins', () => {
    const parts = markCandidates(block, [
      { blockId: 'b4', quote: 'First supplier sentence. Second' },
      { blockId: 'b4', quote: 'Second supplier sentence.' },
    ])
    expect(parts.map((p) => p.text).join('')).toBe(block.text)
    expect(parts.filter((p) => p.highlight).map((p) => p.badges)).toEqual([[1], [2]])
  })

  it('always rebuilds the block text', () => {
    const parts = markCandidates(block, [
      { blockId: 'b4', quote: 'Third one.' },
      { blockId: 'b4', quote: 'missing' },
      { blockId: 'b4', quote: 'Second supplier sentence.' },
    ])
    expect(parts.map((p) => p.text).join('')).toBe(block.text)
  })
})
