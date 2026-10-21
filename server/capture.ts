/**
 * UTLE_CAPTURE (round 7, SPEECH lane): for calibration on your own machine only. With the variable
 * set to a folder, the server writes each final's speech frames there as
 * `<timestamp>-<speaker>-<score>.wav` and appends `<file>\t<score>\t<speaker>\t<heard text>` to
 * `log.tsv`, so `scripts/speaker-calibrate.ts` can re-pick the speaker threshold on real voices. The
 * folder holds your voice and your words; delete it after. Without the variable nothing is written
 * and no text goes anywhere; the console never gets the text either way.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ASR_SAMPLE_RATE } from '../src/speech/asrProtocol.ts'
import type { Judgement } from './speaker.ts'

export const CAPTURE_ENV = 'UTLE_CAPTURE'
export const CAPTURE_LOG = 'log.tsv'

export interface Capture {
  /** One final: its frames (the speech the gate judged), its verdict (null without a profile) and its words. */
  write(frames: Float32Array[], judgement: Judgement | null, text: string): void
}

/** Mono 16-bit PCM wav bytes. */
export function wavBytes(samples: Float32Array, rate = ASR_SAMPLE_RATE): Buffer {
  const pcm = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i += 1) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((samples[i] ?? 0) * 32767))), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

const stamp = (date: Date): string => date.toISOString().replace(/[-:]/g, '').replace('.', '').replace('Z', '')

/** Writes into dir (made when missing). A failed write is skipped: capture never stops speech. */
export function createCapture(dir: string, now: () => Date = () => new Date()): Capture {
  return {
    write(frames, judgement, text) {
      try {
        mkdirSync(dir, { recursive: true })
        let n = 0
        for (const frame of frames) n += frame.length
        const all = new Float32Array(n)
        let at = 0
        for (const frame of frames) {
          all.set(frame, at)
          at += frame.length
        }
        const speaker = judgement?.speaker ?? 'none'
        const score = (judgement?.score ?? 0).toFixed(3)
        const base = `${stamp(now())}-${speaker}-${score}`
        let file = `${base}.wav`
        for (let i = 2; existsSync(join(dir, file)); i += 1) file = `${base}-${i}.wav`
        writeFileSync(join(dir, file), wavBytes(all))
        appendFileSync(join(dir, CAPTURE_LOG), `${file}\t${score}\t${speaker}\t${text.replace(/\s+/g, ' ').trim()}\n`)
      } catch {
        // Calibration only: a full disk or a locked folder loses the clip, never the final.
      }
    },
  }
}

/** The capture the environment asks for, or null when UTLE_CAPTURE is unset or empty. */
export function captureFromEnv(env: NodeJS.ProcessEnv = process.env): Capture | null {
  const dir = env[CAPTURE_ENV]
  return dir === undefined || dir.trim() === '' ? null : createCapture(dir.trim())
}
