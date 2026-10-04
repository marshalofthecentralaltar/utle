import type { Block } from './document.ts'

/** One place the user might have meant: a block and an exact quote from it. */
export interface Candidate {
  blockId: string
  quote: string
}

/**
 * A run of block text. Badges are the 1-based candidate numbers shown before it.
 * highlight is true for the quoted words themselves, so only they are marked.
 */
export interface MarkedPart {
  text: string
  badges: number[]
  highlight: boolean
}

/**
 * Splits a block's text around the candidate quotes. Each quote becomes a highlighted part
 * carrying its candidate's number. A quote that cannot be found puts its number at the start
 * of the block. Joining the parts gives the text back.
 */
export function markCandidates(block: Block, candidates: readonly Candidate[]): MarkedPart[] {
  const ranges = new Map<number, { end: number; badges: number[] }>()
  const unplaced: number[] = []

  candidates.forEach((candidate, index) => {
    if (candidate.blockId !== block.id) return
    const start = candidate.quote === '' ? -1 : block.text.indexOf(candidate.quote)
    if (start < 0) {
      unplaced.push(index + 1)
      return
    }
    const end = start + candidate.quote.length
    const known = ranges.get(start)
    ranges.set(start, { end: Math.max(end, known?.end ?? 0), badges: [...(known?.badges ?? []), index + 1] })
  })

  const parts: MarkedPart[] = []
  if (unplaced.length > 0) parts.push({ text: '', badges: unplaced, highlight: false })

  const starts = [...ranges.keys()].sort((a, b) => a - b)
  let cursor = 0
  starts.forEach((start, i) => {
    const range = ranges.get(start)
    if (!range) return
    const from = Math.max(start, cursor)
    const to = Math.max(from, Math.min(range.end, starts[i + 1] ?? block.text.length))
    if (from > cursor) parts.push({ text: block.text.slice(cursor, from), badges: [], highlight: false })
    parts.push({ text: block.text.slice(from, to), badges: range.badges, highlight: true })
    cursor = to
  })
  if (cursor < block.text.length || parts.length === 0) {
    parts.push({ text: block.text.slice(cursor), badges: [], highlight: false })
  }
  return parts
}
