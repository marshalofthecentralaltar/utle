import { describe, expect, it } from 'vitest'
import type { BrowserCommand } from '../browser/protocol.ts'
import { sampleDoc } from '../core/document.ts'
import type { Intent } from '../core/intent.ts'
import { initialSession, step } from '../core/session.ts'
import type { Session } from '../core/session.ts'
import { CHECK_LINES, DEMO_SCRIPT } from './lines.ts'

/** What the interpreter answers for the two demo lines that need it (the same as rehearsal mode). */
function interpreter(utterance: string, s: Session): Intent {
  if (utterance.includes('reedeks')) {
    return {
      kind: 'propose_edit',
      summary: 'Eelarve: neljapäeva asemel reede.',
      ops: [{ op: 'replace_text', blockId: 'b6', find: 'neljapäevaks', replace: 'reedeks' }],
    }
  }
  const op = s.pending?.ops[0]
  if (op?.op === 'insert_block') return { kind: 'propose_edit', summary: 'Kolme asemel neli.', ops: [{ ...op, text: op.text.replace('kolm', 'neli') }] }
  return { kind: 'not_understood', message: 'Ei saanud aru.' }
}

describe('the Estonian demo script', () => {
  it('plays hands-off to the end: an edit, the browser, and a message written, repaired and sent', () => {
    let s = initialSession(sampleDoc('et'), 'et')
    const sent: BrowserCommand[] = []
    const settle = (effects: ReturnType<typeof step>['effects']): void => {
      for (const effect of effects) {
        if (effect.type === 'interpret') {
          const next = step(s, { type: 'intent', seq: effect.seq, intent: interpreter(effect.request.utterance, s) })
          s = next.state
          settle(next.effects)
        } else if (effect.type === 'browser') {
          sent.push(effect.command)
          const next = step(s, { type: 'browserResult', seq: effect.seq, command: effect.command, result: { ok: true } })
          s = next.state
          settle(next.effects)
        }
      }
    }
    for (const line of DEMO_SCRIPT) {
      const said = step(s, { type: 'utterance', text: line.text, source: 'voice' })
      s = said.state
      settle(said.effects)
    }
    expect(sent).toEqual([
      { kind: 'newTab' },
      { kind: 'goTo', url: 'https://www.messenger.com/' },
      { kind: 'openConversation', name: 'Mari' },
      { kind: 'insertText', text: 'Ma jõuan homme kell neli.', submit: true },
    ])
    expect(s.doc.find((b) => b.id === 'b6')?.text).toContain('reedeks')
    expect(s.draft).toBeNull()
    expect(s.mode).toBe('asleep')
    expect(s.hands).toBe(0)
  })

  it('has Estonian voice-check lines that fit the Estonian sample document', () => {
    const lines = CHECK_LINES['et-EE'] ?? []
    expect(lines.length).toBeGreaterThan(5)
    const text = sampleDoc('et').map((b) => b.text.toLowerCase()).join(' ')
    for (const word of ['eelarve', 'riskid', 'tarnija', 'marten', 'järgmised sammud']) expect(text).toContain(word)
  })
})
