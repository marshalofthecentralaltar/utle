/**
 * Live check of POST /api/intent's brain: Estonian (and a few English) utterances against fake
 * pages, through the real model and the real pageIntent. Multi-step cases simulate the engine's
 * loop (M7.2): each step has its own page, the earlier steps go back as `steps`, and a step can be
 * reported as failed to test recovery. Prints pass or fail with the latency per ask, then p50/p95
 * latency and the pass rate. Spends a few cents.
 *
 *   npx tsx scripts/intent-eval.ts
 *     ANTHROPIC_API_KEY        required
 *     UTLE_MODEL=<id>          the model (default claude-opus-5-5)
 *     UTLE_EVAL_ONLY=<text>    only cases whose name, utterance or site contains the text
 *     UTLE_EVAL_JSON=<path>    also write every ask's result to this JSON file
 */
import Anthropic from '@anthropic-ai/sdk'
import { writeFileSync } from 'node:fs'
import type { IntentAnswer, IntentRequest, IntentStep, PageIntent, TabSummary } from '../src/core/pageIntent.ts'
import type { Lang } from '../src/core/strings.ts'
import type { PageContext } from '../src/browser/protocol.ts'
import { pageIntent } from '../server/intent.ts'
import type { MessagesClient } from '../server/interpret.ts'

const MODEL = process.env.UTLE_MODEL ?? 'claude-opus-5-5'
const ONLY = (process.env.UTLE_EVAL_ONLY ?? '').toLowerCase()
const JSON_PATH = process.env.UTLE_EVAL_JSON

// ---------------------------------------------------------------------------------------------
// Pages. Item ids and roles follow what readPage emits: link, button, field, tab, option, row,
// video, other; ids are 1-based in reading order.
// ---------------------------------------------------------------------------------------------

const NO_BOX = { present: false, text: '', armed: false, kind: 'none' } as const
const YT_SEARCH = { present: true, text: '', armed: false, kind: 'search', label: 'Otsi' } as const

const YOUTUBE_WATCH: PageContext = {
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Kassipojad mängivad lumes - YouTube',
  box: YT_SEARCH,
  items: [
    { id: 1, role: 'field', text: 'Otsi' },
    { id: 2, role: 'button', text: 'Jäta reklaam vahele' },
    { id: 3, role: 'button', text: 'Meeldib' },
    { id: 4, role: 'button', text: 'Ei meeldi' },
    { id: 5, role: 'button', text: 'Jaga' },
    { id: 6, role: 'button', text: 'Vaata hiljem' },
    { id: 7, role: 'button', text: 'Telli' },
    { id: 8, role: 'field', text: 'Lisa kommentaar...' },
    { id: 9, role: 'link', text: 'Koerad jooksevad rannas' },
    { id: 10, role: 'link', text: 'Kuidas küpsetada leiba' },
    { id: 11, role: 'link', text: 'ERR uudised 5. oktoober' },
  ],
  media: { playing: true, muted: false, volume: 0.7, fullscreen: false },
  hints: false,
}

const YOUTUBE_HOME: PageContext = {
  url: 'https://www.youtube.com/',
  title: 'YouTube',
  box: YT_SEARCH,
  items: [
    { id: 1, role: 'field', text: 'Otsi' },
    { id: 2, role: 'button', text: 'Tellimused' },
    { id: 3, role: 'video', text: 'Kassipojad mängivad lumes' },
    { id: 4, role: 'video', text: 'Koerad jooksevad rannas' },
    { id: 5, role: 'video', text: 'Kuidas küpsetada leiba' },
    { id: 6, role: 'video', text: 'Tallinna maratoni kokkuvõte' },
  ],
  media: null,
  hints: false,
}

/** The home page without a cat video anywhere, for the scroll-then-search path. */
const YOUTUBE_HOME_NO_CATS: PageContext = {
  ...YOUTUBE_HOME,
  items: YOUTUBE_HOME.items.filter((item) => item.id !== 3),
}

