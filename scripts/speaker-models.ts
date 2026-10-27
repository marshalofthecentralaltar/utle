/**
 * Round 10, lane MEASURE (issue #4): the speaker embedding models the calibration sweeps
 * (scripts/speaker-calibrate.ts --models), all from sherpa-onnx's release "speaker-recongition-models"
 * (sic), sizes as GitHub lists them on 2026-10-27. Run this file to download the missing ones into
 * models/speaker/ (adds files only; never touches owner.json or a model already there).
 *
 *   npx tsx scripts/speaker-models.ts
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models'

export interface SweepModel {
  /** Short name for tables and --models. */
  name: string
  file: string
  bytes: number
}

export const SWEEP_MODELS: readonly SweepModel[] = [
  { name: 'titanet-small', file: 'nemo_en_titanet_small.onnx', bytes: 40_257_283 },
  { name: 'campplus', file: 'wespeaker_en_voxceleb_CAM++.onnx', bytes: 29_292_684 },
  { name: 'eres2net', file: '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx', bytes: 26_485_263 },
  { name: 'resnet34', file: 'wespeaker_en_voxceleb_resnet34.onnx', bytes: 26_534_365 },
]

export const sweepUrl = (m: SweepModel): string => `${RELEASE}/${encodeURIComponent(m.file)}`

/** The models named in a --models value: "all", or a comma list of names or file names. */
export function sweepModels(list: string): SweepModel[] {
  if (list === 'all') return [...SWEEP_MODELS]
  return list.split(',').map((s) => {
    const found = SWEEP_MODELS.find((m) => m.name === s.trim() || m.file === s.trim())
    if (!found) throw new Error(`unknown speaker model "${s}"; known: ${SWEEP_MODELS.map((m) => m.name).join(', ')}`)
    return found
  })
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = join(fileURLToPath(new URL('..', import.meta.url)), 'models', 'speaker')
  mkdirSync(dir, { recursive: true })
  for (const m of SWEEP_MODELS) {
    const target = join(dir, m.file)
    if (existsSync(target) && statSync(target).size > 0) {
      console.log(`have ${m.file}`)
      continue
    }
    console.log(`fetching ${m.file} (${Math.round(m.bytes / 1e6)} MB) from ${sweepUrl(m)}`)
    const response = await fetch(sweepUrl(m))
    if (!response.ok || !response.body) throw new Error(`${m.file}: HTTP ${response.status}`)
    const partial = `${target}.part`
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
    const size = statSync(partial).size
    if (size !== m.bytes) throw new Error(`${m.file}: ${size} bytes, expected ${m.bytes}; left as ${partial}`)
    renameSync(partial, target)
    console.log(`saved ${m.file} (${size} bytes)`)
  }
}
