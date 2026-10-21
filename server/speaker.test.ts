import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ASR_FRAME_SAMPLES } from '../src/speech/asrProtocol.ts'
import { ENERGY_OTHER_RATIO, MIN_JUDGE_SECONDS, MIN_PHRASE_SECONDS, OWNER_THRESHOLD, cosine, createSpeakerGate, meanEmbedding, normalised, pickThreshold, verdict } from './speaker.ts'
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

  it('learns the owner and knows him and a stranger, with one threshold (strict mode: no band in between)', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    expect(gate.enrol(speech(0, 8))).toBe(true)
    expect(gate.hasProfile()).toBe(true)
    expect(gate.judge(speech(0, 3))).toEqual({ speaker: 'owner', score: 1 })
    // cos(45°) = 0.707: still the owner.
    expect(gate.judge(speech(0.5, 3))?.speaker).toBe('owner')
    // cos(72°) = 0.309: someone else.
    expect(gate.judge(speech(0.8, 3))?.speaker).toBe('other')
    // cos(58.5°) = 0.52: round 4 called this unknown and obeyed it; it is someone else now.
    expect(gate.judge(speech(0.65, 3))?.speaker).toBe('other')
  })

  it('never calls the owner a stranger over a profile from another model or of another size (review)', () => {
    const first = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'old.onnx' })
    expect(first.enrol(speech(0, 8))).toBe(true)
    // The same file read by a server with a newer model: the embedding is not comparable, loudness still is.
    const second = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'new.onnx' })
    expect(second.hasProfile()).toBe(true)
    // Round 7: no verdict (null), so strict mode obeys it; unknown would be dropped.
    expect(second.judge(speech(0.8, 3))).toBeNull()
    expect(second.judge(speech(0, 3))).toBeNull()
    expect(second.judge(speech(0, 3, 0.02))?.speaker).toBe('other')
    // An extractor of another size over a profile that names this model: no score, so unknown.
    const wide: EmbeddingExtractor = { embed: () => new Float32Array([1, 0, 0]) }
    const third = createSpeakerGate(wide, { profilePath, modelName: 'old.onnx' })
    expect(third.judge(speech(0.8, 3))).toEqual({ speaker: 'unknown', score: 0 })
  })

  it('judges the same frames it learnt from: his own recording, silences and all, scores 1 (round 7)', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    // A voice whose embedding changes when silence is in the clip, as CAM++ did.
    const recording = [...silence(1), ...speech(0.3, 3), ...silence(2)]
    expect(gate.enrol(recording)).toBe(true)
    expect(gate.judge(recording)).toEqual({ speaker: 'owner', score: 1 })
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
    it('still learns the owner, by loudness, never says owner, and gives no verdict (not unknown) for loud speech', () => {
      const gate = createSpeakerGate(null, { profilePath })
      expect(gate.hasModel()).toBe(false)
      expect(gate.enrol(speech(0, 8, 0.1))).toBe(true)
      const stored = JSON.parse(readFileSync(profilePath, 'utf8')) as Record<string, unknown>
      expect(stored.embedding).toEqual([])
      expect(stored.model).toBe('')
      expect(gate.judge(speech(0, 3, 0.1))).toBeNull()
      expect(gate.judge(speech(0, 3, 0.1 * ENERGY_OTHER_RATIO * 1.1))).toBeNull()
      expect(gate.judge(speech(0, 3, 0.1 * ENERGY_OTHER_RATIO * 0.9))?.speaker).toBe('other')
    })

    it('uses the loudness of a profile made with the model when the model is gone', () => {
      createSpeakerGate(fakeExtractor, { profilePath }).enrol(speech(0, 8, 0.1))
      const gate = createSpeakerGate(null, { profilePath })
      expect(gate.hasProfile()).toBe(true)
      expect(gate.judge(speech(1, 3, 0.1))).toBeNull()
      expect(gate.judge(speech(0, 3, 0.01))?.speaker).toBe('other')
    })
  })

  describe('scripted enrolment (round 7)', () => {
    it('makes the profile the mean of one embedding per phrase, at unit length, and counts the phrases', () => {
      const gate = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'fake.onnx' })
      const phrases = [gate.phrase(speech(0, 1.5)), gate.phrase(speech(1, 1.5))].filter((p) => p !== null)
      expect(phrases).toHaveLength(2)
      expect(gate.enrolPhrases(phrases)).toBe(true)
      const stored = JSON.parse(readFileSync(profilePath, 'utf8')) as { embedding: number[]; phrases: number; seconds: number; model: string }
      expect(stored.phrases).toBe(2)
      expect(stored.seconds).toBe(3)
      expect(stored.model).toBe('fake.onnx')
      expect(stored.embedding[0]).toBeCloseTo(Math.SQRT1_2, 6)
      expect(stored.embedding[1]).toBeCloseTo(Math.SQRT1_2, 6)
      // The voice halfway between the two read voices is the owner.
      expect(gate.judge(speech(0.5, 3))).toEqual({ speaker: 'owner', score: 1 })
    })

    it('keeps a profile from fewer than six phrases, and refuses one with too little speech', () => {
      const gate = createSpeakerGate(fakeExtractor, { profilePath })
      const one = gate.phrase(speech(0, 1))
      expect(one).not.toBeNull()
      expect(gate.enrolPhrases(one ? [one] : [])).toBe(false)
      const two = [gate.phrase(speech(0, 1.2)), gate.phrase(speech(0, 1.2))].filter((p) => p !== null)
      expect(gate.enrolPhrases(two)).toBe(true)
      expect(gate.hasProfile()).toBe(true)
      expect(gate.enrolPhrases([])).toBe(false)
    })

    it('does not count a phrase shorter than MIN_PHRASE_SECONDS, nor silence', () => {
      const gate = createSpeakerGate(fakeExtractor, { profilePath })
      expect(gate.phrase(speech(0, MIN_PHRASE_SECONDS - 0.1))).toBeNull()
      expect(gate.phrase(silence(2))).toBeNull()
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

  it('strict mode: draws one line, at OWNER_THRESHOLD, measured on the calibration set', () => {
    expect(verdict(OWNER_THRESHOLD)).toBe('owner')
    expect(verdict(OWNER_THRESHOLD - 0.001)).toBe('other')
    expect(verdict(1)).toBe('owner')
    expect(verdict(0)).toBe('other')
    // scripts/fixtures/speaker-set/scores.json: the closest other voice 0.499, the stand-in owner's next score 0.577.
    expect(OWNER_THRESHOLD).toBeGreaterThan(0.499)
    expect(OWNER_THRESHOLD).toBeLessThanOrEqual(0.577)
  })

  it('averages unit embeddings to unit length', () => {
    expect(meanEmbedding([])).toEqual([])
    const mean = meanEmbedding([[1, 0], [0, 1]])
    expect(mean[0]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(mean[1]).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('picks the threshold with the fewest errors, ties toward dropping others, in the middle of the gap', () => {
    // A clean gap: the middle of it.
    expect(pickThreshold([0.7, 0.8, 0.9], [0.1, 0.3, 0.5])).toEqual({ threshold: 0.6, ownerDropped: 0, otherPassed: 0 })
    // An overlap of one: one error either way; the one that drops the owner clip wins (others never pass).
    const tie = pickThreshold([0.4, 0.8], [0.5, 0.2])
    expect(tie.ownerDropped + tie.otherPassed).toBe(1)
    expect(tie.otherPassed).toBe(0)
    expect(tie.threshold).toBeGreaterThan(0.5)
    expect(tie.threshold).toBeLessThanOrEqual(0.8)
  })
})
