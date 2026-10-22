// Reading aloud in the offscreen document (docs/ARCHITECTURE.md 29.5, "Built (checkpoint 2)"): the
// sentences of a reading spoken one by one through the browser's speechSynthesis, over the pure
// state machine of src/core/reading.ts. The voice, the timers and the "speaking aloud" signal that
// mutes the microphone live here; the speech itself is behind SpeechPort so the tests fake it.

import { READ_IDLE, readStep } from '../../src/core/reading.ts'
import type { ReadEffect, ReadEvent, ReadState } from '../../src/core/reading.ts'

export interface SpeechVoiceInfo {
  name: string
  lang: string
}

export interface SpeechEvents {
  start(): void
  end(): void
  error(code: string): void
}

/** What the reader needs of speechSynthesis. */
export interface SpeechPort {
  voices(): readonly SpeechVoiceInfo[]
  speak(text: string, voice: SpeechVoiceInfo, events: SpeechEvents): void
  cancel(): void
}

/** Listening comes back this long after the last thing spoken ends or is stopped (29.5: within 300 ms). */
export const RESUME_MS = 150
/** An empty voice list is looked at again this often, for this long (network voices arrive late). */
export const VOICE_POLL_MS = 100
export const VOICE_WAIT_MS = 1500
/** A sentence that has not ended in this long counts as failed, so a silent voice cannot hold the microphone shut. */
export const sentenceTimeoutMs = (text: string): number => 5000 + 120 * text.length

/** The first Estonian voice: lang "et", "et-EE", "et_EE", any case. */
export function estonianVoice(voices: readonly SpeechVoiceInfo[]): SpeechVoiceInfo | null {
  return voices.find((v) => /^et(?:[-_]|$)/i.test(v.lang)) ?? null
}

/** The browser's speechSynthesis, looked up at every call (a test may put a fake in its place). */
export function browserSpeech(): SpeechPort | null {
  const synth = (): SpeechSynthesis | null => (typeof globalThis.speechSynthesis === 'object' && globalThis.speechSynthesis !== null ? globalThis.speechSynthesis : null)
  if (synth() === null || typeof SpeechSynthesisUtterance !== 'function') return null
  return {
    voices: () => synth()?.getVoices() ?? [],
    speak(text, voice, events) {
      const s = synth()
      if (s === null) {
        events.error('no_synthesis')
        return
      }
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = voice.lang
      utterance.rate = 1
      // The voice must be the browser's own object; a stand-in is left out and lang picks the voice.
      try {
        if (typeof SpeechSynthesisVoice === 'function' && voice instanceof SpeechSynthesisVoice) utterance.voice = voice
      } catch {
        // lang alone then.
      }
      utterance.onstart = () => events.start()
      utterance.onend = () => events.end()
      utterance.onerror = (event) => events.error(typeof event.error === 'string' ? event.error : 'error')
      s.speak(utterance)
    },
    cancel: () => synth()?.cancel(),
  }
}

export interface ReaderDeps {
  /** The speech, looked up when a reading starts. Null: this browser cannot speak. */
  port(): SpeechPort | null
  /**
   * A bar line ("Loe riba ette") is being spoken, or it stopped RESUME_MS ago: the microphone is muted
   * while on. A reading never mutes it (29.5): the engine filters the finals while reading, so "stopp" is heard.
   */
  onAloud(on: boolean): void
  /** A reading is in progress, or not. */
  onReading(on: boolean): void
  /** A line for the bar from the reading itself. */
  onLine(line: 'skipped' | 'ended'): void
}

export type ReadOutcome = 'reading' | 'no_voice' | 'nothing'

export interface Reader {
  /** Starts a reading of these sentences (a reading in progress is replaced). */
  read(sentences: readonly string[]): Promise<ReadOutcome>
  /** Stops the reading in progress; false when none was. cancel() is called before this returns. */
  stop(): boolean
  /** "loe edasi": the next sentence after a stop; false when there is none. */
  next(): boolean
  /** Speaks one bar line ("Loe riba ette"), unless a reading is in progress or there is no Estonian voice. */
  sayLine(text: string): void
  readonly reading: boolean
}

