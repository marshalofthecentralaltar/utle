/**
 * Dwell: resting the pointer on a control for DWELL_MS activates it without a click, for an eye
 * tracker whose setup has no dwell-click (docs/ARCHITECTURE.md section 20.3). After it fires it
 * does not fire again until the pointer has left. A click during the same hover after it fired is
 * ignored, and a click before it cancels it, so a setup that also clicks by dwell acts once.
 * No DOM: the caller wires enter, leave and click to pointer events.
 */
export const DWELL_MS = 1000

export interface Dwell {
  enter(): void
  leave(): void
  /** True when the click should act. */
  click(): boolean
  dispose(): void
}

export function createDwell(opts: { onFire(): void; onChange?(dwelling: boolean): void; ms?: number }): Dwell {
  const ms = opts.ms ?? DWELL_MS
  let inside = false
  let fired = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const stop = (): void => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
    opts.onChange?.(false)
  }

  return {
    enter() {
      if (inside) return
      inside = true
      fired = false
      opts.onChange?.(true)
      timer = setTimeout(() => {
        timer = null
        fired = true
        opts.onChange?.(false)
        opts.onFire()
      }, ms)
    },
    leave() {
      inside = false
      fired = false
      stop()
    },
    click() {
      if (inside && fired) return false
      stop()
      if (inside) fired = true
      return true
    },
    dispose() {
      inside = false
      stop()
    },
  }
}
