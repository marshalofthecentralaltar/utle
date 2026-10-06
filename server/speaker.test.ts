import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ASR_FRAME_SAMPLES } from '../src/speech/asrProtocol.ts'
import { ENERGY_OTHER_RATIO, MIN_JUDGE_SECONDS, OTHER_THRESHOLD, OWNER_THRESHOLD, cosine, createSpeakerGate, normalised, verdict } from './speaker.ts'
import type { EmbeddingExtractor } from './speaker.ts'

/**
 * A voice is a number from 0 to 1 carried in a frame's first sample. The fake extractor turns it
 * into a unit vector at that angle, so the cosine between two voices is cos(θ1 − θ2): the same
 * voice scores 1, voices a quarter turn apart score 0.
 */
const fakeExtractor: EmbeddingExtractor = {
  embed(samples) {
    const voice = samples[0] ?? 0
    const angle = (voice * Math.PI) / 2
    return new Float32Array([Math.cos(angle), Math.sin(angle)])
  },
}

/** 100 ms frames of speech at loudness `level`, the first sample saying whose voice it is. */
const speech = (voice: number, seconds: number, level = 0.1): Float32Array[] => {
  const frames: Float32Array[] = []
  for (let i = 0; i < Math.round(seconds * 10); i += 1) {
    const frame = new Float32Array(ASR_FRAME_SAMPLES).fill(level)
    frame[0] = voice
    frames.push(frame)
  }
  return frames
}
const silence = (seconds: number): Float32Array[] => Array.from({ length: Math.round(seconds * 10) }, () => new Float32Array(ASR_FRAME_SAMPLES))