const YOUTUBE_RESULTS: PageContext = {
  url: 'https://www.youtube.com/results?search_query=kassivideod',
  title: 'kassivideod - YouTube',
  box: { ...YT_SEARCH, text: 'kassivideod' },
  items: [
    { id: 1, role: 'field', text: 'Otsi' },
    { id: 2, role: 'button', text: 'Filtrid' },
    { id: 3, role: 'video', text: 'Naljakad kassid 2026' },
    { id: 4, role: 'video', text: 'Kassipoeg õpib hüppama' },
    { id: 5, role: 'video', text: 'Kass vs kurk' },
  ],
  media: null,
  hints: false,
}

const WHATSAPP: PageContext = {
  url: 'https://web.whatsapp.com/',
  title: 'WhatsApp',
  box: { present: true, text: '', armed: false, kind: 'search', label: 'Otsi või alusta uut vestlust' },
  items: [
    { id: 1, role: 'field', text: 'Otsi või alusta uut vestlust' },
    { id: 2, role: 'button', text: 'Uus vestlus' },
    { id: 3, role: 'row', text: 'Mari · Tulen homme' },
    { id: 4, role: 'row', text: 'Jaan · Ok' },
    { id: 5, role: 'row', text: 'Peeter · Helista mulle' },
    { id: 6, role: 'row', text: 'Mart · Kas tuled?' },
    { id: 7, role: 'row', text: 'Kadri · Aitäh!' },
  ],
  media: null,
  hints: false,
}

const WHATSAPP_CHAT: PageContext = {
  ...WHATSAPP,
  title: 'WhatsApp - Mari',
  box: { present: true, text: 'Tere Mari', armed: true, kind: 'composer', label: 'Kirjuta sõnum' },
  items: [...WHATSAPP.items, { id: 8, role: 'field', text: 'Kirjuta sõnum' }, { id: 9, role: 'button', text: 'Saada' }],
}

const WHATSAPP_CHAT_EMPTY: PageContext = {
  ...WHATSAPP_CHAT,
  box: { ...WHATSAPP_CHAT.box, text: '' },
}

const GOOGLE: PageContext = {
  url: 'https://www.google.com/search?q=ilm+tallinnas',
  title: 'ilm tallinnas - Google otsing',
  box: { present: true, text: 'ilm tallinnas', armed: false, kind: 'search', label: 'Otsing' },
  items: [
    { id: 1, role: 'field', text: 'Otsing' },
    { id: 2, role: 'link', text: 'Ilmateenistus: Tallinna ilmaprognoos' },
    { id: 3, role: 'link', text: 'Yr.no: Tallinn' },
    { id: 4, role: 'link', text: 'Postimees: Nädalavahetusel tuleb vihma' },
  ],
  media: null,
  hints: false,
}

const NEW_TAB: PageContext = {
  url: 'chrome://newtab/',
  title: 'Uus vaheleht',
  box: NO_BOX,
  items: [
    { id: 1, role: 'link', text: 'WhatsApp' },
    { id: 2, role: 'link', text: 'YouTube' },
    { id: 3, role: 'link', text: 'Google' },
  ],
  media: null,
  hints: false,
}

const GMAIL_INBOX: PageContext = {
  url: 'https://mail.google.com/mail/u/0/#inbox',
  title: 'Postkast (3) - Gmail',
  box: { present: true, text: '', armed: false, kind: 'search', label: 'Otsi kirju' },
  items: [
    { id: 1, role: 'field', text: 'Otsi kirju' },
    { id: 2, role: 'button', text: 'Koosta' },
    { id: 3, role: 'link', text: 'Postkast' },
    { id: 4, role: 'link', text: 'Saadetud' },
    { id: 5, role: 'row', text: 'Jaan Tamm · Koosolek homme kell 10' },
    { id: 6, role: 'row', text: 'Selver · Nädala pakkumised' },
    { id: 7, role: 'row', text: 'Mari Mets · Pildid reisilt' },
  ],
  media: null,
  hints: false,
}

