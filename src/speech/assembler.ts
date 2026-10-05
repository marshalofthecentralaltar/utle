export interface Assembler {
  /** A final result from the recogniser, with any other readings it offered. */
  final(text: string, alternatives?: readonly string[]): void
  /** The user is audibly still speaking (an interim result arrived). */
  activity(): void
  /** True when nothing is held waiting to be joined. */
  idle(): boolean
  /** Delivers what is held now, without waiting for the hold (push-to-talk released). */
  releaseNow(): void
  dispose(): void
}

export interface AssemblerOptions {
  holdMs: number
  onUtterance(text: string): void
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
 */
export function createAssembler(opts: AssemblerOptions): Assembler {
  let held: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const release = (): void => {
    cancel()
    if (held.length === 0) return
    const text = held.join(' ')
    held = []
    opts.onUtterance(text)
  }

  const hold = (): void => {
    cancel()
    timer = setTimeout(release, opts.holdMs)
  }

  return {
    final(text, alternatives = []) {
      const clean = text.trim()
      if (clean === '') return
      if (held.length === 0) {
        const instant = [clean, ...alternatives.map((a) => a.trim())].find((reading) => reading !== '' && opts.isInstant(reading))
        if (instant !== undefined) {
          opts.onUtterance(instant)
          return
        }
      }
      held.push(clean)
      hold()
    },
    activity() {
      if (held.length > 0) hold()
    },
    idle() {
      return held.length === 0
    },
    releaseNow() {
      release()
    },
    dispose() {
      cancel()
      held = []
    },
  }
}
