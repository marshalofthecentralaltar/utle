import type { Block } from './document.ts'

/** One place the user might have meant: a block and an exact quote from it. */
export interface Candidate {
  blockId: string
  quote: string
}

/** A run of block text. Badges are the 1-based candidate numbers shown before it. */
export interface MarkedPart {
  text: string
  badges: number[]
}

/**
 * Splits a block's text so each candidate quote starts a part carrying that candidate's number.
 * A quote that cannot be found badges the start of the block. Joining the parts gives the text back.
 */
export function markCandidates(block: Block, candidates: readonly Candidate[]): MarkedPart[] {
  const badgesAt = new Map<number, number[]>()
  candidates.forEach((candidate, index) => {
    if (candidate.blockId !== block.id) return
    const found = candidate.quote === '' ? -1 : block.text.indexOf(candidate.quote)
    const at = Math.max(found, 0)
    badgesAt.set(at, [...(badgesAt.get(at) ?? []), index + 1])
  })

  const cuts = [...badgesAt.keys()].sort((x, y) => x - y)
  if (cuts.length === 0) return [{ text: block.text, badges: [] }]

  const parts: MarkedPart[] = []
  const first = cuts[0] ?? 0
  if (first > 0) parts.push({ text: block.text.slice(0, first), badges: [] })
  cuts.forEach((cut, i) => {
    const end = cuts[i + 1] ?? block.text.length
    parts.push({ text: block.text.slice(cut, end), badges: badgesAt.get(cut) ?? [] })
  })
  return parts
}