const GMAIL_COMPOSE: PageContext = {
  url: 'https://mail.google.com/mail/u/0/#inbox?compose=new',
  title: 'Uus kiri - Gmail',
  box: { present: true, text: '', armed: true, kind: 'composer', label: 'Kirja sisu' },
  items: [
    { id: 1, role: 'field', text: 'Saajad' },
    { id: 2, role: 'field', text: 'Teema' },
    { id: 3, role: 'field', text: 'Kirja sisu' },
    { id: 4, role: 'button', text: 'Saada' },
    { id: 5, role: 'button', text: 'Loobu mustandist' },
  ],
  media: null,
  hints: false,
}

const NEWS_WITH_COOKIES: PageContext = {
  url: 'https://www.err.ee/',
  title: 'ERR | Eesti Rahvusringhääling',
  box: NO_BOX,
  items: [
    { id: 1, role: 'button', text: 'Nõustu kõigiga' },
    { id: 2, role: 'button', text: 'Halda seadeid' },
    { id: 3, role: 'tab', text: 'Uudised' },
    { id: 4, role: 'tab', text: 'Sport' },
    { id: 5, role: 'tab', text: 'Kultuur' },
    { id: 6, role: 'link', text: 'Valitsus kiitis heaks järgmise aasta eelarve' },
    { id: 7, role: 'link', text: 'Ilmateenistus hoiatab tormi eest' },
    { id: 8, role: 'link', text: 'Tartu Ülikool avas uue õppehoone' },
    { id: 9, role: 'link', text: 'Eesti koondis võitis Lätit' },
  ],
  media: null,
  hints: false,
}

const NEWS: PageContext = {
  ...NEWS_WITH_COOKIES,
  items: NEWS_WITH_COOKIES.items.filter((item) => item.id > 2),
}

const FACEBOOK: PageContext = {
  url: 'https://www.facebook.com/',
  title: 'Facebook',
  box: { present: true, text: '', armed: false, kind: 'search', label: 'Otsi Facebookist' },
  items: [
    { id: 1, role: 'field', text: 'Otsi Facebookist' },
    { id: 2, role: 'field', text: 'Mis sul mõttes on, Toomas?' },
    { id: 3, role: 'link', text: 'Mari Mets' },
    { id: 4, role: 'button', text: 'Meeldib' },
    { id: 5, role: 'button', text: 'Kommenteeri' },
    { id: 6, role: 'field', text: 'Kirjuta kommentaar...' },
    { id: 7, role: 'link', text: 'Tartu Jooksuklubi' },
    { id: 8, role: 'button', text: 'Meeldib' },
    { id: 9, role: 'button', text: 'Kommenteeri' },
    { id: 10, role: 'button', text: 'Jälgi' },
  ],
  media: null,
  hints: false,
}

/** An arbitrary e-service form: fields by label and a dropdown. */
const FORM: PageContext = {
  url: 'https://www.eesti.ee/et/taotlus',
  title: 'Taotlus - eesti.ee',
  box: { present: true, text: '', armed: false, kind: 'field', label: 'Eesnimi' },
  items: [
    { id: 1, role: 'field', text: 'Eesnimi' },
    { id: 2, role: 'field', text: 'Perekonnanimi' },
    { id: 3, role: 'field', text: 'E-post' },
    { id: 4, role: 'option', text: 'Eesti' },
    { id: 5, role: 'option', text: 'Soome' },
    { id: 6, role: 'option', text: 'Läti' },
    { id: 7, role: 'button', text: 'Edasi' },
  ],
  media: null,
  hints: false,
}

const oneTab = (page: PageContext): TabSummary[] => [{ index: 1, title: page.title, active: true }]
const GOOGLE_AND_YOUTUBE: TabSummary[] = [
  { index: 1, title: 'ilm tallinnas - Google otsing', active: true },
  { index: 2, title: 'Kassipojad mängivad lumes - YouTube', active: false },
  { index: 3, title: 'WhatsApp', active: false },
]

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------

interface Expectation {
  kind: PageIntent['kind']
  /** For command: the command kind. */
  command?: string
  /** For clickItem and focusItem: the id. */
  id?: number
  /** For goTo and newTab: a substring of the address. */
  url?: string
  /** For openConversation: the name. */
  name?: string
  /** For siteSearch: a substring of the query. For switchTab { query }: a substring of it. */
  query?: string
  /** For media: the action. */
  media?: string
  /** For edit: the edit kind. */
  edit?: string
  /** For scroll: the direction. */
  direction?: string
}

