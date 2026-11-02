import { describe, expect, it } from 'vitest'
import { keyLine, keySource } from './keySource.ts'

// Round 10 (#8): which Anthropic key the server loaded, and from where. Never the key itself.
const USER_KEY = `sk-ant-usr01-${'u'.repeat(90)}`
const API_KEY = `sk-ant-api03-${'a'.repeat(90)}`

describe('which Anthropic key the server loaded (#8)', () => {
  it('a key that .env.local set is reported as from .env.local, by its prefix only', () => {
    const report = keySource(USER_KEY, `ANTHROPIC_API_KEY=${USER_KEY}\n`)
    expect(report).toEqual({ prefix: 'sk-ant-usr', source: '.env.local', shadowed: null })
    expect(keyLine(report)).toBe('[key] ANTHROPIC_API_KEY sk-ant-usr... from .env.local')
  })

  it('a key in the environment with no key in .env.local is from the environment', () => {
    expect(keySource(API_KEY, 'UTLE_MODEL=anthropic:claude-sonnet-5-5\n')).toEqual({ prefix: 'sk-ant-api', source: 'environment', shadowed: null })
    expect(keySource(API_KEY, null)).toEqual({ prefix: 'sk-ant-api', source: 'environment', shadowed: null })
  })

  it('a Windows user variable outranks .env.local (Node never overrides the environment): both prefixes named, the file one as not applied', () => {
    const report = keySource(API_KEY, `# local\nexport ANTHROPIC_API_KEY="${USER_KEY}"\n`)
    expect(report).toEqual({ prefix: 'sk-ant-api', source: 'environment', shadowed: 'sk-ant-usr' })
    expect(keyLine(report)).toBe(
      '[key] ANTHROPIC_API_KEY sk-ant-api... from the environment; .env.local has another key (sk-ant-usr...) that Node does not apply over the environment: remove the environment variable to use it',
    )
  })

  it('no key at all says so', () => {
    expect(keySource(undefined, null)).toEqual({ prefix: null, source: 'none', shadowed: null })
    expect(keySource('', `ANTHROPIC_API_KEY=${USER_KEY}`).source).toBe('none')
    expect(keyLine(keySource(undefined, null))).toBe('[key] ANTHROPIC_API_KEY not set (rules only)')
  })

  it('never prints more than a short prefix, and less of a short key', () => {
    const line = keyLine(keySource(USER_KEY, null))
    expect(line).not.toContain(USER_KEY.slice(0, 11))
    expect(keySource('k', null).prefix).toBe('')
    expect(keySource('sk-ant-test-secret', null).prefix).toBe('sk-a')
  })

  it('reads quoted, single-quoted and spaced lines, and ignores comments and other names', () => {
    expect(keySource(USER_KEY, `ANTHROPIC_API_KEY = '${USER_KEY}'`).source).toBe('.env.local')
    expect(keySource(USER_KEY, `# ANTHROPIC_API_KEY=${API_KEY}\nANTHROPIC_API_KEY=${USER_KEY}\r\n`).source).toBe('.env.local')
    expect(keySource(USER_KEY, `NOT_ANTHROPIC_API_KEY=${API_KEY}`)).toEqual({ prefix: 'sk-ant-usr', source: 'environment', shadowed: null })
  })
})
