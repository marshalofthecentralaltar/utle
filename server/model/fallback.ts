import { ModelError } from './types.ts'
import type { Model, ModelAsk, ModelReplyNeutral } from './types.ts'

/**
 * Round 9 (ARCHITECTURE 30.5.1, plan decision 4.2): the fallback runs only on a fast failure of
 * the primary: no key (401, 403), busy (429, 5xx), unreachable, or a refusal. Never on a timeout (a
 * spoken command that waited 7 s cannot wait 7 more) and never on another rejection (a 400 is our
 * request's fault, and the fallback would only repeat it).
 */

export type Answered = 'primary' | 'fallback'

export interface FallbackModel extends Model {
  /** Which model gave the last reply; null before any. */
  last(): Answered | null
}

const FAST: ReadonlySet<ModelError['kind']> = new Set(['no_key', 'busy', 'unreachable'])

/** Whether a failure of the primary may be handed to the fallback. */
export function fastFailure(error: unknown): boolean {
  return error instanceof ModelError ? FAST.has(error.kind) : false
}

export function withFallback(primary: Model, fallback: Model | null): FallbackModel {
  let last: Answered | null = null
  const viaFallback = async (ask: ModelAsk): Promise<ModelReplyNeutral> => {
    if (fallback === null) throw new Error('no fallback')
    const reply = await fallback.ask(ask)
    last = 'fallback'
    return reply
  }
  return {
    last: () => last,
    async ask(ask: ModelAsk): Promise<ModelReplyNeutral> {
      let reply: ModelReplyNeutral
      try {
        reply = await primary.ask(ask)
      } catch (error) {
        if (fallback === null || !fastFailure(error)) throw error
        return viaFallback(ask)
      }
      if (reply.stop === 'refusal' && fallback !== null) return viaFallback(ask)
      last = 'primary'
      return reply
    },
  }
}
