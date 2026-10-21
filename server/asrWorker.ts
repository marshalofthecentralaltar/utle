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
import { captureFromEnv } from './capture.ts'
import type { DecodeResult, Decoder, DecoderExtras, OnlineRecognizerLike, OnlineStreamLike, ScriptResult } from './asrSession.ts'
import { decoderInThread } from './asrSession.ts'
import { loadVad } from './vad.ts'
import { PROFILE_FILE, SPEAKER_DIR, speakerGates } from './speaker.ts'
import type { Judgement, SpeakerGate } from './speaker.ts'
import { loadSpeakerModel } from './speakerModel.ts'

/** Main thread to worker. The frame's buffer is transferred, not copied. judge and enrol are round 4 (the speaker gate). */
export type ToWorker =
  | { type: 'open'; id: number; profile?: string }
  | { type: 'accept'; id: number; seq: number; samples: Float32Array }
  | { type: 'reset'; id: number }
  | { type: 'close'; id: number }
  | { type: 'judge'; id: number; seq: number }
  | { type: 'enrol'; id: number; seq: number; seconds: number }
  /** Round 7: scripted enrolment, its early end, and UTLE_CAPTURE's clip of the final just judged. */
  | { type: 'enrolScript'; id: number; seq: number; phrases: number }
  | { type: 'enrolFinish'; id: number }
  | { type: 'capture'; id: number; text: string; judgement: Judgement | null }

/** What the speaker gate has (round 4): the embedding model, and a learnt voice. */
export interface SpeakerStatus {
  model: boolean
  profile: boolean
}

/** Worker to main thread. */
export type FromWorker =
  | { type: 'loaded'; ms: number; speaker: SpeakerStatus; vad: boolean }
  | { type: 'unavailable'; reason: AsrUnavailableReason }
  | { type: 'result'; id: number; seq: number; result: DecodeResult }
  | { type: 'failed'; id: number; seq: number; message: string }
  | { type: 'judged'; id: number; seq: number; judgement: Judgement | null }
  | { type: 'enrolled'; id: number; seq: number; ok: boolean }
  | { type: 'enrolPhrase'; id: number; seq: number; count: number }
  | { type: 'scripted'; id: number; seq: number; result: ScriptResult }

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
  /** Round 7: the speech detector is in front of the decoders. */
  vad: boolean
  /** A decoder whose speaker gate reads and writes this profile file (27.6); the default profile without one. */
  open(profile?: string): Decoder
  /** The worker died, or the thread's recogniser is gone: the host is finished. */
  onExit(listener: (code: number) => void): void
}

export type HostStart = { ok: true; host: DecoderHost } | { ok: false; reason: AsrUnavailableReason }

/** The speaker gate over the model in models/speaker/ (round 4), with or without the model file. gateFor: one gate per profile file (27.6), the default one without a path. */
export function openSpeakerGate(root: string): { gate: SpeakerGate; status: SpeakerStatus; gateFor(profile?: string): SpeakerGate } {
  const loaded = loadSpeakerModel(root)
  const gates = speakerGates(loaded.ok ? loaded.extractor : null)
  const defaultPath = join(root, SPEAKER_DIR, PROFILE_FILE)
  const gate = gates(defaultPath)
  return { gate, status: { model: loaded.ok, profile: gate.hasProfile() }, gateFor: (profile) => gates(profile ?? defaultPath) }
}

/**
 * Round 7: the speech detector over models/vad/ (null without the file) and UTLE_CAPTURE (null
 * unless set). Loaded where the decoders live: the worker, or the server thread.
 */
export function openDecoderExtras(root: string, env: NodeJS.ProcessEnv = process.env): DecoderExtras {
  const vad = loadVad(root)
  return { vad: vad.ok ? vad.create : null, capture: captureFromEnv(env) }
}