describe('the speaker gate', () => {
  let dir: string
  let profilePath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'utle-speaker-'))
    profilePath = join(dir, 'speaker', 'owner.json')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('judges nothing without a profile, and says so', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    expect(gate.hasProfile()).toBe(false)
    expect(gate.hasModel()).toBe(true)
    expect(gate.judge(speech(0, 3))).toBeNull()
  })

  it('learns the owner and knows him, a stranger, and a voice it cannot place', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    expect(gate.enrol(speech(0, 8))).toBe(true)
    expect(gate.hasProfile()).toBe(true)
    expect(gate.judge(speech(0, 3))).toEqual({ speaker: 'owner', score: 1 })
    // cos(45°) = 0.707: still the owner.
    expect(gate.judge(speech(0.5, 3))?.speaker).toBe('owner')
    // cos(72°) = 0.309: someone else.
    expect(gate.judge(speech(0.8, 3))?.speaker).toBe('other')
    // cos(58.5°) = 0.52: between the thresholds.
    expect(gate.judge(speech(0.65, 3))?.speaker).toBe('unknown')
  })

  it('never calls the owner a stranger over a profile from another model or of another size (review)', () => {
    const first = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'old.onnx' })
    expect(first.enrol(speech(0, 8))).toBe(true)
    // The same file read by a server with a newer model: the embedding is not comparable, loudness still is.
    const second = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'new.onnx' })
    expect(second.hasProfile()).toBe(true)
    expect(second.judge(speech(0.8, 3))?.speaker).toBe('unknown')
    expect(second.judge(speech(0, 3))?.speaker).toBe('unknown')
    expect(second.judge(speech(0, 3, 0.02))?.speaker).toBe('other')
    // An extractor of another size over a profile that names this model: no score, so unknown.
    const wide: EmbeddingExtractor = { embed: () => new Float32Array([1, 0, 0]) }
    const third = createSpeakerGate(wide, { profilePath, modelName: 'old.onnx' })
    expect(third.judge(speech(0.8, 3))).toEqual({ speaker: 'unknown', score: 0 })
  })

  it('calls an utterance shorter than MIN_JUDGE_SECONDS unknown, whatever it sounds like', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    gate.enrol(speech(0, 8))
    expect(gate.judge(speech(0.8, MIN_JUDGE_SECONDS - 0.1))).toEqual({ speaker: 'unknown', score: 0 })
    expect(gate.judge(speech(0.8, MIN_JUDGE_SECONDS))?.speaker).toBe('other')
  })

  it('refuses to learn from too little speech, and ignores the silence around it', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    expect(gate.enrol([...silence(5), ...speech(0, 1)])).toBe(false)
    expect(gate.hasProfile()).toBe(false)
    expect(gate.enrol([...silence(2), ...speech(0, 2), ...silence(2)])).toBe(true)
  })

  it('stores the profile as an embedding and a loudness, never audio, and loads it again', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'fake.onnx' })
    gate.enrol(speech(0, 8, 0.2))
    expect(existsSync(profilePath)).toBe(true)
    const stored = JSON.parse(readFileSync(profilePath, 'utf8')) as Record<string, unknown>
    expect(stored).toMatchObject({ version: 1, model: 'fake.onnx', embedding: [1, 0], seconds: 8 })
    expect(stored.rms).toBeCloseTo(0.2, 2)
    expect(JSON.stringify(stored).length).toBeLessThan(500)

    // The same model reads it back (another model's name would make the embedding incomparable: see below).
    const again = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'fake.onnx' })
    expect(again.hasProfile()).toBe(true)
    expect(again.judge(speech(0, 3))?.speaker).toBe('owner')
    expect(again.judge(speech(1, 3))?.speaker).toBe('other')
  })

  it('replaces an earlier profile at the next enrolment', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    gate.enrol(speech(0, 8))
    gate.enrol(speech(1, 8))
    expect(gate.judge(speech(1, 3))?.speaker).toBe('owner')
    expect(gate.judge(speech(0, 3))?.speaker).toBe('other')
  })

  it('ignores a broken profile file', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    gate.enrol(speech(0, 8))
    const broken = createSpeakerGate(fakeExtractor, { profilePath: join(dir, 'missing.json') })
    expect(broken.hasProfile()).toBe(false)
  })

  describe('without the model (the energy gate)', () => {
    it('still learns the owner, by loudness, and never says owner', () => {
      const gate = createSpeakerGate(null, { profilePath })
      expect(gate.hasModel()).toBe(false)
      expect(gate.enrol(speech(0, 8, 0.1))).toBe(true)
      const stored = JSON.parse(readFileSync(profilePath, 'utf8')) as Record<string, unknown>
      expect(stored.embedding).toEqual([])
      expect(stored.model).toBe('')
      expect(gate.judge(speech(0, 3, 0.1))).toEqual({ speaker: 'unknown', score: 0 })
      expect(gate.judge(speech(0, 3, 0.1 * ENERGY_OTHER_RATIO * 1.1))?.speaker).toBe('unknown')
      expect(gate.judge(speech(0, 3, 0.1 * ENERGY_OTHER_RATIO * 0.9))?.speaker).toBe('other')
    })

    it('uses the loudness of a profile made with the model when the model is gone', () => {
      createSpeakerGate(fakeExtractor, { profilePath }).enrol(speech(0, 8, 0.1))
      const gate = createSpeakerGate(null, { profilePath })
      expect(gate.hasProfile()).toBe(true)
      expect(gate.judge(speech(1, 3, 0.1))?.speaker).toBe('unknown')
      expect(gate.judge(speech(0, 3, 0.01))?.speaker).toBe('other')
    })
  })

  it('answers unknown when the extractor fails on an utterance', () => {
    let fail = false
    const flaky: EmbeddingExtractor = {
      embed(samples) {
        if (fail) throw new Error('no embedding')
        return fakeExtractor.embed(samples)
      },
    }
    const gate = createSpeakerGate(flaky, { profilePath })
    gate.enrol(speech(0, 8))
    fail = true
    expect(gate.judge(speech(0, 3))).toEqual({ speaker: 'unknown', score: 0 })
    expect(gate.enrol(speech(0, 8))).toBe(false)
  })
})

describe('the arithmetic', () => {
  it('normalises and compares', () => {
    expect(normalised([3, 4])).toEqual([0.6, 0.8])
    expect(normalised([0, 0])).toEqual([0, 0])
    expect(cosine([1, 0], [1, 0])).toBe(1)
    expect(cosine([1, 0], [0, 1])).toBe(0)
    // Vectors that cannot be compared give no score at all, never one that reads as a stranger (review).
    expect(cosine([1, 0], [1])).toBeNaN()
    expect(cosine([], [])).toBeNaN()
  })

  it('draws the lines at the thresholds', () => {
    expect(verdict(OWNER_THRESHOLD)).toBe('owner')
    expect(verdict(OWNER_THRESHOLD - 0.01)).toBe('unknown')
    expect(verdict(OTHER_THRESHOLD + 0.01)).toBe('unknown')
    expect(verdict(OTHER_THRESHOLD)).toBe('other')
  })
})
