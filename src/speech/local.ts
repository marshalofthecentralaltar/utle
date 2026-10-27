import { CONNECTIVE_HOLD_MS } from '../core/chain.ts'
import { createAssembler } from './assembler.ts'
import type { AssemblerOptions } from './assembler.ts'
import { ASR_PATH, ASR_SAMPLE_RATE, INSTANT_SETTLE_MS, LOCAL_HOLD_MS, authorizes, parseAsrMessage } from './asrProtocol.ts'
import type { AsrClientMessage, AsrServerMessage, SpeakerDecision, SpeakerReason, SpeakerSessionInfo } from './asrProtocol.ts'
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
  /**
   * Round 4: only the owner's voice is obeyed. Round 10 (31.3, fail closed): a final is delivered
   * only with a decision that authorizes it (verified owner, this socket's session and profile
   * version, a new segment); partials are inert (never shown, never a quick reply).
   */
  onlyOwner?: boolean
  /**
   * Round 9 (30.1): never give up on a refused or lost socket while listening is on; try again
   * after RECONNECT_MS. The extension sets it; the dev page keeps the give-up, which switches it to
   * Chrome's recogniser. A server message `unavailable` (no model) gives up either way.
   */
  keepTrying?: boolean
}

/** Round 9 (30.1): the waits before each new try in an outage; the last one repeats. */
export const RECONNECT_MS = [1000, 2000, 4000, 5000] as const

/** Round 9 (30.1): the wait before try number `attempt` (1 for the first try after a failure). */
export function reconnectDelay(attempt: number): number {
  return RECONNECT_MS[Math.min(Math.max(attempt, 1), RECONNECT_MS.length) - 1] ?? 5000
}

/** Round 7: after this many dropped finals in a row the bar says once to teach the voice again. */
export const RETRAIN_AFTER_DROPS = 3

/** Round 7: the drop of this streak is the one that says to teach the voice again (once per streak). */
export function retrainDue(streak: number): boolean {
  return streak === RETRAIN_AFTER_DROPS
}

/**
 * Round 7 (strict mode): a final with this speaker is dropped while only the owner is obeyed.
 * Round 10 (31.3): a final without a speaker is dropped too; `owner` is necessary, not sufficient
 * (the decision must also authorize it, `authorizes`).
 */
