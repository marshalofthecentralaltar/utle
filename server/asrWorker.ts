/**
 * The decoder on its own thread (ARCHITECTURE 23.1). The main thread forwards frames and gets
 * results back; model load and decode never block /api/intent or Vite. This file is both the
 * worker's entry (Node strips its types: the repository's imports carry .ts and its syntax is
 * erasable) and the main thread's side of it.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { AsrUnavailableReason } from '../src/speech/asrProtocol.ts'
import { loadModel } from './asrModel.ts'
import type { DecodeResult, Decoder, OnlineRecognizerLike, OnlineStreamLike } from './asrSession.ts'
import { decoderInThread } from './asrSession.ts'

/** Main thread to worker. The frame's buffer is transferred, not copied. */
export type ToWorker =
  | { type: 'open'; id: number }
  | { type: 'accept'; id: number; seq: number; samples: Float32Array }
  | { type: 'reset'; id: number }
  | { type: 'close'; id: number }

/** Worker to main thread. */
export type FromWorker =
  | { type: 'loaded'; ms: number }
  | { type: 'unavailable'; reason: AsrUnavailableReason }
  | { type: 'result'; id: number; seq: number; result: DecodeResult }
  | { type: 'failed'; id: number; seq: number; message: string }

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
  open(): Decoder
  /** The worker died, or the thread's recogniser is gone: the host is finished. */
  onExit(listener: (code: number) => void): void
}

export type HostStart = { ok: true; host: DecoderHost } | { ok: false; reason: AsrUnavailableReason }

/** The worker's side: one shared recogniser, one stream per session id. */
function serve(port: NonNullable<typeof parentPort>, recognizer: OnlineRecognizerLike<OnlineStreamLike>): void {
  const streams = new Map<number, Decoder>()
  port.on('message', (message: ToWorker) => {
    switch (message.type) {
      case 'open':
        streams.set(message.id, decoderInThread(recognizer))
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
    }
  })
}

if (!isMainThread && parentPort) {
  const data = workerData as WorkerData
  const loaded = loadModel(data.root)
  if (loaded.ok) {
    serve(parentPort, loaded.recognizer)
    parentPort.postMessage({ type: 'loaded', ms: loaded.ms } satisfies FromWorker)
  } else {
    parentPort.postMessage({ type: 'unavailable', reason: loaded.reason } satisfies FromWorker)
  }
}

/** Decoders over a recogniser on this thread. */
export function hostInThread(recognizer: OnlineRecognizerLike, ms: number): DecoderHost {
  return {
    where: 'thread',
    ms,
    open: () => decoderInThread(recognizer),
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
      if (!started) {
        started = true
        resolve({ ok: false, reason: 'load_failed' })
        return
      }
      for (const listener of exitListeners) listener(code)
    })
  })
}
