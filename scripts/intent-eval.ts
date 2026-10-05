/**
 * Live check of POST /api/intent's brain: Estonian utterances against fake pages, through the real
 * model and the real pageIntent. Prints pass or fail and the latency per case. Spends a few cents.
 *
 *   npx tsx scripts/intent-eval.ts          (needs ANTHROPIC_API_KEY; UTLE_MODEL overrides the model)
 */
import Anthropic from '@anthropic-ai/sdk'
import type { IntentRequest, PageIntent } from '../src/core/pageIntent.ts'
import type { PageContext } from '../src/browser/protocol.ts'
import { pageIntent } from '../server/intent.ts'
import type { MessagesClient } from '../server/interpret.ts'

const MODEL = process.env.UTLE_MODEL ?? 'claude-opus-5-5'

const YOUTUBE_WATCH: PageContext = {
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Kassipojad mängivad lumes - YouTube',
  box: { present: true, text: '', armed: false, kind: 'search', label: 'Otsi' },
  items: [
    { id: 0, role: 'field', text: 'Otsi' },
    { id: 1, role: 'button', text: 'Meeldib' },
    { id: 2, role: 'button', text: 'Ei meeldi' },
    { id: 3, role: 'button', text: 'Jaga' },
    { id: 4, role: 'button', text: 'Vaata hiljem' },
    { id: 5, role: 'button', text: 'Telli' },
    { id: 6, role: 'field', text: 'Lisa kommentaar...' },
    { id: 7, role: 'link', text: 'Koerad jooksevad rannas' },
    { id: 8, role: 'link', text: 'Kuidas küpsetada leiba' },
    { id: 9, role: 'link', text: 'ERR uudised 5. oktoober' },
  ],
  media: { playing: true, muted: false, volume: 0.7, fullscreen: false },
  hints: false,
}

const YOUTUBE_HOME: PageContext = {
  url: 'https://www.youtube.com/',
  title: 'YouTube',
  box: { present: true, text: '', armed: false, kind: 'search', label: 'Otsi' },
  items: [
    { id: 0, role: 'field', text: 'Otsi' },
    { id: 1, role: 'link', text: 'Kassipojad mängivad lumes' },
    { id: 2, role: 'link', text: 'Koerad jooksevad rannas' },
    { id: 3, role: 'link', text: 'Kuidas küpsetada leiba' },
    { id: 4, role: 'button', text: 'Tellimused' },
  ],
  media: null,
  hints: false,
}

const WHATSAPP: PageContext = {
  url: 'https://web.whatsapp.com/',
  title: 'WhatsApp',
  box: { present: true, text: '', armed: false, kind: 'search', label: 'Otsi või alusta uut vestlust' },
  items: [
    { id: 0, role: 'field', text: 'Otsi või alusta uut vestlust' },
    { id: 1, role: 'row', text: 'Mari · Tulen homme' },
    { id: 2, role: 'row', text: 'Jaan · Ok' },
    { id: 3, role: 'row', text: 'Peeter · Helista mulle' },
    { id: 4, role: 'button', text: 'Uus vestlus' },
  ],
  media: null,
  hints: false,
}

const WHATSAPP_CHAT: PageContext = {
  ...WHATSAPP,
  title: 'WhatsApp - Mari',
  box: { present: true, text: 'Tere Mari', armed: true, kind: 'composer', label: 'Kirjuta sõnum' },
  items: [...WHATSAPP.items, { id: 5, role: 'field', text: 'Kirjuta sõnum' }, { id: 6, role: 'button', text: 'Saada' }],
}

const GOOGLE: PageContext = {
  url: 'https://www.google.com/search?q=ilm+tallinnas',
  title: 'ilm tallinnas - Google otsing',
  box: { present: true, text: 'ilm tallinnas', armed: false, kind: 'search', label: 'Otsing' },
  items: [
    { id: 0, role: 'field', text: 'Otsing' },
    { id: 1, role: 'link', text: 'Ilmateenistus: Tallinna ilmaprognoos' },
    { id: 2, role: 'link', text: 'Yr.no: Tallinn' },
    { id: 3, role: 'link', text: 'Postimees: Nädalavahetusel tuleb vihma' },
  ],
  media: null,
  hints: false,
}

const NEW_TAB: PageContext = {
  url: 'chrome://newtab/',
  title: 'Uus vaheleht',
  box: { present: false, text: '', armed: false, kind: 'none' },
  items: [
    { id: 0, role: 'link', text: 'WhatsApp' },
    { id: 1, role: 'link', text: 'YouTube' },
    { id: 2, role: 'link', text: 'Google' },
  ],
  media: null,
  hints: false,
}

interface Expectation {
  kind: PageIntent['kind']
  /** For command: the command kind. */
  command?: string
  /** For clickItem and focusItem: the id. */
  id?: number
  /** For goTo: a substring of the address. */
  url?: string
  /** For openConversation: the name. */
  name?: string
}

interface Case {
  utterance: string
  page: PageContext
  expect: Expectation
  recent?: string[]
}