export function dropsFinal(onlyOwner: boolean, speaker: 'owner' | 'other' | 'unknown' | undefined): boolean {
  return onlyOwner && speaker !== 'owner'
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
  // Round 4 (the chain lane): a final ending with a connective is held CONNECTIVE_HOLD_MS, and one
  // starting with a connective soon after a delivery continues it. Only this block is the chain's.
  // Round 10 (31.3): with only the owner obeyed, only authorized finals enter the assembler, and
  // what it delivers carries the decision of the newest of them.
  const strict = options.onlyOwner === true
  /** The decision of the newest authorized final; null when none (or after a lost connection). */
  let authorized: SpeakerDecision | null = null
  const continuedWith = (text: string, added: string): void => {
    if (!strict) {
      handlers.onUtteranceContinued?.(text, added)
      return
    }
    if (authorized !== null) handlers.onUtteranceContinued?.(text, added, authorized)
  }
  const chained: Pick<AssemblerOptions, 'connectiveHoldMs' | 'onUtteranceContinued'> = {
    connectiveHoldMs: CONNECTIVE_HOLD_MS,
    ...(handlers.onUtteranceContinued ? { onUtteranceContinued: continuedWith } : {}),
  }
  const delivered = strict
    ? (text: string): void => {
        if (authorized !== null) handlers.onUtterance(text, authorized)
      }
    : handlers.onUtterance
  const assembler = createAssembler({ holdMs: options.holdMs ?? LOCAL_HOLD_MS, onUtterance: delivered, isInstant, ...chained })
  const connect = options.connect ?? ((events: SocketEvents) => browserSocket(events, options.address))
  let running = false
  let served = false
  let attempts = 0
  let socket: SocketLike | null = null
  let audio: AudioSource | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  /** Round 9 (30.1): the last connection state reported, so each change is reported once. */
  let connection: 'connecting' | 'connected' | 'down' | null = null
  const report = (state: 'connecting' | 'connected' | 'down'): void => {
    if (connection === state) return
    connection = state
    handlers.onConnection?.(state)
  }
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
    // Round 5 (review M8): a quick reply past the assembler still counts as the last delivery.
    assembler.noteDelivered(text)
    handlers.onUtterance(text)
  }

  const onPartial = (text: string): void => {
    // A partial after a flush is the flushed utterance still being decoded (the frames queued before
    // the flush); its final is still the one owed at once.
    current = text
    // Round 10 (31.3): unverified words are inert: never shown, typed or released as a quick reply.
    if (strict) {
      if (text !== '') assembler.activity()
      return
    }
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

  // ---- The owner's voice (round 4, VOICE lane; ARCHITECTURE 24.2) ----
  /**
   * A final the server marks as another voice, while only the owner is obeyed: nothing is
   * delivered. The preview its partials typed stays in the box until the owner's next utterance
   * begins, when the engine takes it back (an empty utterance would cancel the model work of an
   * earlier one, so none is sent). Words held from an earlier flush still go.
   */
  /** Round 7: finals dropped in a row; an obeyed final resets it. */
  let dropStreak = 0
  /** Round 10 (31.3): the session and profile version the server announced on this socket; null until then. */
  let expected: SpeakerSessionInfo | null = null
  /** Round 10: the newest segment authorized on this socket. */
  let lastSegment = 0
  const forgetAuthorization = (): void => {
    expected = null
    lastSegment = 0
    authorized = null
  }
  const onForeignFinal = (reason?: SpeakerReason): void => {
    cancelSettle()
    handlers.onInterim('')
    current = ''
    released = null
    const atOnce = flushed
    flushed = false
    if (atOnce) assembler.releaseNow()
    dropStreak += 1
    if (reason === undefined) handlers.onForeign?.(dropStreak)
    else handlers.onForeign?.(dropStreak, reason)
  }
  /** Round 10 (31.3): a final while only the owner is obeyed: delivered only when its own decision authorizes it. */
  const strictFinal = (message: Extract<AsrServerMessage, { type: 'final' }>): void => {
    const decision = message.decision
    if (decision !== undefined && message.segment === decision.segmentId && authorizes(decision, expected, lastSegment)) {
      lastSegment = decision.segmentId
      authorized = decision
      dropStreak = 0
      onFinal(message.text)
      return
    }
    onForeignFinal(decision?.reason ?? 'verification_error')
  }
  const send = (message: AsrClientMessage): boolean => {
    if (socket?.readyState !== OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }
  /** An enrolment asked before the socket was ready is sent at ready. */
  let enrolWanted: number | null = null
  const sendEnrol = (seconds: number): void => {
    if (send({ type: 'enrol', seconds })) enrolWanted = null
    else enrolWanted = seconds
  }
  /** Round 7: a scripted enrolment asked before the socket was ready is sent at ready. */
  let scriptWanted: number | null = null
  const sendScript = (phrases: number): void => {
    if (send({ type: 'enrolScript', phrases })) scriptWanted = null
    else scriptWanted = phrases
  }
  /** Right after ready: the server knows the mode, and any enrolment that waited for the connection goes. */
  const afterReady = (): void => {
    if (options.onlyOwner === true) send({ type: 'onlyOwner', on: true })
    if (enrolWanted !== null) sendEnrol(enrolWanted)
    if (scriptWanted !== null) sendScript(scriptWanted)
  }
  // ---- end of the owner's voice ----

  const teardown = (): void => {
    forgetAuthorization()
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
          report('connected')
          afterReady()
          listen()
          return
        case 'unavailable':
          giveUp()
          return
        case 'partial':
          onPartial(message.text)
          return
        case 'final':
          if (strict) strictFinal(message)
          else {
            dropStreak = 0
            onFinal(message.text)
          }
          return
        case 'rejected':
          if (strict) onForeignFinal(message.decision.reason)
          return
        case 'speakerSession':
          // A new session starts the segments over; a new profile version (after enrolment) in the same session does not.
          if (expected?.sessionId !== message.sessionId) lastSegment = 0
          expected = { sessionId: message.sessionId, profileVersion: message.profileVersion }
          return
        case 'lag':
          handlers.onLag?.(message.ms)
          return
        case 'enrolled':
          handlers.onEnrolled?.(message.ok, message.seconds, message.phrases)
          return
        case 'enrolPhrase':
          handlers.onEnrolPhrase?.(message.count)
          return
      }
    }

    const onClose = (): void => {
      if (socket !== ws) return
      socket = null
      // Round 10 (31.3): nothing verified on this connection runs after it; what is held goes.
      if (strict) {
        forgetAuthorization()
        assembler.dispose()
        current = ''
        flushed = false
      }
      audio?.stop()
      audio = null
      handlers.onInterim('')
      if (!running) return
      report('down')
      // Round 9 (30.1): the extension waits for the server to come back, once per change on the strip.
      if (options.keepTrying === true) {
        attempts += 1
        retry = setTimeout(open, reconnectDelay(attempts))
        return
      }
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

  /**
   * Stopped while a flush waits for its final (the gaze left; the server is behind): the words in
   * progress are delivered as last heard, and whatever is held goes with them, rather than being
   * dropped with the socket. Without a flush a stop drops the utterance in progress and what is
   * held, as before (he stopped: those words were not asked for).
   */
  const deliverPending = (): void => {
    if (!flushed) return
    // Round 10 (31.3): words never verified are never delivered.
    if (current !== '' && released === null && !strict) assembler.final(current)
    assembler.releaseNow()
  }

  return {
    supported: true,
    start() {
      if (running) return
      running = true
      served = false
      attempts = 0
      connection = null
      report('connecting')
      open()
    },
    stop() {
      if (running) deliverPending()
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
    enrol(seconds) {
      if (!running) return
      sendEnrol(seconds)
    },
    enrolScript(phrases) {
      if (!running) return
      sendScript(phrases)
    },
    enrolFinish() {
      if (!running) return
      scriptWanted = null
      send({ type: 'enrolFinish' })
    },
  }
}
