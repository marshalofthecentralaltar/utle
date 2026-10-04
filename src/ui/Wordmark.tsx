import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** What the two dots of the ü are showing. */
export type VoiceState = 'off' | 'listening' | 'thinking' | 'reading' | 'asleep'

/**
 * The wordmark. The two dots of the ü are the listening light, and they swell with the voice.
 * The level is read every frame and written to a CSS variable, so the page does not re-render.
 */
export function Wordmark({ voice, level }: { voice: VoiceState; level: RefObject<number> }) {
  const mark = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = mark.current
    if (!element) return
    if (voice !== 'listening') {
      element.style.setProperty('--level', '0')
      return
    }
    let frame = 0
    let shown = 0
    const tick = (): void => {
      // Rise at once, fall slowly, so the dots breathe instead of flickering.
      const target = level.current ?? 0
      shown = target > shown ? target : shown * 0.9
      element.style.setProperty('--level', shown.toFixed(3))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [voice, level])

  return (
    <span ref={mark} className="wordmark" data-voice={voice} role="img" aria-label="Ütle">
      <span className="wordmark-u" aria-hidden="true">
        u
        <span className="wordmark-dots">
          <i />
          <i />
        </span>
      </span>
      <span aria-hidden="true">tle</span>
    </span>
  )
}