/** One ask of the simulated loop. */
interface Step {
  page: PageContext
  tabs?: TabSummary[]
  /** One expectation, or several when more than one answer is right ("either"). */
  expect: Expectation | Expectation[]
  /** What the engine reports for this step to the next ask. Default ok. */
  outcome?: { ok: boolean; message: string }
  /** When set, the answer's done must equal it. */
  done?: boolean
}

interface Case {
  name: string
  utterance: string
  lang?: Lang
  recent?: string[]
  steps: Step[]
}

interface OneOptions {
  lang?: Lang
  recent?: string[]
  tabs?: TabSummary[]
  done?: boolean
}

function one(utterance: string, page: PageContext, expect: Expectation | Expectation[], options: OneOptions = {}): Case {
  const { tabs, done, lang, recent } = options
  return { name: utterance, utterance, lang, recent, steps: [{ page, tabs, expect, done }] }
}

const click = (id: number): Expectation => ({ kind: 'command', command: 'clickItem', id })
const focus = (id: number): Expectation => ({ kind: 'command', command: 'focusItem', id })
const goTo = (url: string): Expectation => ({ kind: 'command', command: 'goTo', url })
const search = (query: string): Expectation => ({ kind: 'command', command: 'siteSearch', query })
const media = (action: string): Expectation => ({ kind: 'command', command: 'media', media: action })
const open = (name: string): Expectation => ({ kind: 'command', command: 'openConversation', name })
const scroll = (direction: string): Expectation => ({ kind: 'command', command: 'scroll', direction })
const UNCLEAR: Expectation = { kind: 'unclear' }
const DICTATE: Expectation = { kind: 'dictate' }

