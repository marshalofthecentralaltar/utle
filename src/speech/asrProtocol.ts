/** The wire between the browser and the local recogniser on the dev server (ARCHITECTURE 20.1). */

export const ASR_PATH = '/api/asr'
/** Audio frames are mono 32-bit float little-endian samples at this rate. */
export const ASR_SAMPLE_RATE = 16000
/** Samples per frame the browser sends: 100 ms. */
export const ASR_FRAME_SAMPLES = 1600
/** Frames above one second of audio are ignored. */
export const ASR_MAX_FRAME_BYTES = ASR_SAMPLE_RATE * 4

/**
 * How long a final is held for joining. Shorter than Chrome's: this engine already waits 1 s of
 * silence before it sends a final, so most of a thinking pause has passed by then.
 */
export const LOCAL_HOLD_MS = 500
/**
 * How long a partial that is a quick reply must stay unchanged before it is released. Longer than
 * the gap between the model's partials (about 620 ms), so "ei, mitte kolm" is never cut at "ei".
 */
export const INSTANT_SETTLE_MS = 650

/** The lines the page shows when the local recogniser cannot run (src/speech/pick.ts). */
export const FELL_BACK = "The speech model on this computer is not running, so Chrome's recognition is listening instead."
export const NOTHING_LEFT = 'The speech model on this computer is not running and this browser has no speech recognition. Type instead.'

export type AsrUnavailableReason = 'model_missing' | 'addon_missing' | 'load_failed'

export type AsrServerMessage =
  | { type: 'ready' }
  | { type: 'unavailable'; reason: AsrUnavailableReason }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }

/** Reads one text frame from the server; null for anything that is not a known message. */
export function parseAsrMessage(raw: string): AsrServerMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  switch (record.type) {
    case 'ready':
      return { type: 'ready' }
    case 'unavailable': {
      const reason = record.reason
      if (reason === 'model_missing' || reason === 'addon_missing' || reason === 'load_failed') return { type: 'unavailable', reason }
      return { type: 'unavailable', reason: 'load_failed' }
    }
    case 'partial':
    case 'final':
      return typeof record.text === 'string' ? { type: record.type, text: record.text } : null
    default:
      return null
  }
}