const CASES: Case[] = [
  { utterance: 'mine vaata hiljem', page: YOUTUBE_WATCH, expect: { kind: 'command', command: 'clickItem', id: 4 } },
  { utterance: 'vaata hiljem', page: YOUTUBE_WATCH, expect: { kind: 'command', command: 'clickItem', id: 4 } },
  { utterance: 'pane meeldib', page: YOUTUBE_WATCH, expect: { kind: 'command', command: 'clickItem', id: 1 } },
  { utterance: 'kirjuta kommentaar', page: YOUTUBE_WATCH, expect: { kind: 'command', command: 'focusItem', id: 6 } },
  { utterance: 'pane heli vaiksemaks', page: YOUTUBE_WATCH, expect: { kind: 'command', command: 'media' } },
  { utterance: 'pane paus', page: YOUTUBE_WATCH, expect: { kind: 'command', command: 'media' } },
  { utterance: 'täisekraan', page: YOUTUBE_WATCH, expect: { kind: 'command', command: 'media' } },
  { utterance: 'ava koerte video', page: YOUTUBE_WATCH, expect: { kind: 'command', command: 'clickItem', id: 7 } },
  { utterance: 'otsi kassivideod', page: YOUTUBE_WATCH, expect: { kind: 'command', command: 'siteSearch' } },
  { utterance: 'tulen homme kell viis', page: YOUTUBE_WATCH, expect: { kind: 'unclear' } },
  { utterance: 'ava esimene video', page: YOUTUBE_HOME, expect: { kind: 'command', command: 'clickItem', id: 1 } },
  { utterance: 'vajuta videole leivast', page: YOUTUBE_HOME, expect: { kind: 'command', command: 'clickItem', id: 3 } },
  { utterance: 'kirjuta marile', page: WHATSAPP, expect: { kind: 'command', command: 'openConversation', name: 'Mari' } },
  { utterance: 'ava jaan', page: WHATSAPP, expect: { kind: 'command', command: 'openConversation', name: 'Jaan' } },
  { utterance: 'peeter', page: WHATSAPP, expect: { kind: 'command', command: 'openConversation', name: 'Peeter' } },
  { utterance: 'tere kuidas läheb', page: WHATSAPP, expect: { kind: 'unclear' } },
  { utterance: 'tulen homme kell viis', page: WHATSAPP_CHAT, expect: { kind: 'dictate' } },
  { utterance: 'jah sobib', page: WHATSAPP_CHAT, expect: { kind: 'dictate' } },
  { utterance: 'tagasi', page: WHATSAPP_CHAT, expect: { kind: 'edit' } },
  { utterance: 'saada ära', page: WHATSAPP_CHAT, expect: { kind: 'send' } },
  { utterance: 'mine vatsapi', page: GOOGLE, expect: { kind: 'command', command: 'goTo', url: 'whatsapp' } },
  { utterance: 'ava ilmateenistus', page: GOOGLE, expect: { kind: 'command', command: 'clickItem', id: 1 } },
  { utterance: 'tagasi', page: GOOGLE, expect: { kind: 'command', command: 'history' } },
  { utterance: 'ava uus leht', page: GOOGLE, expect: { kind: 'command', command: 'newTab' } },
  { utterance: 'whatsapp', page: NEW_TAB, expect: { kind: 'command', command: 'goTo', url: 'whatsapp' } },
  { utterance: 'mina youtube', page: NEW_TAB, expect: { kind: 'command', command: 'goTo', url: 'youtube' } },
  { utterance: 'puhka', page: NEW_TAB, expect: { kind: 'sleep' } },
  { utterance: 'kirjuta midagi', page: NEW_TAB, expect: { kind: 'unclear' } },
]

function matches(intent: PageIntent, expected: Expectation): string | null {
  if (intent.kind !== expected.kind) return `kind ${intent.kind}`
  if (intent.kind !== 'command') return null
  const c = intent.command
  if (expected.command && c.kind !== expected.command) return `command ${c.kind}`
  if (expected.id !== undefined && 'id' in c && c.id !== expected.id) return `id ${c.id}`
  if (expected.url && c.kind === 'goTo' && !c.url.toLowerCase().includes(expected.url)) return `url ${c.url}`
  if (expected.name && c.kind === 'openConversation' && c.name.toLowerCase() !== expected.name.toLowerCase()) {
    return `name ${c.name}`
  }
  return null
}

function describe(intent: PageIntent): string {
  switch (intent.kind) {
    case 'command':
      return `command ${JSON.stringify(intent.command)}`
    case 'dictate':
      return `dictate ${JSON.stringify(intent.text)}`
    case 'edit':
      return `edit ${intent.edit.kind}`
    case 'unclear':
      return `unclear ${JSON.stringify(intent.say)}`
    default:
      return intent.kind
  }
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('intent-eval: ANTHROPIC_API_KEY is not set')
    process.exit(2)
  }
  const anthropic = new Anthropic({ maxRetries: 0 })
  const client: MessagesClient = { messages: { create: (params, options) => anthropic.messages.create(params, options) } }
  console.log(`model ${MODEL}, ${CASES.length} cases`)

  let passed = 0
  let totalMs = 0
  for (const c of CASES) {
    const request: IntentRequest = {
      lang: 'et',
      utterance: c.utterance,
      page: c.page,
      tabs: [{ index: 1, title: c.page.title, active: true }],
      recent: c.recent ?? [],
    }
    const started = Date.now()
    let line: string
    let ok = false
    try {
      const answer = await pageIntent(request, { client, model: MODEL })
      const problem = matches(answer.intent, c.expect)
      ok = problem === null
      line = `${describe(answer.intent)} say=${JSON.stringify(answer.say)}${problem ? ` (wanted ${JSON.stringify(c.expect)}, got ${problem})` : ''}`
    } catch (error) {
      line = `error ${error instanceof Error ? error.message : String(error)}`
    }
    const ms = Date.now() - started
    totalMs += ms
    if (ok) passed += 1
    const site = new URL(c.page.url).hostname || c.page.url
    console.log(`${ok ? 'PASS' : 'FAIL'} ${String(ms).padStart(5)} ms  ${site.padEnd(18)} "${c.utterance}" -> ${line}`)
  }
  console.log(`\n${passed}/${CASES.length} passed, mean ${Math.round(totalMs / CASES.length)} ms`)
  process.exit(passed === CASES.length ? 0 : 1)
}

void main()