const CASES: Case[] = [
  // --- YouTube watch page: buttons, fields, media, similar links -------------------------------
  one('mine vaata hiljem', YOUTUBE_WATCH, click(6)),
  one('pane meeldib', YOUTUBE_WATCH, click(3)),
  one('telli see kanal', YOUTUBE_WATCH, click(7)),
  one('jäta reklaam vahele', YOUTUBE_WATCH, click(2)),
  one('kirjuta kommentaar', YOUTUBE_WATCH, focus(8)),
  one('pane heli vaiksemaks', YOUTUBE_WATCH, media('volumeDown')),
  one('pane paus', YOUTUBE_WATCH, media('pause')),
  one('ava koerte video', YOUTUBE_WATCH, click(9)),
  one('teine video', YOUTUBE_WATCH, click(10)),
  one('tulen homme kell viis', YOUTUBE_WATCH, UNCLEAR),
  one('turn it up', YOUTUBE_WATCH, media('volumeUp'), { lang: 'en' }),

  // --- YouTube home and results: ordinals among same-role items, searching ----------------------
  one('ava esimene video', YOUTUBE_HOME, click(3)),
  one('kolmas video', YOUTUBE_HOME, click(5)),
  one('vajuta videole leivast', YOUTUBE_HOME, click(5)),
  one('otsi kassivideod', YOUTUBE_HOME, search('kassi')),
  {
    name: 'multi: search then play first',
    utterance: 'otsi kassivideod ja mängi esimene',
    steps: [
      { page: YOUTUBE_HOME, expect: search('kassi'), done: false },
      { page: YOUTUBE_RESULTS, expect: click(3), done: true },
    ],
  },
  {
    name: 'multi: go to youtube, search, play first',
    utterance: "mine youtube'i ja otsi kassivideod ja mängi esimene",
    steps: [
      { page: NEW_TAB, expect: goTo('youtube'), done: false },
      { page: YOUTUBE_HOME, expect: search('kassi'), done: false },
      { page: YOUTUBE_RESULTS, expect: click(3), done: true },
    ],
  },
  {
    name: 'recovery: not on the page, scroll once, then search',
    utterance: 'ava kassivideo',
    steps: [
      { page: YOUTUBE_HOME_NO_CATS, expect: [scroll('down'), search('kass')], done: false },
      { page: YOUTUBE_HOME_NO_CATS, expect: [search('kass'), UNCLEAR] },
    ],
  },
  {
    name: 'recovery: click failed, do not repeat it',
    utterance: 'ava koerte video',
    steps: [
      { page: YOUTUBE_WATCH, expect: click(9), outcome: { ok: false, message: 'not_found' } },
      { page: YOUTUBE_WATCH, expect: [search('koer'), scroll('down'), UNCLEAR] },
    ],
  },

  // --- WhatsApp: names with case endings, dictation vs command on an armed composer -------------
  one('kirjuta marile', WHATSAPP, open('Mari')),
  one('ava jaan', WHATSAPP, open('Jaan')),
  one('peetrile', WHATSAPP, open('Peeter')),
  one('kirjuta märdile', WHATSAPP, open('Mart')),
  one('kadrile', WHATSAPP, open('Kadri')),
  one('tere kuidas läheb', WHATSAPP, UNCLEAR),
  {
    name: 'multi: open Mari then dictate',
    utterance: 'ava mari ja kirjuta et tulen homme',
    steps: [
      { page: WHATSAPP, expect: open('Mari'), done: false },
      { page: WHATSAPP_CHAT_EMPTY, expect: DICTATE, done: true },
    ],
  },
  one('tulen homme kell viis', WHATSAPP_CHAT, DICTATE),
  one('jah sobib', WHATSAPP_CHAT, DICTATE),
  one('tagasi', WHATSAPP_CHAT, { kind: 'edit', edit: 'undo' }),
  one('saada ära', WHATSAPP_CHAT, { kind: 'send' }),
  // "saada see Marile" wraps the send word in other words. Dictating it would type a command into
  // the message; openConversation is wrong when he is already in Mari's chat. unclear (tell him to
  // say "saada") is the safe answer; send is accepted because he plainly asked for it in Mari's chat.
  one('saada see marile', WHATSAPP_CHAT, [UNCLEAR, { kind: 'send' }]),
  one('homme asemel täna', WHATSAPP_CHAT, { kind: 'edit', edit: 'replace' }),

  // --- Google, tabs, history -------------------------------------------------------------------
  one('mine vatsapi', GOOGLE, goTo('whatsapp')),
  one('ava ilmateenistus', GOOGLE, click(2)),
  one('tagasi', GOOGLE, { kind: 'command', command: 'history' }),
  one('ava uus leht', GOOGLE, { kind: 'command', command: 'newTab' }),
  one("mine tagasi youtube'i", GOOGLE, { kind: 'command', command: 'switchTab', query: 'youtube' }, { tabs: GOOGLE_AND_YOUTUBE }),
  one('go to the whatsapp tab', GOOGLE, { kind: 'command', command: 'switchTab', query: 'whatsapp' }, { lang: 'en', tabs: GOOGLE_AND_YOUTUBE }),

  // --- A news site: cookie dialog, headlines by meaning and by ordinal ---------------------------
  one('nõustu', NEWS_WITH_COOKIES, click(1)),
  one('accept all', NEWS_WITH_COOKIES, click(1), { lang: 'en' }),
  one('loe seda tormi lugu', NEWS, click(7)),
  one('kolmas uudis', NEWS, click(8)),
  one('ava sport', NEWS, click(4)),

  // --- Gmail: inbox rows and a compose form ----------------------------------------------------
  one('kirjuta uus kiri', GMAIL_INBOX, click(2)),
  one('ava kiri jaanilt', GMAIL_INBOX, click(5)),
  one('kirjuta teema', GMAIL_COMPOSE, focus(2)),
  one('lisa saaja', GMAIL_COMPOSE, focus(1)),
  one('järgmine väli', GMAIL_COMPOSE, UNCLEAR),
  one('tulen koosolekule homme', GMAIL_COMPOSE, DICTATE),

  // --- Facebook feed: the first of several like buttons, the comment field ----------------------
  one('meeldib esimene postitus', FACEBOOK, click(4)),
  one('kommenteeri', FACEBOOK, [focus(6), click(5)]),
  one('jälgi jooksuklubi', FACEBOOK, click(10)),

  // --- An arbitrary form -----------------------------------------------------------------------
  one('kirjuta eesnimi', FORM, focus(1)),
  one('vali eesti', FORM, click(4)),
  one('näita numbreid', FORM, { kind: 'command', command: 'showHints' }),

  // --- New tab: sites, sleep, chit-chat --------------------------------------------------------
  one('whatsapp', NEW_TAB, goTo('whatsapp')),
  one('mina youtube', NEW_TAB, goTo('youtube')),
  one('open youtube', NEW_TAB, goTo('youtube'), { lang: 'en' }),
  one('puhka', NEW_TAB, { kind: 'sleep' }),
  one('kirjuta midagi', NEW_TAB, UNCLEAR),
  one('mis kell on', NEW_TAB, UNCLEAR),
  one('tere', NEW_TAB, UNCLEAR),
]

