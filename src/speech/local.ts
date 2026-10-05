import { createAssembler } from './assembler.ts'
import { ASR_PATH, ASR_SAMPLE_RATE, INSTANT_SETTLE_MS, LOCAL_HOLD_MS, parseAsrMessage } from './asrProtocol.ts'
import type { AsrClientMessage } from './asrProtocol.ts'
import type { Recognizer, RecognizerHandlers } from './recognizer.ts'

/** The parts of the browser's WebSocket this recogniser uses. */
export interface SocketLike {
  readonly readyState: number
  /** Bytes queued and not yet handed to the network. */
  readonly bufferedAmount: number
  send(data: ArrayBuffer | string): void
  close(): void
}

/** What the socket reports. An error is always followed by a close. */
export interface SocketEvents {
  message(data: unknown): void
  close(): void
}

/** Microphone audio as 16 kHz mono float frames. Rejects when the microphone cannot be opened. */
export interface AudioSource {
  start(onFrame: (samples: Float32Array<ArrayBuffer>) => void): Promise<void>
  stop(): void
}

export interface LocalOptions {
  /** This machine cannot recognise: the caller switches to another engine. Called at most once per start. */
  onUnavailable(): void
  connect?: (events: SocketEvents) => SocketLike
  /** The recogniser's websocket address. Default: /api/asr on the page's own host. The extension sets it. */
  address?: string
  audio: () => AudioSource
  /** How long a final is held to be joined with the next one. Default LOCAL_HOLD_MS. */
  holdMs?: number
}

const OPEN = 1
const RETRY_MS = 500
/** Tries to bring back a lost connection before giving up. */
const MAX_RETRIES = 3
const MIC_BLOCKED = 'The microphone is blocked or missing. Allow it in the address bar, or type instead.'
/** Bytes of audio per millisecond on the wire: float32 at 16 kHz. */
const BYTES_PER_MS = (ASR_SAMPLE_RATE * 4) / 1000
/** Audio the socket may hold unsent before frames are dropped: 2 s. */
export const MAX_BUFFERED_BYTES = 2000 * BYTES_PER_MS

/** The browser's websocket to the recogniser, at address or at /api/asr on the page's own host. */
export function browserSocket(events: SocketEvents, address?: string): SocketLike {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(address ?? `${scheme}://${location.host}${ASR_PATH}`)
  ws.binaryType = 'arraybuffer'
  ws.onmessage = (event) => events.message(event.data)
  ws.onclose = () => events.close()
  return ws
}

/** True when this browser can stream the microphone to the local recogniser. */
export function localRecognizerPossible(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof WebSocket !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices !== undefined
  )
}

/** Lower-case words without punctuation, for comparing what was released with what the server finalises. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '')
}

/**
 * The local recogniser on the dev server (ARCHITECTURE 20.1) behind the Recognizer interface.
 * Bilingual, so setLang changes nothing. Finals go through the same assembler as Chrome's, with a
 * shorter hold. A quick reply does not wait for the final: a partial that is one, with nothing held,
 * is released once it has stayed the same for INSTANT_SETTLE_MS, and the final for those same words
 * is then swallowed on the client (only the words after them are delivered).
 *
 * Lag (23.1): a frame is dropped, not queued, while the socket holds more than MAX_BUFFERED_BYTES
 * unsent, and the server's lag messages and the local drops both reach onLag. A flush asks the
 * server for the final of the utterance in progress, releases a settling quick reply at once, and
 * delivers what the assembler holds without the hold (joined with that final when one is coming).
 */
