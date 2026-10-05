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

/** What one frame of audio made of the utterance so far. On an endpoint the stream has already been reset. */
export interface DecodeResult {
  text: string
  endpoint: boolean
}

/**
 * One connection's stream of the recogniser, decoded on this thread or on a worker. The session
 * feeds it one frame at a time and waits for the result before the next, so results come in frame order.
 */
export interface Decoder {
  accept(samples: Float32Array): DecodeResult | Promise<DecodeResult>
  /** Forgets the utterance in progress. */
  reset(): void
  close(): void
}

/** The recogniser's stream, decoded on the calling thread. */
export function decoderInThread<S extends OnlineStreamLike>(recognizer: OnlineRecognizerLike<S>): Decoder {
  const stream = recognizer.createStream()
  return {
    accept(samples) {
      stream.acceptWaveform({ samples, sampleRate: ASR_SAMPLE_RATE })
      while (recognizer.isReady(stream)) recognizer.decode(stream)
      const text = recognizer.getResult(stream).text.trim()
      const endpoint = recognizer.isEndpoint(stream)
      if (endpoint) recognizer.reset(stream)
      return { text, endpoint }
    },
    reset() {
      recognizer.reset(stream)
    },
    close() {
      // sherpa frees the stream with its object.
    },
  }
}

/** Audio queued ahead of the decoder beyond this is a backlog: the oldest of it is dropped. */
export const MAX_BACKLOG_MS = 1500
/** What is left queued after a drop. */
export const KEEP_MS = 300
/** A lag message is sent at most this often. */
export const LAG_REPORT_MS = 500
/** A frame whose RMS is below this is quiet: a drop ends at one when one is near, not in the middle of a word. */
export const SILENCE_RMS = 0.01
/** How much further than KEEP_MS a drop may go to end at a quiet frame. */
export const CUT_SEARCH_MS = 300

export interface AsrSession {
  /** Queues one frame. Never blocks: frames are decoded from the queue, one per turn of the event loop. */
  audio(samples: Float32Array): void
  /** Decodes what is queued, sends the utterance so far as a final, and starts the next utterance. */
  flush(): void
  close(): void
  /** Audio queued and not yet decoded. */
  backlogMs(): number
  stats(): { receivedMs: number; decodedMs: number; droppedMs: number }
}

export interface AsrSessionOptions {
  /** Runs the next decode step on a later turn. Default setImmediate; tests run the steps by hand. */
  schedule?: (step: () => void) => void
  /** The clock behind the lag report rate. Default Date.now. */
  now?: () => number
  /** The decoder failed; the caller closes the connection. */
  onError?: (error: unknown) => void
}

interface QueuedFrame {
  samples: Float32Array
  ms: number
  quiet: boolean
}

type Queued = QueuedFrame | 'flush'

const frameMs = (samples: Float32Array): number => (samples.length * 1000) / ASR_SAMPLE_RATE

/** Root mean square of a frame: how loud it is, cheaply. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i] ?? 0
    sum += sample * sample
  }
  return Math.sqrt(sum / samples.length)
}

/**
 * One connection's utterance stream. Frames go into a bounded queue and are decoded from a drain
 * loop that gives the event loop a turn between frames, so a slow decode never holds up the rest of
 * the server. When decoding falls more than MAX_BACKLOG_MS behind, the oldest audio is dropped down
 * to KEEP_MS (the cut moved on to a quiet frame when one is within CUT_SEARCH_MS) and a lag message
 * says how far behind it was; a lag of 0 follows once the queue has emptied, at most every
 * LAG_REPORT_MS. A flush decodes the queue, sends the utterance so far as a final and resets the
 * stream. Reports the text as it changes, and a final at each endpoint. Never logs: the text is the user's.
 */
export function createAsrSession(decoder: Decoder, send: (message: AsrServerMessage) => void, options: AsrSessionOptions = {}): AsrSession {
  const schedule = options.schedule ?? ((step: () => void) => setImmediate(step))
  const now = options.now ?? (() => Date.now())
  const queue: Queued[] = []
  let queuedMs = 0
  let receivedMs = 0
  let decodedMs = 0
  let droppedMs = 0
  let last = ''
  let closed = false
  let draining = false
  let lagging = false
  let lastReport = -Infinity

  const report = (ms: number): void => {
    send({ type: 'lag', ms })
    lastReport = now()
    lagging = ms > 0
  }

  const loud = (index: number): boolean => {
    const item = queue[index]
    return item !== undefined && item !== 'flush' && !item.quiet
  }

  /** Drops the oldest audio until KEEP_MS is left; a cut between two loud frames moves on to the next quiet one when near. */
  const dropOldest = (): void => {
    const backlog = queuedMs
    let cut = 0
    let left = queuedMs
    while (cut < queue.length && left > KEEP_MS) {
      const item = queue[cut]
      if (item !== undefined && item !== 'flush') left -= item.ms
      cut += 1
    }
    if (loud(cut - 1) && loud(cut)) {
      let searched = 0
      for (let at = cut; at < queue.length && searched < CUT_SEARCH_MS; at += 1) {
        const item = queue[at]
        if (item === undefined || item === 'flush') break
        searched += item.ms
        if (item.quiet) {
          cut = at + 1
          break
        }
      }
    }
    // A flush marker among the dropped frames is kept: the final it asks for is still owed.
    const kept: Queued[] = []
    for (const item of queue.slice(0, cut)) {
      if (item === 'flush') kept.push(item)
      else {
        queuedMs -= item.ms
        droppedMs += item.ms
      }
    }
    queue.splice(0, cut, ...kept)
    if (!lagging || now() - lastReport >= LAG_REPORT_MS) report(backlog)
  }

  const finish = (result: DecodeResult): void => {
    const text = result.text.trim()
    if (text !== last && text !== '') send({ type: 'partial', text })
    last = text
    if (result.endpoint) {
      if (text !== '') send({ type: 'final', text })
      last = ''
    }
  }

  const step = (): void => {
    if (closed) {
      draining = false
      return
    }
    const item = queue.shift()
    if (item === undefined) {
      draining = false
      if (lagging && now() - lastReport >= LAG_REPORT_MS) report(0)
      return
    }
    if (item === 'flush') {
      if (last !== '') send({ type: 'final', text: last })
      last = ''
      decoder.reset()
      schedule(step)
      return
    }
    queuedMs -= item.ms
    const done = (result: DecodeResult): void => {
      if (closed) return
      decodedMs += item.ms
      finish(result)
      schedule(step)
    }
    const failed = (error: unknown): void => {
      draining = false
      options.onError?.(error)
    }
    try {
      const result = decoder.accept(item.samples)
      if (result instanceof Promise) result.then(done, failed)
      else done(result)
    } catch (error) {
      failed(error)
    }
  }

  const drain = (): void => {
    if (draining || closed) return
    draining = true
    schedule(step)
  }

  return {
    audio(samples) {
      if (closed) return
      const ms = frameMs(samples)
      receivedMs += ms
      queuedMs += ms
      queue.push({ samples, ms, quiet: rms(samples) < SILENCE_RMS })
      if (queuedMs > MAX_BACKLOG_MS) dropOldest()
      drain()
    },
    flush() {
      if (closed) return
      queue.push('flush')
      drain()
    },
    close() {
      closed = true
      queue.length = 0
      queuedMs = 0
      decoder.close()
    },
    backlogMs() {
      return queuedMs
    },
    stats() {
      return { receivedMs, decodedMs, droppedMs }
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
