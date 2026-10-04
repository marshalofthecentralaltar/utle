import { createAssembler } from './assembler.ts'
import type { Recognizer, RecognizerHandlers } from './recognizer.ts'

/** One spoken line. pauseAfterWord splits it into two finals with a silence between, as Chrome does on a pause. */
export interface ScriptLine {
  text: string
  pauseAfterWord?: number
}

export interface ScriptTiming {
  /** Silence before the first line. */
  startMs: number
  /** Time per spoken word. */
  wordMs: number
  /** Silence between lines, counted from the end of the previous line's hold. */
  gapMs: number
  /** Length of a mid-sentence pause. Must be shorter than holdMs for the halves to be joined. */
  pauseMs: number
  holdMs: number
  isInstant(text: string): boolean
}

/**
 * A recogniser that replays a script with the timing of real speech: interim results word by
 * word, then a final, through the same assembler the real recogniser uses.
 * It makes the whole voice path testable without a person, and plays the demo hands-off.
 */
export function createScriptedRecognizer(
  handlers: RecognizerHandlers,
  script: readonly ScriptLine[],
  timing: ScriptTiming,
): Recognizer {
  const assembler = createAssembler({
    holdMs: timing.holdMs,
    onUtterance: handlers.onUtterance,
    isInstant: timing.isInstant,
  })
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let running = false

  const after = (ms: number, run: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (running) run()
    }, ms)
    timers.add(timer)
  }

  /** Speaks words[from..to) as one recogniser result, then calls next. */
  const sayPart = (words: string[], next: () => void): void => {
    words.forEach((_, i) => {
      after((i + 1) * timing.wordMs, () => {
        const soFar = words.slice(0, i + 1).join(' ')
        if (i < words.length - 1) {
          handlers.onInterim(soFar)
          assembler.activity()
        } else {
          handlers.onInterim(soFar)
          assembler.activity()
          handlers.onInterim('')
          assembler.final(soFar)
          next()
        }
      })
    })
  }

  const sayLine = (index: number): void => {
    const line = script[index]
    if (!line) return
    const words = line.text.split(/\s+/).filter(Boolean)
    const nextLine = (): void => after(timing.holdMs + timing.gapMs, () => sayLine(index + 1))
    const cut = line.pauseAfterWord
    if (cut !== undefined && cut > 0 && cut < words.length) {
      sayPart(words.slice(0, cut), () => after(timing.pauseMs, () => sayPart(words.slice(cut), nextLine)))
    } else {
      sayPart(words, nextLine)
    }
  }

  return {
    supported: true,
    start() {
      if (running) return
      running = true
      after(timing.startMs, () => sayLine(0))
    },
    stop() {
      running = false
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
      assembler.dispose()
      handlers.onInterim('')
    },
    setLang() {
      // A script has no language to switch.
    },
  }
}
