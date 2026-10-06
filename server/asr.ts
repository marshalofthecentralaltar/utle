import type { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import type { RawData, WebSocket } from 'ws'
import { ASR_PATH } from '../src/speech/asrProtocol.ts'
import type { AsrClientMessage, AsrServerMessage, AsrUnavailableReason } from '../src/speech/asrProtocol.ts'
import { loadModel } from './asrModel.ts'
import type { ModelLoad } from './asrModel.ts'
import { createAsrSession, samplesFromFrame } from './asrSession.ts'
import { hostInThread, openSpeakerGate, startWorkerHost } from './asrWorker.ts'
import type { DecoderHost, HostStart, SpeakerStatus } from './asrWorker.ts'
import { attachSonioxSession } from './soniox.ts'

export { MODEL_DIR, MODEL_FILES, loadModel } from './asrModel.ts'
export type { ModelLoad } from './asrModel.ts'

/** The decode worker's entry, relative to the project root (the server runs from Vite's bundled config, so import.meta.url is no guide). */
export const WORKER_ENTRY = join('server', 'asrWorker.ts')

/** True when this connection should go to Soniox instead of the local model. */
export function wantsSoniox(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.UTLE_ASR === 'soniox') return true
  const query = url.split('?')[1] ?? ''
  return new URLSearchParams(query).get('engine') === 'soniox'
}

const send = (socket: WebSocket, message: AsrServerMessage): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

/** Enrolment may ask for this many seconds of speech at most (the owner's button asks for 8). */
export const MAX_ENROL_SECONDS = 30

/** One text frame from the browser, or null for anything else. */
export function parseClientFrame(data: RawData | string): AsrClientMessage | null {
  let value: unknown
  try {
    value = JSON.parse(data.toString())
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  switch (record.type) {
    case 'flush':
      return { type: 'flush' }
    case 'enrol':
      return typeof record.seconds === 'number' && record.seconds >= 1 && record.seconds <= MAX_ENROL_SECONDS ? { type: 'enrol', seconds: Math.round(record.seconds) } : null
    case 'onlyOwner':
      return typeof record.on === 'boolean' ? { type: 'onlyOwner', on: record.on } : null
    default:
      return null
  }
}

/** The log line about the speaker gate (round 4): what it has, never whose voice. */
export function speakerLine(status: SpeakerStatus): string {
  const model = status.model ? 'speaker model loaded' : 'no speaker model (npm run model fetches it; loudness only until then)'
  return `[asr] ${model}; owner's voice ${status.profile ? 'learnt' : 'not learnt yet'}`
}

export interface AttachOptions {
  /** Loads the model on this thread, when the worker cannot. Tests pass a fake. */
  load?: (root: string) => ModelLoad
  /** Starts the worker. Tests pass a fake or one that always fails. */
  startWorker?: (root: string, entry: string) => Promise<HostStart>
  /** The speaker gate for in-thread decoding (round 4). Default: over models/speaker/. Tests pass null or a fake. */
  speaker?: ReturnType<typeof openSpeakerGate> | null
}

/**
 * Serves the local recogniser at /api/asr on the dev server's own http server. Only upgrades to
 * that path are taken, so Vite's HMR socket is untouched. The model loads once, when the server
 * starts listening: on a worker thread when one can start, else on this thread. Logs counts,
 * durations and reason codes; never audio, never text.
 */
export function attachAsr(httpServer: EventEmitter, root: string, options: AttachOptions = {}): void {
  const load = options.load ?? loadModel
  const startWorker = options.startWorker ?? startWorkerHost
  const sockets = new WebSocketServer({ noServer: true })
  let host: Promise<{ ok: true; host: DecoderHost } | { ok: false; reason: AsrUnavailableReason }> | null = null
  let open = 0

  const start = async (): Promise<HostStart> => {
    const worker = await startWorker(root, join(root, WORKER_ENTRY))
    if (worker.ok) {
      console.info(`[asr] model loaded on a worker thread in ${worker.host.ms} ms`)
      console.info(speakerLine(worker.host.speaker))
      worker.host.onExit((code) => {
        console.warn(`[asr] decode worker exited with ${code}; the next connection loads the model again`)
        host = null
      })
      return worker
    }
    if (worker.reason !== 'load_failed') {
      console.warn(`[asr] local recogniser unavailable: ${worker.reason}`)
      return worker
    }
    console.warn('[asr] decode worker could not start; decoding on the server thread')
    const loaded = load(root)
    if (!loaded.ok) {
      console.warn(`[asr] local recogniser unavailable: ${loaded.reason}`)
      return loaded
    }
    console.info(`[asr] model loaded on the server thread in ${loaded.ms} ms`)
    const speaker = options.speaker === undefined ? openSpeakerGate(root) : options.speaker
    const inThread = hostInThread(loaded.recognizer, loaded.ms, speaker)
    console.info(speakerLine(inThread.speaker))
    return { ok: true, host: inThread }
  }

  const ensureHost = (): Promise<HostStart> => {
    if (!host) host = start()
    return host
  }

  httpServer.once('listening', () => {
    // Give Vite a moment to print its address first.
    setTimeout(() => void ensureHost(), 200)
  })

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== ASR_PATH) return
    sockets.handleUpgrade(req, socket, head, (ws) => {
      // Soniox (ARCHITECTURE 23.4): `?engine=soniox` on the socket address, or UTLE_ASR=soniox for every
      // connection, hands the socket to the second recogniser. Everything below is the local model.
      if (wantsSoniox(req.url ?? '')) {
        attachSonioxSession(ws, { apiKey: process.env.SONIOX_API_KEY })
        return
      }
      void ensureHost().then((loaded) => {
        if (ws.readyState !== ws.OPEN) return
        if (!loaded.ok) {
          send(ws, { type: 'unavailable', reason: loaded.reason })
          ws.close(1011)
          return
        }
        open += 1
        console.info(`[asr] connection opened on the ${loaded.host.where} (${open} open)`)
        const session = createAsrSession(loaded.host.open(), (message) => send(ws, message), {
          onError: () => {
            console.warn('[asr] decode failed')
            ws.close(1011)
          },
        })
        send(ws, { type: 'ready' })
        ws.on('message', (data: RawData, isBinary: boolean) => {
          if (!isBinary) {
            const frame = parseClientFrame(data)
            if (frame?.type === 'flush') session.flush()
            else if (frame?.type === 'enrol') session.enrol(frame.seconds)
            else if (frame?.type === 'onlyOwner') session.onlyOwner(frame.on)
            return
          }
          if (!Buffer.isBuffer(data)) return
          const samples = samplesFromFrame(data)
          if (samples) session.audio(samples)
        })
        ws.on('close', (code: number) => {
          const { receivedMs, droppedMs, foreignFinals } = session.stats()
          session.close()
          open -= 1
          console.info(`[asr] connection closed, code ${code}: ${Math.round(receivedMs / 1000)} s received, ${Math.round(droppedMs / 1000)} s dropped, ${foreignFinals} finals of other voices (${open} open)`)
        })
      })
    })
  })
}