export function createReader(deps: ReaderDeps): Reader {
  let state: ReadState = READ_IDLE
  let port: SpeechPort | null = null
  let voice: SpeechVoiceInfo | null = null
  /** Every speak gets a token; events of an older one (cancelled, replaced) are ignored. */
  let token = 0
  let aloud = false
  let resumeTimer: ReturnType<typeof setTimeout> | null = null
  let sentenceTimer: ReturnType<typeof setTimeout> | null = null

  const setAloud = (on: boolean): void => {
    if (resumeTimer !== null) clearTimeout(resumeTimer)
    resumeTimer = null
    if (on) {
      if (!aloud) {
        aloud = true
        deps.onAloud(true)
      }
      return
    }
    if (!aloud) return
    resumeTimer = setTimeout(() => {
      resumeTimer = null
      aloud = false
      deps.onAloud(false)
    }, RESUME_MS)
  }

  const clearSentenceTimer = (): void => {
    if (sentenceTimer !== null) clearTimeout(sentenceTimer)
    sentenceTimer = null
  }

  const apply = (event: ReadEvent): void => {
    const step = readStep(state, event)
    state = step.state
    for (const effect of step.effects) perform(effect)
  }

  const perform = (effect: ReadEffect): void => {
    switch (effect.kind) {
      case 'speak':
        speakSentence(effect.text)
        break
      case 'cancel':
        token += 1
        clearSentenceTimer()
        port?.cancel()
        break
      case 'reading':
        deps.onReading(effect.on)
        break
      case 'line':
        deps.onLine(effect.line)
        break
    }
  }

  const speakSentence = (text: string): void => {
    const p = port
    const v = voice
    token += 1
    const mine = token
    clearSentenceTimer()
    if (p === null || v === null) {
      apply({ kind: 'sentenceError' })
      return
    }
    const fail = (): void => {
      if (mine !== token) return
      token += 1
      clearSentenceTimer()
      apply({ kind: 'sentenceError' })
    }
    sentenceTimer = setTimeout(fail, sentenceTimeoutMs(text))
    p.speak(text, v, {
      start: () => undefined,
      end: () => {
        if (mine !== token) return
        token += 1
        clearSentenceTimer()
        apply({ kind: 'sentenceEnd' })
      },
      error: fail,
    })
  }

  /** The Estonian voice, looking again while the list is empty for up to VOICE_WAIT_MS. */
  const findVoice = async (p: SpeechPort): Promise<SpeechVoiceInfo | null> => {
    let voices = p.voices()
    for (let waited = 0; voices.length === 0 && waited < VOICE_WAIT_MS; waited += VOICE_POLL_MS) {
      await new Promise((resolve) => setTimeout(resolve, VOICE_POLL_MS))
      voices = p.voices()
    }
    return estonianVoice(voices)
  }

  return {
    async read(sentences) {
      if (sentences.length === 0) return 'nothing'
      const p = deps.port()
      const v = p === null ? null : await findVoice(p)
      if (p === null || v === null) return 'no_voice'
      // A bar line being spoken goes first.
      if (state.phase !== 'speaking') {
        token += 1
        p.cancel()
        setAloud(false)
      }
      port = p
      voice = v
      apply({ kind: 'start', sentences })
      return 'reading'
    },
    stop() {
      if (state.phase !== 'speaking') return false
      apply({ kind: 'stop' })
      return true
    },
    next() {
      if (state.phase !== 'stopped' || state.at + 1 >= state.sentences.length) return false
      apply({ kind: 'continue' })
      return true
    },
    sayLine(text) {
      if (state.phase === 'speaking' || text.trim() === '') return
      const p = deps.port()
      const v = p === null ? null : estonianVoice(p.voices())
      if (p === null || v === null) return
      token += 1
      const mine = token
      p.cancel()
      setAloud(true)
      const done = (): void => {
        if (mine !== token) return
        clearSentenceTimer()
        setAloud(false)
      }
      clearSentenceTimer()
      sentenceTimer = setTimeout(done, sentenceTimeoutMs(text))
      p.speak(text, v, { start: () => undefined, end: done, error: done })
    },
    get reading() {
      return state.phase === 'speaking'
    },
  }
}
