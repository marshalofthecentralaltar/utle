import { describe, expect, it } from 'vitest'
import { markCandidates } from './candidates.ts'
import type { Block } from './document.ts'

const block: Block = {
  id: 'b4',
  type: 'p',
  text: 'First supplier sentence. Second supplier sentence. Third one.',
}

describe('markCandidates', () => {
  it('splits the block at each quote and badges the parts in candidate order', () => {
    const parts = markCandidates(block, [
      { blockId: 'b4', quote: 'First supplier sentence.' },
      { blockId: 'b4', quote: 'Second supplier sentence.' },
    ])
    expect(parts).toEqual([
      { text: 'First supplier sentence. ', badges: [1] },
      { text: 'Second supplier sentence. Third one.', badges: [2] },
    ])
  })

  it('keeps the text before the first quote as an unbadged part', () => {
    const parts = markCandidates(block, [{ blockId: 'b4', quote: 'Second supplier sentence.' }])
    expect(parts).toEqual([
      { text: 'First supplier sentence. ', badges: [] },
      { text: 'Second supplier sentence. Third one.', badges: [1] },
    ])
  })

  it('uses the position of the candidate in the whole list as its number', () => {
    const parts = markCandidates(block, [
      { blockId: 'b9', quote: 'elsewhere' },
      { blockId: 'b4', quote: 'Third one.' },
    ])
    expect(parts.at(-1)).toEqual({ text: 'Third one.', badges: [2] })
  })

  it('badges the start of the block when a quote is not found', () => {
    const parts = markCandidates(block, [{ blockId: 'b4', quote: 'not in the text' }])
    expect(parts).toEqual([{ text: block.text, badges: [1] }])
  })

  it('returns the whole block unbadged when no candidate names it', () => {
    expect(markCandidates(block, [{ blockId: 'b9', quote: 'x' }])).toEqual([
      { text: block.text, badges: [] },
    ])
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
