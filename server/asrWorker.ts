/**
 * The decoder on its own thread (ARCHITECTURE 23.1). The main thread forwards frames and gets
 * results back; model load and decode never block /api/intent or Vite. This file is both the
 * worker's entry (Node strips its types: the repository's imports carry .ts and its syntax is
 * erasable) and the main thread's side of it.
 */
import { join } from 'node:path'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { AsrUnavailableReason } from '../src/speech/asrProtocol.ts'
import { loadModel } from './asrModel.ts'
import type { DecodeResult, Decoder, OnlineRecognizerLike, OnlineStreamLike } from './asrSession.ts'
import { decoderInThread } from './asrSession.ts'
import { PROFILE_FILE, SPEAKER_DIR, createSpeakerGate } from './speaker.ts'
import type { Judgement, SpeakerGate } from './speaker.ts'
import { loadSpeakerModel } from './speakerModel.ts'

/** Main thread to worker. The frame's buffer is transferred, not copied. judge and enrol are round 4 (the speaker gate). */
export type ToWorker =
  | { type: 'open'; id: number }
  | { type: 'accept'; id: number; seq: number; samples: Float32Array }
  | { type: 'reset'; id: number }
  | { type: 'close'; id: number }
  | { type: 'judge'; id: number; seq: number }
  | { type: 'enrol'; id: number; seq: number; seconds: number }

/** What the speaker gate has (round 4): the embedding model, and a learnt voice. */
export interface SpeakerStatus {
  model: boolean
  profile: boolean
}

/** Worker to main thread. */
export type FromWorker =
  | { type: 'loaded'; ms: number; speaker: SpeakerStatus }
  | { type: 'unavailable'; reason: AsrUnavailableReason }
  | { type: 'result'; id: number; seq: number; result: DecodeResult }
  | { type: 'failed'; id: number; seq: number; message: string }
  | { type: 'judged'; id: number; seq: number; judgement: Judgement | null }
  | { type: 'enrolled'; id: number; seq: number; ok: boolean }

export interface WorkerData {
  root: string
}

/** How long the worker may take to load the model before the server gives up on it. */
export const WORKER_LOAD_TIMEOUT_MS = 120_000

/** A factory of decoders over a loaded model, wherever it lives. */
export interface DecoderHost {
  where: 'worker' | 'thread'
  /** Model load time. */
  ms: number
  /** Round 4: what the speaker gate behind the decoders has. */
  speaker: SpeakerStatus
  open(): Decoder
  /** The worker died, or the thread's recogniser is gone: the host is finished. */
  onExit(listener: (code: number) => void): void
}

export type HostStart = { ok: true; host: DecoderHost } | { ok: false; reason: AsrUnavailableReason }

/** The speaker gate over the model in models/speaker/ (round 4), with or without the model file. */
export function openSpeakerGate(root: string): { gate: SpeakerGate; status: SpeakerStatus } {
  const loaded = loadSpeakerModel(root)
  const gate = createSpeakerGate(loaded.ok ? loaded.extractor : null, { profilePath: join(root, SPEAKER_DIR, PROFILE_FILE) })
  return { gate, status: { model: loaded.ok, profile: gate.hasProfile() } }
}

/** The worker's side: one shared recogniser and speaker gate, one stream per session id. */
function serve(port: NonNullable<typeof parentPort>, recognizer: OnlineRecognizerLike<OnlineStreamLike>, gate: SpeakerGate): void {
  const streams = new Map<number, Decoder>()
  port.on('message', (message: ToWorker) => {
    switch (message.type) {
      case 'open':
        streams.set(message.id, decoderInThread(recognizer, gate))
        return
      case 'accept': {
        const decoder = streams.get(message.id)
        if (!decoder) return
        const reply = (body: FromWorker): void => port.postMessage(body)
        try {
          const result = decoder.accept(message.samples)
          if (result instanceof Promise) {
            result.then(
              (value) => reply({ type: 'result', id: message.id, seq: message.seq, result: value }),
              (error: unknown) => reply({ type: 'failed', id: message.id, seq: message.seq, message: String(error) }),
            )
          } else reply({ type: 'result', id: message.id, seq: message.seq, result })
        } catch (error) {
          reply({ type: 'failed', id: message.id, seq: message.seq, message: String(error) })
        }
        return
      }
      case 'reset':
        streams.get(message.id)?.reset()
        return
      case 'close':
        streams.get(message.id)?.close()
        streams.delete(message.id)
        return
      case 'judge': {
        const decoder = streams.get(message.id)
        const reply = (body: FromWorker): void => port.postMessage(body)
        if (!decoder) {
          reply({ type: 'judged', id: message.id, seq: message.seq, judgement: null })
          return
        }
        try {
          Promise.resolve(decoder.judge?.() ?? null).then(
            (judgement) => reply({ type: 'judged', id: message.id, seq: message.seq, judgement }),
            (error: unknown) => reply({ type: 'failed', id: message.id, seq: message.seq, message: String(error) }),
          )
        } catch (error) {
          reply({ type: 'failed', id: message.id, seq: message.seq, message: String(error) })
        }
        return
      }
      case 'enrol': {
        const decoder = streams.get(message.id)
        const reply = (ok: boolean): void => port.postMessage({ type: 'enrolled', id: message.id, seq: message.seq, ok } satisfies FromWorker)
        const learning = decoder?.enrol?.(message.seconds)
        if (!learning) reply(false)
        else learning.then(reply, () => reply(false))
        return
      }
    }
  })
}