/** The worker's side: one shared recogniser and speaker gate, one stream per session id. */
function serve(port: NonNullable<typeof parentPort>, recognizer: OnlineRecognizerLike<OnlineStreamLike>, gateFor: (profile?: string) => SpeakerGate, extras: DecoderExtras): void {
  const streams = new Map<number, Decoder>()
  port.on('message', (message: ToWorker) => {
    switch (message.type) {
      case 'open':
        streams.set(message.id, decoderInThread(recognizer, gateFor(message.profile), extras))
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
      case 'enrolScript': {
        const decoder = streams.get(message.id)
        const reply = (result: ScriptResult): void => port.postMessage({ type: 'scripted', id: message.id, seq: message.seq, result } satisfies FromWorker)
        const learning = decoder?.enrolScript?.(message.phrases, (count) => port.postMessage({ type: 'enrolPhrase', id: message.id, seq: message.seq, count } satisfies FromWorker))
        if (!learning) reply({ ok: false, phrases: 0, seconds: 0 })
        else learning.then(reply, () => reply({ ok: false, phrases: 0, seconds: 0 }))
        return
      }
      case 'enrolFinish':
        streams.get(message.id)?.enrolFinish?.()
        return
      case 'capture':
        try {
          void streams.get(message.id)?.capture?.(message.text, message.judgement)
        } catch {
          // Calibration only.
        }
        return
    }
  })
}

if (!isMainThread && parentPort) {
  const data = workerData as WorkerData
  const loaded = loadModel(data.root)
  if (loaded.ok) {
    const speaker = openSpeakerGate(data.root)
    const extras = openDecoderExtras(data.root)
    serve(parentPort, loaded.recognizer, speaker.gateFor, extras)
    parentPort.postMessage({ type: 'loaded', ms: loaded.ms, speaker: speaker.status, vad: extras.vad != null } satisfies FromWorker)
  } else {
    parentPort.postMessage({ type: 'unavailable', reason: loaded.reason } satisfies FromWorker)
  }
}

/** Decoders over a recogniser (and a speaker gate, round 4; the speech detector and capture, round 7) on this thread. */
export function hostInThread(recognizer: OnlineRecognizerLike, ms: number, speaker: { status: SpeakerStatus; gateFor(profile?: string): SpeakerGate } | null = null, extras: DecoderExtras = {}): DecoderHost {
  return {
    where: 'thread',
    ms,
    speaker: speaker?.status ?? { model: false, profile: false },
    vad: extras.vad != null,
    open: (profile) => decoderInThread(recognizer, speaker?.gateFor(profile) ?? null, extras),
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
    const scripting = new Map<string, { resolve(result: ScriptResult): void; onPhrase(count: number): void }>()
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
      vad: false,
      open(profile) {
        const id = nextId
        nextId += 1
        let seq = 0
        worker.postMessage((profile === undefined ? { type: 'open', id } : { type: 'open', id, profile }) satisfies ToWorker)
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
          enrolScript(phrases, onPhrase) {
            seq += 1
            const mine = seq
            return new Promise<ScriptResult>((resolveScript) => {
              scripting.set(key(id, mine), { resolve: resolveScript, onPhrase })
              worker.postMessage({ type: 'enrolScript', id, seq: mine, phrases } satisfies ToWorker)
            })
          },
          enrolFinish() {
            worker.postMessage({ type: 'enrolFinish', id } satisfies ToWorker)
          },
          capture(text, judgement) {
            worker.postMessage({ type: 'capture', id, text, judgement } satisfies ToWorker)
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
          host.vad = message.vad
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
        case 'enrolPhrase':
          scripting.get(key(message.id, message.seq))?.onPhrase(message.count)
          return
        case 'scripted':
          scripting.get(key(message.id, message.seq))?.resolve(message.result)
          scripting.delete(key(message.id, message.seq))
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
      for (const entry of scripting.values()) entry.resolve({ ok: false, phrases: 0, seconds: 0 })
      scripting.clear()
      if (!started) {
        started = true
        resolve({ ok: false, reason: 'load_failed' })
        return
      }
      for (const listener of exitListeners) listener(code)
    })
  })
}
