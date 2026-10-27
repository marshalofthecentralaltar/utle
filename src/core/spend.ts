/**
 * Round 9 (ARCHITECTURE 30.5.4): what one task (one utterance to its end) cost the model. Counts
 * and names only: no words, no page, no address. Pure: the engine fills it, the service worker keeps
 * a ring of the last SPEND_RING under SPEND_KEY.
 */

export type SpendOutcome = 'done' | 'stopped' | 'unclear' | 'cancelled' | 'tookTooLong' | 'rules'

export interface SpendRecord {
  outcome: SpendOutcome
  /** Questions to the model, failed ones included. */
  asks: number
  /** Page steps the model's answers ran. */
  steps: number
  /** Goals the task worked through: 1, or the chain's goals reached. */
  goals: number
  /** Tokens not read from the cache (full-price input and cache writes), read from it, and generated. */
  input: number
  cacheRead: number
  output: number
  /** Time spent waiting for the model, summed over the asks. */
  ms: number
  /** Who gave the last answer; '' when none did. */
  provider: string
  model: string
}

export const SPEND_KEY = 'utle-spend'
export const SPEND_RING = 200

/** The ring with the record appended, the oldest dropped beyond the cap. Anything not an array starts afresh. */
export function spendRingWith(ring: unknown, record: SpendRecord, cap = SPEND_RING): SpendRecord[] {
  const kept = Array.isArray(ring) ? (ring as SpendRecord[]) : []
  return [...kept, record].slice(-cap)
}

/** The console line for a record. */
export function spendLine(record: SpendRecord): string {
  return `[spend] outcome=${record.outcome} asks=${record.asks} steps=${record.steps} goals=${record.goals} in=${record.input} cached=${record.cacheRead} out=${record.output} ms=${record.ms} provider=${record.provider || '-'} model=${record.model || '-'}`
}
