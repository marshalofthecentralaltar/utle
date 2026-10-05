import { existsSync } from 'node:fs'
import type { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import type { RawData, WebSocket } from 'ws'
import { ASR_PATH } from '../src/speech/asrProtocol.ts'
import type { AsrServerMessage, AsrUnavailableReason } from '../src/speech/asrProtocol.ts'
import { createAsrSession, samplesFromFrame } from './asrSession.ts'
import type { OnlineRecognizerLike } from './asrSession.ts'

export const MODEL_DIR = join('models', 'streaming-zipformer-large.et-en')
export const MODEL_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'] as const

export type ModelLoad = { ok: true; recognizer: OnlineRecognizerLike; ms: number } | { ok: false; reason: AsrUnavailableReason }

type RecognizerConstructor = new (config: unknown) => OnlineRecognizerLike

/** Loads the native addon and the model. Lazily: nothing here runs in the browser bundle or the build. */
export function loadModel(root: string): ModelLoad {
  const dir = join(root, MODEL_DIR)
  if (!MODEL_FILES.every((file) => existsSync(join(dir, file)))) return { ok: false, reason: 'model_missing' }

  let OnlineRecognizer: RecognizerConstructor
  try {
    const addon: unknown = createRequire(join(root, 'package.json'))('sherpa-onnx-node')
    const found = (addon as { OnlineRecognizer?: unknown }).OnlineRecognizer
    if (typeof found !== 'function') return { ok: false, reason: 'addon_missing' }
    OnlineRecognizer = found as RecognizerConstructor
  } catch {
    return { ok: false, reason: 'addon_missing' }
  }

  try {
    const started = Date.now()
    const recognizer = new OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(dir, 'encoder.int8.onnx'),
          decoder: join(dir, 'decoder.int8.onnx'),
          joiner: join(dir, 'joiner.int8.onnx'),
        },
        tokens: join(dir, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'modified_beam_search',
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.0,
      rule3MinUtteranceLength: 30,
    })
    return { ok: true, recognizer, ms: Date.now() - started }
  } catch {
    return { ok: false, reason: 'load_failed' }
  }
}

const send = (socket: WebSocket, message: AsrServerMessage): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

/**
 * Serves the local recogniser at /api/asr on the dev server's own http server. Only upgrades to
 * that path are taken, so Vite's HMR socket is untouched. The model loads once, when the server
 * starts listening. Logs counts, durations and reason codes; never audio, never text.
 */
export function attachAsr(httpServer: EventEmitter, root: string, load: (root: string) => ModelLoad = loadModel): void {
  const sockets = new WebSocketServer({ noServer: true })
  let model: ModelLoad | null = null
  let open = 0

  const ensureModel = (): ModelLoad => {
    if (model) return model
    model = load(root)
    if (model.ok) console.info(`[asr] model loaded in ${model.ms} ms`)
    else console.warn(`[asr] local recogniser unavailable: ${model.reason}`)
    return model
  }

  httpServer.once('listening', () => {
    // Give Vite a moment to print its address before the load blocks the thread for a few seconds.
    setTimeout(ensureModel, 200)
  })

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== ASR_PATH) return
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const loaded = ensureModel()
      if (!loaded.ok) {
        send(ws, { type: 'unavailable', reason: loaded.reason })
        ws.close(1011)
        return
      }
      open += 1
      console.info(`[asr] connection opened (${open} open)`)
      const session = createAsrSession(loaded.recognizer, (message) => send(ws, message))
      send(ws, { type: 'ready' })
      ws.on('message', (data: RawData, isBinary: boolean) => {
        if (!isBinary || !Buffer.isBuffer(data)) return
        const samples = samplesFromFrame(data)
        if (!samples) return
        try {
          session.audio(samples)
        } catch {
          console.warn('[asr] decode failed')
          ws.close(1011)
        }
      })
      ws.on('close', (code: number) => {
        session.close()
        open -= 1
        console.info(`[asr] connection closed, code ${code} (${open} open)`)
      })
    })
  })
}