// ---------------------------------------------------------------------------------------------
// Matching and the simulated loop
// ---------------------------------------------------------------------------------------------

function matchesOne(intent: PageIntent, e: Expectation): string | null {
  if (intent.kind !== e.kind) return `kind ${intent.kind}`
  if (intent.kind === 'edit') return e.edit && intent.edit.kind !== e.edit ? `edit ${intent.edit.kind}` : null
  if (intent.kind !== 'command') return null
  const c = intent.command
  if (e.command && c.kind !== e.command) return `command ${c.kind}`
  if (e.id !== undefined && 'id' in c && c.id !== e.id) return `id ${c.id}`
  if (e.url && (c.kind === 'goTo' || c.kind === 'newTab') && !(c.url ?? '').toLowerCase().includes(e.url)) return `url ${c.url}`
  if (e.name && c.kind === 'openConversation' && c.name.toLowerCase() !== e.name.toLowerCase()) return `name ${c.name}`
  if (e.query && c.kind === 'siteSearch' && !c.query.toLowerCase().includes(e.query)) return `query ${c.query}`
  if (e.query && c.kind === 'switchTab') {
    const q = typeof c.to === 'object' && 'query' in c.to ? c.to.query.toLowerCase() : ''
    if (!q.includes(e.query)) return `to ${JSON.stringify(c.to)}`
  }
  if (e.media && c.kind === 'media' && c.action !== e.media) return `media ${c.action}`
  if (e.direction && c.kind === 'scroll' && c.direction !== e.direction) return `direction ${c.direction}`
  return null
}

