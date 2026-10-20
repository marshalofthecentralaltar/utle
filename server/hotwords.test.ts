import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HOTWORDS_FILE, HOTWORDS_SCORE, HOTWORDS_VOCAB, hotwordsConfig, writeHotwords } from './hotwords.ts'

const roots: string[] = []
function root(withTokens = true): { root: string; modelDir: string } {
  const r = mkdtempSync(join(tmpdir(), 'utle-hotwords-'))
  roots.push(r)
  const modelDir = join(r, 'models', 'm')
  mkdirSync(modelDir, { recursive: true })
  if (withTokens) writeFileSync(join(modelDir, 'tokens.txt'), '<blk> 0\n<sos/eos> 1\n<unk> 2\n▁saada 3\n')
  return { root: r, modelDir }
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe('hotword files and config (28.1)', () => {
  it('writes the phrases and the vocabulary under models/', () => {
    const { root: r, modelDir } = root()
    writeHotwords(r, modelDir)
    expect(readFileSync(join(r, HOTWORDS_FILE), 'utf8').split('\n')).toContain('keri alla')
    expect(readFileSync(join(r, HOTWORDS_VOCAB), 'utf8')).toBe(`▁saada\t${(-Math.log(3)).toFixed(4)}\n`)
  })

  it('the config writes missing files, then passes the file, the score and the bpe encoder', () => {
    const { root: r, modelDir } = root()
    const config = hotwordsConfig(r, modelDir)
    expect(config).toEqual({
      model: { modelingUnit: 'bpe', bpeVocab: join(r, HOTWORDS_VOCAB) },
      recognizer: { hotwordsFile: join(r, HOTWORDS_FILE), hotwordsScore: HOTWORDS_SCORE },
    })
    expect(existsSync(join(r, HOTWORDS_FILE))).toBe(true)
  })

  it('an existing file is kept as it is', () => {
    const { root: r, modelDir } = root()
    writeHotwords(r, modelDir)
    writeFileSync(join(r, HOTWORDS_FILE), 'saada\n')
    hotwordsConfig(r, modelDir)
    expect(readFileSync(join(r, HOTWORDS_FILE), 'utf8')).toBe('saada\n')
  })

  it('score 0 is off: nothing passed, nothing written', () => {
    const { root: r, modelDir } = root()
    expect(hotwordsConfig(r, modelDir, 0)).toEqual({ model: {}, recognizer: {} })
    expect(existsSync(join(r, HOTWORDS_FILE))).toBe(false)
  })

  it('without tokens.txt the recogniser runs without hotwords', () => {
    const { root: r, modelDir } = root(false)
    expect(hotwordsConfig(r, modelDir)).toEqual({ model: {}, recognizer: {} })
  })
})
