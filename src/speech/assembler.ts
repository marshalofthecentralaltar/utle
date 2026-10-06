import { CONTINUE_WINDOW_MS, endsWithConnective, startsWithConnective } from '../core/chain.ts'

export interface Assembler {
  /** A final result from the recogniser, with any other readings it offered. */
  final(text: string, alternatives?: readonly string[]): void
  /** The user is audibly still speaking (an interim result arrived). */
  activity(): void
  /** True when nothing is held waiting to be joined. */
  idle(): boolean
  /** Delivers what is held now, without waiting for the hold (push-to-talk released). */
  releaseNow(): void
  /**
   * Round 5 (review M8): the caller delivered text past the assembler (a quick reply released
   * from a partial): it counts as the last delivery, so "siis ..." soon after continues it.
   */
  noteDelivered(text: string): void
  dispose(): void
}

export interface AssemblerOptions {
  holdMs: number
  /**
   * Round 4: the hold when the held text ends with a connective ("mine whatsappi ja"): he is
   * promising more, so the pause before it may be long. Default: holdMs.
   */
  connectiveHoldMs?: number
  onUtterance(text: string): void
  /**
   * Round 4: a final that starts with a connective ("siis ava Karin") within CONTINUE_WINDOW_MS of
   * the last delivery continues that utterance: text is the whole joined utterance, added the new
   * words. Without this handler such a final is an utterance of its own.
   */
  onUtteranceContinued?(text: string, added: string): void
  /** True for text that should not wait: a one-word reply or a command that needs no model. */
  isInstant(text: string): boolean
}

/**
 * Joins recogniser finals across pauses into one utterance.
 *
 * Recognisers end a result on a short silence, so a pause to think splits one sentence in two.
 * A final is held for holdMs and joined with whatever follows; speech activity restarts the hold.
 * With nothing held, an instant command is released at once, and the recogniser's other
 * readings are searched for one ("to" first and "two" second gives "two").
 *
 * Round 4: a held text that ends with a connective waits connectiveHoldMs instead, and a final
 * that starts with one soon after a delivery continues that delivery (onUtteranceContinued).
 * A connective-ending text is never instant.
 */
export function createAssembler(opts: AssemblerOptions): Assembler {
  let held: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  /** The held text continues the last delivery: it goes out through onUtteranceContinued. */
  let continuing = false
  /** The last utterance delivered (either way) and when. */
  let last: { text: string; at: number } | null = null
  /**
   * Round 5 (review M8): when the first speech activity after a delivery arrived, while nothing
   * was held. The continuation window is measured from it, not from the final: "siis ava Karini
   * viimane sõnum ja kustuta see" takes seconds to say, and its first word is what came soon.
   */
  let firstActivityAt: number | null = null

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const deliver = (text: string): void => {
    last = { text, at: Date.now() }
    firstActivityAt = null
    opts.onUtterance(text)
  }

  const release = (): void => {
    cancel()
    if (held.length === 0) return
    const text = held.join(' ')
    held = []
    if (continuing && last !== null && opts.onUtteranceContinued) {
      continuing = false
      const whole = `${last.text} ${text}`
      last = { text: whole, at: Date.now() }
      firstActivityAt = null
      opts.onUtteranceContinued(whole, text)
      return
    }
    continuing = false
    deliver(text)
  }

  const hold = (): void => {
    cancel()
    const ms = endsWithConnective(held.join(' ')) ? (opts.connectiveHoldMs ?? opts.holdMs) : opts.holdMs
    timer = setTimeout(release, ms)
  }

  return {
    final(text, alternatives = []) {
      const clean = text.trim()
      if (clean === '') return
      if (held.length === 0) {
        // The window is measured from the first activity of this final (M8), or from now without one.
        const began = firstActivityAt ?? Date.now()
        firstActivityAt = null
        if (opts.onUtteranceContinued && last !== null && began - last.at < CONTINUE_WINDOW_MS && startsWithConnective(clean)) {
          continuing = true
        } else if (!endsWithConnective(clean)) {
          const instant = [clean, ...alternatives.map((a) => a.trim())].find((reading) => reading !== '' && opts.isInstant(reading))
          if (instant !== undefined) {
            deliver(instant)
            return
          }
        }
      }
      held.push(clean)
      hold()
    },
    activity() {
      if (held.length > 0) hold()
      else if (firstActivityAt === null) firstActivityAt = Date.now()
    },
    idle() {
      return held.length === 0
    },
    releaseNow() {
      release()
    },
    noteDelivered(text) {
      last = { text: text.trim(), at: Date.now() }
      firstActivityAt = null
    },
    dispose() {
      cancel()
      held = []
      continuing = false
      firstActivityAt = null
    },
  }
}
