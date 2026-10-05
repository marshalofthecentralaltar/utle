/**
 * Gaze (push-to-talk by looking, round 3): the target listens while the pointer rests on it.
 * Entering starts listening after GAZE_ON_MS, so a pointer passing through does nothing. Leaving
 * stops it after GAZE_OFF_MS of grace, so an eye tracker's jitter does not cut a sentence; coming
 * back within the grace keeps it on without a restart. The stop asks for a flush: the words said
 * so far are delivered at once. No DOM: the caller wires enter and leave to pointer events and
 * to its own poll of the pointer's position, because a page can steal the leave event.
 */
export const GAZE_ON_MS = 250
export const GAZE_OFF_MS = 600
/** How often the caller checks the pointer's position against the target (the leave can be lost). */
export const GAZE_POLL_MS = 1000

/** arming: the pointer rests, listening starts soon. on: listening. leaving: the grace runs. off: nothing. */
export type GazePhase = 'off' | 'arming' | 'on' | 'leaving'

export interface Gaze {
  enter(): void
  leave(): void
  readonly phase: GazePhase
  /** Stops at once (the mode was switched off, the strip is going away). Says onStop if it was on. */
  dispose(): void
}

export function createGaze(opts: { onStart(): void; onStop(): void; onPhase?(phase: GazePhase): void; onMs?: number; offMs?: number }): Gaze {
  const onMs = opts.onMs ?? GAZE_ON_MS
  const offMs = opts.offMs ?? GAZE_OFF_MS
  let phase: GazePhase = 'off'
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = (): void => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }
  const go = (next: GazePhase): void => {
    if (phase === next) return
    phase = next
    opts.onPhase?.(next)
  }

  return {
    enter() {
      if (phase === 'arming' || phase === 'on') return
      clear()
      if (phase === 'leaving') {
        // Back within the grace: it never stopped.
        go('on')
        return
      }
      go('arming')
      timer = setTimeout(() => {
        timer = null
        go('on')
        opts.onStart()
      }, onMs)
    },
    leave() {
      if (phase === 'off' || phase === 'leaving') return
      clear()
      if (phase === 'arming') {
        go('off')
        return
      }
      go('leaving')
      timer = setTimeout(() => {
        timer = null
        go('off')
        opts.onStop()
      }, offMs)
    },
    get phase() {
      return phase
    },
    dispose() {
      clear()
      const wasOn = phase === 'on' || phase === 'leaving'
      go('off')
      if (wasOn) opts.onStop()
    },
  }
}
