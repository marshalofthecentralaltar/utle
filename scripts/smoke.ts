/**
 * Live check: runs the mock-up's script through the real model and the real state machine.
 * Spends a few cents. Exits non-zero when the conversation does not end where the mock-up does.
 *
 *   npm run smoke
 */
import Anthropic from '@anthropic-ai/sdk'
import { SAMPLE_DOC } from '../src/core/document.ts'
import type { Intent } from '../src/core/intent.ts'
import { initialSession, step } from '../src/core/session.ts'
import type { Session } from '../src/core/session.ts'
import { InterpretError, interpret } from '../server/interpret.ts'
import type { MessagesClient } from '../server/interpret.ts'

const MODEL = process.env.UTLE_MODEL ?? 'claude-haiku-4-5'
const MAX_MODEL_CALLS = 14

const LINES = [
  'Change the budget deadline to Friday.',
  'Yes.',
  'Move risks above next steps.',
  'Yes.',
  'Shorten the sentence about the supplier.',
  'Two.',
  'Yes.',
  // "Martin" is what a recogniser would hear; the attendee list says Marten.
  'Add a next step: Martin sends the contract by Wednesday.',
  'Not Wednesday. Tuesday.',
  'Yes.',
  'Mine kokkuvõtte juurde ja loe see ette.',
  'Stop listening.',
]

const LONG_SENTENCE = 'The supplier reported two invoice errors in the first week, which were corrected the same day.'

let modelCalls = 0
const anthropic = new Anthropic({ maxRetries: 1 })
const client: MessagesClient = {
  messages: {
    create: (params, options) => {
      modelCalls += 1
      if (modelCalls > MAX_MODEL_CALLS) throw new Error(`smoke: more than ${MAX_MODEL_CALLS} model calls, stopping`)
      return anthropic.messages.create(params, options)
    },
  },
}

function describe(intent: Intent): string {
  switch (intent.kind) {
    case 'propose_edit':
      return `propose_edit [${intent.ops.map((o) => o.op).join(', ')}] "${intent.summary}"`
    case 'ask_which':
      return `ask_which (${intent.candidates.length}) "${intent.question}"`
    case 'navigate':
      return `navigate ${intent.blockId} readAloud=${intent.readAloud}`
    case 'not_understood':
      return `not_understood "${intent.message}"`
  }
}

async function main(): Promise<void> {
  const failures: string[] = []
  let session: Session = initialSession(SAMPLE_DOC)
  let focusAfterNavigate: string | null = null

  for (const [index, line] of LINES.entries()) {
    const said = step(session, { type: 'utterance', text: line, source: 'voice' })
    session = said.state
    const effect = said.effects[0]
    let outcome = '(local)'

    if (effect) {
      const started = Date.now()
      try {
        const intent = await interpret(effect.request, { client, model: MODEL })
        outcome = `${describe(intent)} ${Date.now() - started} ms`
        if (intent.kind === 'not_understood') failures.push(`line ${index + 1}: not understood`)
        session = step(session, { type: 'intent', seq: effect.seq, intent }).state
      } catch (error) {
        const message = error instanceof InterpretError ? `${error.code}: ${error.message}` : String(error)
        outcome = `FAILED ${message}`
        failures.push(`line ${index + 1}: ${message}`)
        session = step(session, { type: 'interpretFailed', seq: effect.seq, message }).state
      }
    }
    if (index === 10) focusAfterNavigate = session.focusId
    console.log(`${String(index + 1).padStart(2)}. "${line}"\n    ${outcome}\n    mode=${session.mode} understood="${session.understood}"`)
  }

  const doc = session.doc
  const text = (id: string): string => doc.find((b) => b.id === id)?.text ?? ''
  const position = (id: string): number => doc.findIndex((b) => b.id === id)
  const marten = doc.find((b) => b.text.includes('Marten') && b.text.includes('Tuesday'))

  if (!text('b6').includes('Friday') || text('b6').includes('Thursday')) failures.push('budget block does not say Friday')
  if (!(position('b9') >= 0 && position('b9') < position('b7'))) failures.push('Risks is not above Next steps')
  if (position('b10') !== position('b9') + 1) failures.push('the Risks paragraph did not move with its heading')
  if (text('b4').includes(LONG_SENTENCE)) failures.push('the long summary sentence is still there')
  if (!marten) failures.push('no block mentions Marten and Tuesday')
  if (marten?.text.includes('Wednesday')) failures.push('the Marten item still says Wednesday')
  if (doc.some((b) => b.text.includes('Martin'))) failures.push('the misheard name Martin reached the document')
  if (focusAfterNavigate !== 'b3' && focusAfterNavigate !== 'b4') failures.push(`navigation focused ${focusAfterNavigate}, not the summary`)
  if (session.history.length !== 4) failures.push(`expected 4 finished edits, got ${session.history.length}`)
  if (session.mode !== 'asleep') failures.push(`expected to end asleep, ended ${session.mode}`)

  console.log('\nFinal document:')
  doc.forEach((b, i) => console.log(`  #${i + 1} ${b.type}: ${b.text}`))
  console.log(`\nmodel=${MODEL} modelCalls=${modelCalls} words=${session.words} edits=${session.history.length} hands=${session.hands}`)

  if (failures.length > 0) {
    console.log(`\nSMOKE FAILED\n- ${failures.join('\n- ')}`)
    process.exitCode = 1
  } else {
    console.log('\nSMOKE PASSED')
  }
}

await main()
