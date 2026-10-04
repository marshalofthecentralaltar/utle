import { quickReply } from '../core/quickReply.ts'

export interface Assembler {
  /** A final result from the recogniser. */
  final(text: string): void
  /** The user is audibly still speaking (an interim result arrived). */
  activity(): void
  dispose(): void
}

/**
 * Joins recogniser finals across pauses into one utterance.
 *
 * Recognisers end a result on a short silence, so a pause to think splits one sentence in two.
 * A final is held for holdMs and joined with whatever follows; speech activity restarts the hold.
 * A lone quick reply (yes, no, a number) is released at once so one-word answers stay instant.
 */
export function createAssembler(opts: { holdMs: number; onUtterance(text: string): void }): Assembler {
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
    final(text) {
      const clean = text.trim()
      if (clean === '') return
      if (held.length === 0 && quickReply(clean, { expectNumber: true }) !== null) {
        opts.onUtterance(clean)
        return
      }
      held.push(clean)
      hold()
    },
    activity() {
      if (held.length > 0) hold()
    },
    dispose() {
      cancel()
      held = []
    },
  }
}
