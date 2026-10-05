import type { Lang } from './strings.ts'

export type BlockType = 'h1' | 'h2' | 'p' | 'li'

export interface Block {
  id: string
  type: BlockType
  text: string
}

/** Blocks in document order. A block's number is its position, so it is derived, not stored. */
export type Doc = Block[]

/** 1-based position of a block, 0 when the id names no block. */
export function numberOf(doc: Doc, id: string): number {
  return doc.findIndex((block) => block.id === id) + 1
}

/** An id no block in the document uses: 'b' followed by the highest numeric suffix plus one. */
export function newBlockId(doc: Doc): string {
  let highest = 0
  for (const block of doc) {
    const match = /^b(\d+)$/.exec(block.id)
    if (match?.[1]) highest = Math.max(highest, Number(match[1]))
  }
  return `b${highest + 1}`
}

/** The meeting minutes from the approved mock-up. Names are invented. */
export const SAMPLE_DOC: Doc = [
  { id: 'b1', type: 'h1', text: 'Minutes: supplier onboarding project' },
  { id: 'b2', type: 'p', text: 'Attendees: Kadri Tamm, Marten Kask, Liis Org' },
  { id: 'b3', type: 'h2', text: 'Summary' },
  {
    id: 'b4',
    type: 'p',
    text:
      'The pilot with the first supplier went live on 28 September. ' +
      'The supplier reported two invoice errors in the first week, which were corrected the same day. ' +
      'The team agreed that the supplier portal needs clearer upload instructions before the second supplier joins.',
  },
  { id: 'b5', type: 'h2', text: 'Budget' },
  {
    id: 'b6',
    type: 'p',
    text: 'Spending is within plan. The revised budget must be sent to finance by Thursday.',
  },
  { id: 'b7', type: 'h2', text: 'Next steps' },
  { id: 'b8', type: 'li', text: 'Liis updates the upload instructions.' },
  { id: 'b9', type: 'h2', text: 'Risks' },
  { id: 'b10', type: 'p', text: 'The second supplier has not confirmed a start date.' },
]

/** The same minutes in Estonian, with the same ids, for the Estonian-first profile. */
export const SAMPLE_DOC_ET: Doc = [
  { id: 'b1', type: 'h1', text: 'Protokoll: tarnijate liitmise projekt' },
  { id: 'b2', type: 'p', text: 'Osalejad: Kadri Tamm, Marten Kask, Liis Org' },
  { id: 'b3', type: 'h2', text: 'Kokkuvõte' },
  {
    id: 'b4',
    type: 'p',
    text:
      'Piloot esimese tarnijaga läks käima 28. septembril. ' +
      'Tarnija teatas esimesel nädalal kahest arvevigast, mis parandati samal päeval. ' +
      'Meeskond leppis kokku, et tarnijaportaali üleslaadimise juhend peab enne teise tarnija liitumist selgemaks saama.',
  },
  { id: 'b5', type: 'h2', text: 'Eelarve' },
  { id: 'b6', type: 'p', text: 'Kulud on plaani piires. Uuendatud eelarve tuleb saata rahandusosakonnale neljapäevaks.' },
  { id: 'b7', type: 'h2', text: 'Järgmised sammud' },
  { id: 'b8', type: 'li', text: 'Liis uuendab üleslaadimise juhendit.' },
  { id: 'b9', type: 'h2', text: 'Riskid' },
  { id: 'b10', type: 'p', text: 'Teine tarnija ei ole alguskuupäeva veel kinnitanud.' },
]

/** The sample document in a language. */
export function sampleDoc(lang: Lang): Doc {
  return lang === 'et' ? SAMPLE_DOC_ET : SAMPLE_DOC
}