export function createLocalRecognizer(
  handlers: RecognizerHandlers,
  isInstant: (text: string) => boolean,
  options: LocalOptions,
): Recognizer {
  const assembler = createAssembler({ holdMs: options.holdMs ?? LOCAL_HOLD_MS, onUtterance: handlers.onUtterance, isInstant })
  const connect = options.connect ?? ((events: SocketEvents) => browserSocket(events, options.address))
  let running = false
  let served = false
  let attempts = 0
  let socket: SocketLike | null = null
  let audio: AudioSource | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let settle: ReturnType<typeof setTimeout> | null = null
  let settling = ''
  /** The words of a quick reply released from a partial, until the server's final for them arrives. */
  let released: string[] | null = null
  /** The last partial of the utterance in progress; empty after its final. */
  let current = ''
  /** A flush was sent while an utterance was in progress: its final is delivered without the hold. */
  let flushed = false
  /** Frames not sent because the socket was full; the next sent frame ends the lag. */
  let dropping = false

  const cancelSettle = (): void => {
    if (settle !== null) clearTimeout(settle)
    settle = null
    settling = ''
  }

  const releaseInstant = (text: string): void => {
    released = words(text)
    handlers.onInterim('')
    handlers.onUtterance(text)
  }

  const onPartial = (text: string): void => {
    current = text
    flushed = false
    if (released !== null) {
      // Still the reply already released: nothing new to show.
      const heard = words(text)
      const extra = heard.length > released.length || heard.some((word, i) => word !== released?.[i])
      handlers.onInterim(extra ? text : '')
      if (extra) assembler.activity()
      return
    }
    if (text !== '') assembler.activity()
    handlers.onInterim(text)
    if (text === settling) return
    cancelSettle()
    if (text === '' || !assembler.idle() || !isInstant(text)) return
    settling = text
    settle = setTimeout(() => {
      settle = null
      settling = ''
      if (!assembler.idle()) return
      releaseInstant(text)
    }, INSTANT_SETTLE_MS)
  }

  const onFinal = (text: string): void => {
    cancelSettle()
    handlers.onInterim('')
    current = ''
    const atOnce = flushed
    flushed = false
    const before = released
    released = null
    if (before === null) {
      assembler.final(text)
    } else {
      const heard = words(text)
      // The final is the same breath heard again. The model often changes its mind by a word
      // ("saada" becomes "saadake", "keri alla" becomes "keri alla ja"); the command has already
      // run, so a final no more than one word longer than what was released is that breath and is dropped.
      if (heard.length > before.length + 1) {
        const same = before.every((word, i) => heard[i] === word)
        if (!same) assembler.final(text)
        else {
          // Drop the released words; keep the rest as the user said it.
          const rest = text.trim().split(/\s+/).slice(before.length).join(' ')
          if (rest !== '') assembler.final(rest)
        }
      }
    }
    if (atOnce) assembler.releaseNow()
  }

  const teardown = (): void => {
    if (retry !== null) clearTimeout(retry)
    retry = null
    cancelSettle()
    released = null
    current = ''
    flushed = false
    dropping = false
    const ws = socket
    socket = null
    ws?.close()
    audio?.stop()
    audio = null
    assembler.dispose()
    handlers.onInterim('')
  }

  const giveUp = (): void => {
    running = false
    teardown()
    options.onUnavailable()
  }

  const sendFrame = (samples: Float32Array<ArrayBuffer>): void => {
    if (socket?.readyState !== OPEN) return
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      // The network is not taking the audio: queuing more would only make the delay longer.
      dropping = true
      handlers.onLag?.(Math.round(socket.bufferedAmount / BYTES_PER_MS))
      return
    }
    if (dropping) {
      dropping = false
      handlers.onLag?.(0)
    }
    socket.send(samples.buffer)
  }

  const listen = (): void => {
    const source = options.audio()
    audio = source
    source.start(sendFrame).catch(() => {
      if (audio !== source || !running) return
      running = false
      teardown()
      handlers.onError(MIC_BLOCKED)
    })
  }

  const open = (): void => {
    retry = null
    if (!running) return
    const onMessage = (data: unknown): void => {
      if (socket !== ws || typeof data !== 'string') return
      const message = parseAsrMessage(data)
      if (!message) return
      switch (message.type) {
        case 'ready':
          served = true
          attempts = 0
          listen()
          return
        case 'unavailable':
          giveUp()
          return
        case 'partial':
          onPartial(message.text)
          return
        case 'final':
          onFinal(message.text)
          return
        case 'lag':
          handlers.onLag?.(message.ms)
          return
      }
    }

    const onClose = (): void => {
      if (socket !== ws) return
      socket = null
      audio?.stop()
      audio = null
      handlers.onInterim('')
      if (!running) return
      // Refused before it ever answered: nothing is listening on this machine.
      if (!served) {
        giveUp()
        return
      }
      attempts += 1
      if (attempts > MAX_RETRIES) {
        giveUp()
        return
      }
      retry = setTimeout(open, RETRY_MS)
    }

    const ws = connect({ message: onMessage, close: onClose })
    socket = ws
  }

  return {
    supported: true,
    start() {
      if (running) return
      running = true
      served = false
      attempts = 0
      open()
    },
    stop() {
      running = false
      teardown()
    },
    setLang() {
      // One model hears Estonian and English.
    },
    flush() {
      if (!running) return
      const asked = socket?.readyState === OPEN
      if (asked) socket?.send(JSON.stringify({ type: 'flush' } satisfies AsrClientMessage))
      if (settling !== '') {
        const text = settling
        cancelSettle()
        if (assembler.idle()) releaseInstant(text)
      }
      // With words in progress the server's final is moments away: it joins what is held, then all goes at once.
      if (asked && current !== '' && released === null) {
        flushed = true
        return
      }
      assembler.releaseNow()
    },
  }
}
