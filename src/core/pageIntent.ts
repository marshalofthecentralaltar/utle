import * as z from 'zod'
import type { BrowserCommand, PageContext } from '../browser/protocol.ts'
import type { Lang } from './strings.ts'

/**
 * M7 (docs/plans/2026-10-05-m7-understanding.md): what the model may answer when the rules of
 * inpage.ts did not recognise an utterance. The model proposes exactly one intent from this fixed
 * set; pageIntentFrom validates it against the page it was asked about, and applyIntent in
 * inpage.ts turns it into the same step the rules would have produced. Pure.
 */

/** What is sent to POST /api/intent. */
export interface IntentRequest {
  lang: Lang
  utterance: string
  page: PageContext
  tabs: TabSummary[]
  /** The last strip lines, newest last, so "ei, teine" can refer to them. At most 3. */
  recent: string[]
  /**
   * M7.2: the steps already taken for this same utterance, oldest first, when the model said the
   * task was not done after the previous one (a bounded loop in the engine, at most 4 steps). Empty
   * or absent on the first ask.
   */
  steps?: IntentStep[]
}

/** One step the engine took for the utterance: what the model answered, and how it went on the page. */
export interface IntentStep {
  /** The intent kind and command kind, e.g. "command goTo", "command clickItem 12", "dictate". */
  action: string
  /** The model's say for that step. */
  say: string
  ok: boolean
  /** The failure's message when ok is false, else ''. Never the page text. */
  message: string
}

export interface TabSummary {
  /** 1-based, left to right. */
  index: number
  title: string
  active: boolean
}

export type IntentEdit =
  | { kind: 'undo' }
  | { kind: 'clear' }
  | { kind: 'deleteWord' }
  | { kind: 'deleteSentence' }
  | { kind: 'replace'; from: string; to: string }

export type PageIntent =
  /** Words for the message box. Honoured only when the box is armed. */
  | { kind: 'dictate'; text: string }
  /** One browser command. Never readPage. */
  | { kind: 'command'; command: BrowserCommand }
  | { kind: 'edit'; edit: IntentEdit }
  | { kind: 'send' }
  | { kind: 'sleep' }
  | { kind: 'wake' }
  /** The model could not tell. say is one short line in the request's language for the strip. */
  | { kind: 'unclear'; say: string }

/** The answer of POST /api/intent: the intent, and one short line the strip shows while it runs. */
export interface IntentAnswer {
  intent: PageIntent
  /** What the model took the words to be, in the request's language, at most 60 characters. '' when obvious. */
  say: string
  /**
   * M7.2: false when the utterance asks for more than this one step ("mine youtube'i ja otsi
   * kassivideod"): the engine runs the step, reads the page again and asks again with `steps`.
   * Absent means true.
   */
  done?: boolean
}

const Id = z.number().int().nonnegative()
const Text = z.string().min(1).max(500)
const Short = z.string().max(120)

export const MEDIA_ACTIONS = ['play', 'pause', 'toggle', 'mute', 'unmute', 'volumeUp', 'volumeDown', 'fullscreen', 'exitFullscreen', 'forward', 'back'] as const

const CommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('newTab'), url: z.string().url().optional() }),
  z.object({ kind: z.literal('closeTab') }),
  z.object({
    kind: z.literal('switchTab'),
    to: z.union([z.literal('next'), z.literal('previous'), z.object({ index: z.number().int().min(1) }), z.object({ query: Short.min(1) })]),
  }),
  z.object({ kind: z.literal('goTo'), url: z.string().url() }),
  z.object({ kind: z.literal('history'), direction: z.enum(['back', 'forward']) }),
  z.object({ kind: z.literal('reload') }),
  z.object({ kind: z.literal('scroll'), direction: z.enum(['up', 'down', 'top', 'bottom']) }),
  z.object({ kind: z.literal('showHints') }),
  z.object({ kind: z.literal('hideHints') }),
  z.object({ kind: z.literal('clickHint'), number: z.number().int().min(1) }),
  z.object({ kind: z.literal('openConversation'), name: Short.min(1) }),
  z.object({ kind: z.literal('clickItem'), id: Id }),
  z.object({ kind: z.literal('focusItem'), id: Id }),
  z.object({ kind: z.literal('siteSearch'), query: Text }),
  z.object({ kind: z.literal('media'), action: z.enum(MEDIA_ACTIONS) }),
  z.object({ kind: z.literal('pressKey'), key: z.enum(['Escape', 'Enter']) }),
  z.object({ kind: z.literal('clearField') }),
  z.object({ kind: z.literal('arm'), on: z.boolean() }),
  z.object({ kind: z.literal('bar'), show: z.boolean() }),
])

const EditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('undo') }),
  z.object({ kind: z.literal('clear') }),
  z.object({ kind: z.literal('deleteWord') }),
  z.object({ kind: z.literal('deleteSentence') }),
  z.object({ kind: z.literal('replace'), from: Short.min(1), to: Short.min(1) }),
])

export const PageIntentSchema: z.ZodType<PageIntent> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dictate'), text: Text }),
  z.object({ kind: z.literal('command'), command: CommandSchema }),
  z.object({ kind: z.literal('edit'), edit: EditSchema }),
  z.object({ kind: z.literal('send') }),
  z.object({ kind: z.literal('sleep') }),
  z.object({ kind: z.literal('wake') }),
  z.object({ kind: z.literal('unclear'), say: Short }),
])

export const IntentAnswerSchema: z.ZodType<IntentAnswer> = z.object({ intent: PageIntentSchema, say: Short, done: z.boolean().optional() })

/** The engine stops a multi-step utterance after this many steps, whatever the model says. */
export const MAX_INTENT_STEPS = 4

const IntentStepSchema: z.ZodType<IntentStep> = z.object({ action: z.string().max(60), say: z.string().max(120), ok: z.boolean(), message: z.string().max(200) })

const PageItemSchema = z.object({ id: Id, role: z.string().max(20), text: z.string().max(80) })
const BoxSchema = z.object({
  present: z.boolean(),
  text: z.string().max(4000),
  armed: z.boolean(),
  kind: z.enum(['composer', 'search', 'field', 'none']).optional(),
  label: z.string().max(80).optional(),
})
const MediaSchema = z.object({ playing: z.boolean(), muted: z.boolean(), volume: z.number().min(0).max(1), fullscreen: z.boolean() })

export const IntentRequestSchema: z.ZodType<IntentRequest> = z.object({
  lang: z.enum(['et', 'en']),
  utterance: z.string().min(1).max(500),
  page: z.object({
    url: z.string().max(2000),
    title: z.string().max(300),
    box: BoxSchema,
    items: z.array(PageItemSchema).max(150),
    media: MediaSchema.nullable(),
    hints: z.boolean(),
  }),
  tabs: z.array(z.object({ index: z.number().int().min(1), title: z.string().max(300), active: z.boolean() })).max(60),
  recent: z.array(z.string().max(200)).max(3),
  steps: z.array(IntentStepSchema).max(MAX_INTENT_STEPS).optional(),
})

function webAddress(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * The model's answer, checked against the shape and against the page it was asked about: an item
 * id must be one of the page's items, an address must be http(s), a tab index must exist. Anything
 * else is null, and the caller says it did not understand. The model never gets a second try here:
 * a voice command must answer at once.
 */
export function pageIntentFrom(input: unknown, request: Pick<IntentRequest, 'page' | 'tabs'>): PageIntent | null {
  const parsed = PageIntentSchema.safeParse(input)
  if (!parsed.success) return null
  const intent = parsed.data
  if (intent.kind !== 'command') return intent
  const c = intent.command
  const ids = new Set(request.page.items.map((item) => item.id))
  switch (c.kind) {
    case 'clickItem':
    case 'focusItem':
      return ids.has(c.id) ? intent : null
    case 'goTo':
      return webAddress(c.url) ? intent : null
    case 'newTab':
      return c.url === undefined || webAddress(c.url) ? intent : null
    case 'switchTab': {
      const to = c.to
      if (typeof to === 'object' && 'index' in to && !request.tabs.some((t) => t.index === to.index)) return null
      return intent
    }
    case 'clickHint':
      return request.page.hints ? intent : null
    default:
      return intent
  }
}
