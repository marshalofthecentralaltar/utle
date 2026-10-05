import { describe, expect, it } from 'vitest'
import type { AsrServerMessage } from '../src/speech/asrProtocol.ts'
import { createAsrSession, samplesFromFrame } from './asrSession.ts'
import type { OnlineRecognizerLike, OnlineStreamLike } from './asrSession.ts'

/** A recogniser that "hears" one word per frame and ends the utterance on a silent frame. */
class FakeStream implements OnlineStreamLike {
  words: string[] = []
  pending: number[] = []
  endpoint = false
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void {
    this.pending.push(input.samples[0] ?? 0)
  }
}

const WORDS = ['ava', 'uus', 'vaheleht']

class FakeRecognizer implements OnlineRecognizerLike {
  resets = 0
  createStream(): FakeStream {
    return new FakeStream()
  }
  isReady(stream: FakeStream): boolean {
    return stream.pending.length > 0
  }
  decode(stream: FakeStream): void {
    const value = stream.pending.shift() ?? 0
    if (value === 0) stream.endpoint = true
    else stream.words.push(WORDS[(value - 1) % WORDS.length] ?? '')
  }
  getResult(stream: FakeStream): { text: string } {
    return { text: stream.words.join(' ') }
  }
  isEndpoint(stream: FakeStream): boolean {
    return stream.endpoint
  }
  reset(stream: FakeStream): void {
    this.resets += 1
    stream.words = []
    stream.endpoint = false
  }
}

const frame = (value: number): Float32Array => new Float32Array([value, value])

describe('local recogniser session', () => {
  it('sends a partial each time the text changes and a final at an endpoint, then starts over', () => {
    const recognizer = new FakeRecognizer()
    const sent: AsrServerMessage[] = []
    const session = createAsrSession(recognizer, (message) => sent.push(message))

    session.audio(frame(1))
    session.audio(frame(2))
    session.audio(frame(3))
    session.audio(frame(0))
    session.audio(frame(1))

    expect(sent).toEqual([
      { type: 'partial', text: 'ava' },
      { type: 'partial', text: 'ava uus' },
      { type: 'partial', text: 'ava uus vaheleht' },
      { type: 'final', text: 'ava uus vaheleht' },
      { type: 'partial', text: 'ava' },
    ])
    expect(recognizer.resets).toBe(1)
  })

  it('sends no final for silence and no partial when nothing changed', () => {
    const recognizer = new FakeRecognizer()
    const sent: AsrServerMessage[] = []
    const session = createAsrSession(recognizer, (message) => sent.push(message))

    session.audio(frame(0))
    session.audio(frame(0))

    expect(sent).toEqual([])
    expect(recognizer.resets).toBe(2)
  })

  it('ignores audio after it is closed', () => {
    const sent: AsrServerMessage[] = []
    const session = createAsrSession(new FakeRecognizer(), (message) => sent.push(message))
    session.close()
    session.audio(frame(1))
    expect(sent).toEqual([])
  })
})

describe('audio frames', () => {
  it('reads little-endian float samples', () => {
    const samples = new Float32Array([0.5, -0.25])
    const read = samplesFromFrame(Buffer.from(samples.buffer))
    expect(read && Array.from(read)).toEqual([0.5, -0.25])
  })

  it('refuses frames that are not whole samples, empty, or longer than a second', () => {
    expect(samplesFromFrame(Buffer.alloc(6))).toBeNull()
    expect(samplesFromFrame(Buffer.alloc(0))).toBeNull()
    expect(samplesFromFrame(Buffer.alloc(16000 * 4 + 4))).toBeNull()
  })
})