if (!isMainThread && parentPort) {
  const data = workerData as WorkerData
  const loaded = loadModel(data.root)
  if (loaded.ok) {
    const speaker = openSpeakerGate(data.root)
    serve(parentPort, loaded.recognizer, speaker.gate)
    parentPort.postMessage({ type: 'loaded', ms: loaded.ms, speaker: speaker.status } satisfies FromWorker)
  } else {
    parentPort.postMessage({ type: 'unavailable', reason: loaded.reason } satisfies FromWorker)
  }
}

/** Decoders over a recogniser (and a speaker gate, round 4) on this thread. */
export function hostInThread(recognizer: OnlineRecognizerLike, ms: number, speaker: { gate: SpeakerGate; status: SpeakerStatus } | null = null): DecoderHost {
  return {
    where: 'thread',
    ms,
    speaker: speaker?.status ?? { model: false, profile: false },
    open: () => decoderInThread(recognizer, speaker?.gate ?? null),
    onExit() {
      // It lives as long as the process.
    },
  }
}

/**
 * Starts the decode worker and resolves once its model is loaded. Resolves ok: false when the
 * worker cannot start (an older Node that does not run .ts, or the file missing) with reason
 * 'load_failed', or with the worker's own reason when the model or the addon is missing there.
 */
export function startWorkerHost(root: string, entry: string): Promise<HostStart> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(entry, { workerData: { root } satisfies WorkerData })
    } catch {
      resolve({ ok: false, reason: 'load_failed' })
      return
    }
    const pending = new Map<string, { resolve(result: DecodeResult): void; reject(error: Error): void }>()
    const judging = new Map<string, { resolve(judgement: Judgement | null): void; reject(error: Error): void }>()
    const enrolling = new Map<string, (ok: boolean) => void>()
    const exitListeners: Array<(code: number) => void> = []
    let started = false
    let nextId = 1
    const key = (id: number, seq: number): string => `${id}:${seq}`

    const timer = setTimeout(() => {
      if (started) return
      started = true
      void worker.terminate()
      resolve({ ok: false, reason: 'load_failed' })
    }, WORKER_LOAD_TIMEOUT_MS)

    const host: DecoderHost = {
      where: 'worker',
      ms: 0,
      speaker: { model: false, profile: false },
      open() {
        const id = nextId
        nextId += 1
        let seq = 0
        worker.postMessage({ type: 'open', id } satisfies ToWorker)
        return {
          accept(samples) {
            seq += 1
            const mine = seq
            return new Promise<DecodeResult>((resolveResult, reject) => {
              pending.set(key(id, mine), { resolve: resolveResult, reject })
              // The session hands over its copy of the frame, so the buffer moves threads instead of being copied.
              const buffer = samples.buffer
              worker.postMessage({ type: 'accept', id, seq: mine, samples } satisfies ToWorker, buffer instanceof ArrayBuffer ? [buffer] : [])
            })
          },
          reset() {
            worker.postMessage({ type: 'reset', id } satisfies ToWorker)
          },
          close() {
            worker.postMessage({ type: 'close', id } satisfies ToWorker)
          },
          judge() {
            seq += 1
            const mine = seq
            return new Promise<Judgement | null>((resolveJudgement, reject) => {
              judging.set(key(id, mine), { resolve: resolveJudgement, reject })
              worker.postMessage({ type: 'judge', id, seq: mine } satisfies ToWorker)
            })
          },
          enrol(seconds) {
            seq += 1
            const mine = seq
            return new Promise<boolean>((resolveEnrolment) => {
              enrolling.set(key(id, mine), resolveEnrolment)
              worker.postMessage({ type: 'enrol', id, seq: mine, seconds } satisfies ToWorker)
            })
          },
        }
      },
      onExit(listener) {
        exitListeners.push(listener)
      },
    }

    worker.on('message', (message: FromWorker) => {
      switch (message.type) {
        case 'loaded':
          if (started) return
          started = true
          clearTimeout(timer)
          host.ms = message.ms
          host.speaker = message.speaker
          resolve({ ok: true, host })
          return
        case 'unavailable':
          if (started) return
          started = true
          clearTimeout(timer)
          void worker.terminate()
          resolve({ ok: false, reason: message.reason })
          return
        case 'result':
          pending.get(key(message.id, message.seq))?.resolve(message.result)
          pending.delete(key(message.id, message.seq))
          return
        case 'failed':
          pending.get(key(message.id, message.seq))?.reject(new Error(message.message))
          pending.delete(key(message.id, message.seq))
          judging.get(key(message.id, message.seq))?.reject(new Error(message.message))
          judging.delete(key(message.id, message.seq))
          return
        case 'judged':
          judging.get(key(message.id, message.seq))?.resolve(message.judgement)
          judging.delete(key(message.id, message.seq))
          return
        case 'enrolled':
          enrolling.get(key(message.id, message.seq))?.(message.ok)
          enrolling.delete(key(message.id, message.seq))
          return
      }
    })
    worker.on('error', (error: Error) => {
      console.warn(`[asr] decode worker error: ${error.message}`)
      if (!started) {
        started = true
        clearTimeout(timer)
        resolve({ ok: false, reason: 'load_failed' })
      }
    })
    worker.on('exit', (code: number) => {
      clearTimeout(timer)
      for (const entry of pending.values()) entry.reject(new Error(`decode worker exited with ${code}`))
      pending.clear()
      for (const entry of judging.values()) entry.reject(new Error(`decode worker exited with ${code}`))
      judging.clear()
      for (const entry of enrolling.values()) entry(false)
      enrolling.clear()
      if (!started) {
        started = true
        resolve({ ok: false, reason: 'load_failed' })
        return
      }
      for (const listener of exitListeners) listener(code)
    })
  })
}
