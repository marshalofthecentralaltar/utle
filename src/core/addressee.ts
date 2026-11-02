import * as z from 'zod'
import type { IntentUsage } from './pageIntent.ts'
import type { Lang } from './strings.ts'

/**
 * Round 10 (#6; ARCHITECTURE 32.3): the addressee check of always-on mode. A final no rule
 * recognised is asked once, through server/model/ (POST /api/addressee): was it said to Ütle as a
 * command, as dictation for the box, or not to Ütle at all (room talk, side talk, the television)?
 * "ignore" never reaches the bar, the box, the model's intent ask or a running task. LIMITED: on
 * the recogniser's text and the page, not on the audio.
 */

export type AddresseeVerdict = 'command' | 'dictation' | 'ignore'
export const ADDRESSEE_VERDICTS: readonly AddresseeVerdict[] = ['command', 'dictation', 'ignore']

/** How many finals before this one the check is told. */
export const ADDRESSEE_FINALS = 3
const FINAL_CHARS = 300

export interface AddresseeRequest {
  lang: Lang
  /** The final being judged. */
  utterance: string
  /** The finals heard before it, oldest first, at most ADDRESSEE_FINALS (judged or not). */
  finals: string[]
  /** The page in front, in short. */
  page: { url: string; title: string; box: { present: boolean; armed: boolean } }
}

export interface AddresseeAnswer {
  verdict: AddresseeVerdict
  usage?: IntentUsage
}

export const AddresseeRequestSchema: z.ZodType<AddresseeRequest> = z.object({
  lang: z.enum(['et', 'en']),
  utterance: z.string().min(1).max(500),
  finals: z.array(z.string().max(FINAL_CHARS)).max(ADDRESSEE_FINALS),
  page: z.object({
    url: z.string().max(2000),
    title: z.string().max(300),
    box: z.object({ present: z.boolean(), armed: z.boolean() }),
  }),
})

/** The model's verdict, or null for anything else. */
export function verdictFrom(value: unknown): AddresseeVerdict | null {
  return typeof value === 'string' && (ADDRESSEE_VERDICTS as readonly string[]).includes(value) ? (value as AddresseeVerdict) : null
}

/** The last finals as the request carries them: clipped, newest kept. */
export function recentFinals(finals: readonly string[]): string[] {
  return finals.map((f) => f.slice(0, FINAL_CHARS)).slice(-ADDRESSEE_FINALS)
}