/** null when the intent matches any accepted expectation, else the first mismatch. */
function matches(intent: PageIntent, expected: Expectation | Expectation[]): string | null {
  const options = Array.isArray(expected) ? expected : [expected]
  let first: string | null = null
  for (const option of options) {
    const problem = matchesOne(intent, option)
    if (problem === null) return null
    first ??= problem
  }
  return first
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

/** The step's action string, as the engine reports it back: "command clickItem 12", "dictate". */
function actionOf(intent: PageIntent): string {
  if (intent.kind === 'edit') return `edit ${intent.edit.kind}`
  if (intent.kind !== 'command') return intent.kind
  const c = intent.command
  let detail = ''
  if ('id' in c) detail = String(c.id)
  else if ('url' in c && c.url) detail = c.url
  else if ('query' in c) detail = c.query
  else if ('name' in c) detail = c.name
  else if ('action' in c) detail = c.action
  else if ('direction' in c) detail = c.direction
  else if ('to' in c) detail = JSON.stringify(c.to)
  return `command ${c.kind}${detail ? ` ${detail}` : ''}`.slice(0, 60)
}

interface AskResult {
  name: string
  utterance: string
  step: number
  site: string
  ms: number
  ok: boolean
  got: string
  say: string
  done: boolean
  wanted: Expectation | Expectation[]
  problem: string | null
  error?: string
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

function siteOf(page: PageContext): string {
  return page.url.startsWith('chrome://') ? page.url : new URL(page.url).hostname
}

async function runCase(c: Case, client: MessagesClient): Promise<{ passed: boolean; asks: AskResult[] }> {
  const asks: AskResult[] = []
  const steps: IntentStep[] = []
  let passed = true
  for (const [i, step] of c.steps.entries()) {
    const request: IntentRequest = {
      lang: c.lang ?? 'et',
      utterance: c.utterance,
      page: step.page,
      tabs: step.tabs ?? oneTab(step.page),
      recent: c.recent ?? [],
      ...(steps.length > 0 ? { steps: [...steps] } : {}),
    }
    const site = siteOf(step.page)
    const started = Date.now()
    let answer: IntentAnswer | null = null
    let error: string | undefined
    try {
      answer = await pageIntent(request, { client, model: MODEL })
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    const ms = Date.now() - started
    let problem: string | null = error ? `error ${error}` : null
    if (answer && problem === null) {
      problem = matches(answer.intent, step.expect)
      const done = answer.done !== false
      if (problem === null && step.done !== undefined && done !== step.done) problem = `done ${done}`
    }
    const ok = problem === null
    const result: AskResult = {
      name: c.name,
      utterance: c.utterance,
      step: i + 1,
      site,
      ms,
      ok,
      got: answer ? describe(answer.intent) : 'error',
      say: answer?.say ?? '',
      done: answer ? answer.done !== false : true,
      wanted: step.expect,
      problem,
      ...(error ? { error } : {}),
    }
    asks.push(result)
    const label = c.steps.length > 1 ? `${c.name} [${i + 1}/${c.steps.length}]` : `"${c.utterance}"`
    const tail = problem ? ` (wanted ${JSON.stringify(step.expect)}, got ${problem})` : ''
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${String(ms).padStart(5)} ms  ${site.padEnd(18)} ${label} -> ${result.got} say=${JSON.stringify(result.say)} done=${result.done}${tail}`,
    )
    if (!ok || !answer) {
      passed = false
      break
    }
    // What the engine would report back: the step as taken, with the simulated outcome.
    const outcome = step.outcome ?? { ok: true, message: '' }
    steps.push({ action: actionOf(answer.intent), say: answer.say, ok: outcome.ok, message: outcome.message })
    if (answer.done !== false && i < c.steps.length - 1) {
      // The model said it was done but the case expected more: the engine's loop would stop here.
      console.log(`FAIL             ${''.padEnd(18)} ${c.name}: done=true after step ${i + 1}, the loop stops`)
      passed = false
      break
    }
  }
  return { passed, asks }
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('intent-eval: ANTHROPIC_API_KEY is not set')
    process.exit(2)
  }
  const anthropic = new Anthropic({ maxRetries: 0 })
  const client: MessagesClient = { messages: { create: (params, options) => anthropic.messages.create(params, options) } }
  const selected = CASES.filter((c) => {
    if (ONLY === '') return true
    const sites = c.steps.map((s) => siteOf(s.page)).join(' ')
    return `${c.name} ${c.utterance} ${sites}`.toLowerCase().includes(ONLY)
  })
  console.log(`model ${MODEL}, ${selected.length} cases${ONLY ? ` (UTLE_EVAL_ONLY=${ONLY})` : ''}`)

  let passed = 0
  const all: AskResult[] = []
  for (const c of selected) {
    const result = await runCase(c, client)
    if (result.passed) passed += 1
    all.push(...result.asks)
  }

  const latencies = all.map((a) => a.ms).sort((a, b) => a - b)
  const p50 = percentile(latencies, 50)
  const p95 = percentile(latencies, 95)
  const rate = selected.length > 0 ? Math.round((100 * passed) / selected.length) : 0
  console.log(`\n${passed}/${selected.length} cases passed (${rate}%), ${all.length} asks, latency p50 ${p50} ms, p95 ${p95} ms`)

  if (JSON_PATH) {
    const report = { model: MODEL, at: new Date().toISOString(), cases: selected.length, passed, asks: all.length, p50, p95, results: all }
    writeFileSync(JSON_PATH, JSON.stringify(report, null, 2))
    console.log(`wrote ${JSON_PATH}`)
  }
  process.exit(passed === selected.length ? 0 : 1)
}

void main()
