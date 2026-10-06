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
export const LOCAL_HOLD_MS = 700
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
  | { type: 'final'; text: string; speaker?: Speaker }
  /** Round 4: the voice profile was learnt (or not). */
  | { type: 'enrolled'; ok: boolean; seconds: number }
  /** The server is this many ms behind the audio it has received (it drops audio to catch up). 0 when caught up. */
  | { type: 'lag'; ms: number }

/** Who spoke an utterance, when the server has a voice profile: the owner, someone else, or it cannot tell. */
export type Speaker = 'owner' | 'other' | 'unknown'

/** Text frames the browser sends. flush: end the utterance now and send its final (push-to-talk released). */
export type AsrClientMessage =
  | { type: 'flush' }
  /** Round 4: learn the owner's voice from the next `seconds` of speech (the server stores an embedding, never audio). */
  | { type: 'enrol'; seconds: number }
  /** Round 4: only the owner's utterances are delivered; others are dropped (finals still carry speaker). */
  | { type: 'onlyOwner'; on: boolean }

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
    case 'lag':
      return typeof record.ms === 'number' && record.ms >= 0 ? { type: 'lag', ms: record.ms } : null
    case 'unavailable': {
      const reason = record.reason
      if (reason === 'model_missing' || reason === 'addon_missing' || reason === 'load_failed') return { type: 'unavailable', reason }
      return { type: 'unavailable', reason: 'load_failed' }
    }
    case 'partial':
    case 'final': {
      if (typeof record.text !== 'string') return null
      const speaker = record.speaker === 'owner' || record.speaker === 'other' || record.speaker === 'unknown' ? record.speaker : undefined
      return speaker === undefined ? { type: 'final', text: record.text } : { type: 'final', text: record.text, speaker }
    }
    case 'enrolled':
      return typeof record.ok === 'boolean' ? { type: 'enrolled', ok: record.ok, seconds: typeof record.seconds === 'number' ? record.seconds : 0 } : null
    default:
      return null
  }
}
