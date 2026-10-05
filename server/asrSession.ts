import { ASR_MAX_FRAME_BYTES, ASR_SAMPLE_RATE } from '../src/speech/asrProtocol.ts'
import type { AsrServerMessage } from '../src/speech/asrProtocol.ts'

/** The parts of sherpa-onnx-node's OnlineStream this server uses. */
export interface OnlineStreamLike {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void
}

/** The parts of sherpa-onnx-node's OnlineRecognizer this server uses. */
export interface OnlineRecognizerLike<S extends OnlineStreamLike = OnlineStreamLike> {
  createStream(): S
  isReady(stream: S): boolean
  decode(stream: S): void
  getResult(stream: S): { text: string }
  isEndpoint(stream: S): boolean
  reset(stream: S): void
}

export interface AsrSession {
  audio(samples: Float32Array): void
  close(): void
}

/**
 * One connection's utterance stream: feeds audio to the shared recogniser, reports the text as it
 * changes, and a final at each endpoint. Never logs: the text is the user's.
 */
export function createAsrSession<S extends OnlineStreamLike>(
  recognizer: OnlineRecognizerLike<S>,
  send: (message: AsrServerMessage) => void,
): AsrSession {
  const stream = recognizer.createStream()
  let last = ''
  let closed = false

  return {
    audio(samples) {
      if (closed) return
      stream.acceptWaveform({ samples, sampleRate: ASR_SAMPLE_RATE })
      while (recognizer.isReady(stream)) recognizer.decode(stream)
      const text = recognizer.getResult(stream).text.trim()
      if (text !== last && text !== '') send({ type: 'partial', text })
      last = text
      if (recognizer.isEndpoint(stream)) {
        if (text !== '') send({ type: 'final', text })
        recognizer.reset(stream)
        last = ''
      }
    },
    close() {
      closed = true
    },
  }
}

/** Samples from one binary frame, or null when the frame is not whole float32 samples of at most a second. */
export function samplesFromFrame(frame: Buffer): Float32Array | null {
  if (frame.byteLength === 0 || frame.byteLength % 4 !== 0 || frame.byteLength > ASR_MAX_FRAME_BYTES) return null
  // Copy: the socket's buffer may not be aligned for a Float32Array view.
  const copy = new Uint8Array(frame.byteLength)
  copy.set(frame)
  return new Float32Array(copy.buffer)
}
