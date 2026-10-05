import type Anthropic from '@anthropic-ai/sdk'
import { MEDIA_ACTIONS } from '../src/core/pageIntent.ts'
import type { IntentRequest } from '../src/core/pageIntent.ts'

/**
 * M7 (docs/plans/2026-10-05-m7-understanding.md): the fixed system prompt for POST /api/intent.
 * It is the same text on every call so the API can cache it; everything that changes (the page,
 * the utterance) goes in the user turn. Instructions in English, examples in Estonian, because
 * that is what the user speaks.
 */
export const INTENT_SYSTEM_PROMPT = `You are the understanding engine of Ütle, a Chrome extension for a person who cannot use his hands. He drives the browser and writes messages by voice. He speaks Estonian, sometimes English. The words come from a speech recogniser that often mishears: mina/mine, vatsap/whatsapp, missing or wrong word endings, a joined or split word. Read for meaning, not spelling.

The fixed voice rules did not recognise this utterance. You get what is on the page (address, title, the message box with an armed flag, the visible items numbered by id with a role and text, the media state, the open tabs, the last strip lines) and the utterance. Answer with exactly one call of the tool "answer", whose input is { intent, say }. Always call the answer tool, never reply in text.

# Picking the intent

Prefer a concrete action on the page in front.
- The user names something visible: command clickItem with the id of the item whose text matches what he said, by meaning and across languages. "vaata hiljem" / "mine vaata hiljem" is the item whose text contains "Vaata hiljem" or "Watch later". "vajuta videole" / "ava esimene video" is the first item that is a video link. "meeldib" is the Like button. Match a misheard word to the nearest item text.
- A text field he wants to write in ("kirjuta kommentaar", "kommenteeri"): command focusItem with that field's id. He then dictates into it.
- A person on a messaging site ("kirjuta Marile", "ava Jaan", "Peeter"): command openConversation with the name in its base form (Marile -> Mari).
- A site ("mine whatsappi", "whatsapp", "vatsap", "ava youtube", "google"): command goTo with the full address (https://web.whatsapp.com/, https://www.youtube.com/, https://www.google.com/, https://www.facebook.com/messages/, https://mail.google.com/, https://www.err.ee/, https://www.postimees.ee/, https://www.delfi.ee/).
- "uus leht" / "uus aken" / "new page": command newTab (url null, or the site he named). "sulge": closeTab. "järgmine leht" / "eelmine leht": switchTab next/previous; a tab named by its title: switchTab query.
- "tagasi" / "back": when the box is armed and has text, edit undo; otherwise command history back. "edasi": history forward. "värskenda": reload. "keri alla / üles / lõppu / algusesse": scroll.
- A search ("otsi kassivideod", "otsi marile sõnumid"): command siteSearch with the query (without "otsi") when the site has a search field: YouTube, Google, a shop, WhatsApp (searches chats). "otsi googlest X" from elsewhere: goTo https://www.google.com/search?q=X.
- Media, only when media is present: "mängi" play, "paus" / "pane kinni" pause, "vaigista" mute, "heli peale" unmute, "valjemaks" volumeUp, "vaiksemaks" volumeDown, "täisekraan" fullscreen, "välja täisekraanist" exitFullscreen, "edasi keri" forward, "tagasi keri" back.
- "näita numbreid" showHints; "peida numbrid" / "stopp" while hints show: hideHints; a number while hints show: clickHint.
- "kirjuta siia" arm on; "vabasta" / "ära kirjuta siia" arm off. "tühjenda" / "kustuta kõik": edit clear when the box is armed, else command clearField. "kustuta sõna" deleteWord, "kustuta lause" deleteSentence. "X asemel Y" / "mitte X vaid Y": edit replace from X to Y. "peida riba" bar show false, "näita riba" bar show true. "sulge aken" / "esc": pressKey Escape. "enter": pressKey Enter.

# Dictation

dictate ONLY when the box is armed AND the words read as message text to the person he is writing to ("tulen kell viis", "jah sobib", "homme ei saa"), not as an instruction to the browser. When the box is not armed, never dictate: pick an action, or answer unclear with one short line in his language saying what he can say instead, for example "Ütle „kirjuta siia“ või „näita numbreid“." An auto-focused search bar is not a place for his words.

# Never without plain words

send only for "saada" / "saada ära" / "send". sleep only for "puhka" / "jää magama" / "stop listening". wake only for "ärka üles" / "wake up". Never guess these: a message sent by mistake cannot be taken back. When the words could be a command or dictation and the box is armed, prefer the command only if it is clearly one; a sentence with a verb in the first person is text.

# unclear

When nothing fits, intent unclear with say: one short line in the request's language, telling him one or two things he can say on this page. Never more than one line.

# say

At most 8 words, in the request's language (lang), stating what you took the words to be, like "ava Vaata hiljem", "avan vestluse Mariga", "heli vaiksemaks". Empty string when the utterance already said it plainly. Never a question, never an apology.`

const STRING = { type: 'string' } as const
const BOOLEAN = { type: 'boolean' } as const
const ID = { type: 'integer', description: 'The id of an item from the page list.' } as const

function object(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

function kind(name: string, properties: Record<string, unknown> = {}): Record<string, unknown> {
  return object({ kind: { type: 'string', enum: [name] }, ...properties })
}

/** Every browser command the model may answer with. Mirrors CommandSchema in src/core/pageIntent.ts, with null for optional. */
const COMMAND = {
  anyOf: [
    kind('newTab', { url: { anyOf: [STRING, { type: 'null' }], description: 'A full http(s) address, or null for an empty tab.' } }),
    kind('closeTab'),
    kind('switchTab', {
      to: {
        anyOf: [{ type: 'string', enum: ['next', 'previous'] }, object({ index: { type: 'integer' } }), object({ query: STRING })],
      },
    }),
    kind('goTo', { url: { type: 'string', description: 'A full address with the scheme, https://...' } }),
    kind('history', { direction: { type: 'string', enum: ['back', 'forward'] } }),
    kind('reload'),
    kind('scroll', { direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] } }),
    kind('showHints'),
    kind('hideHints'),
    kind('clickHint', { number: { type: 'integer' } }),
    kind('openConversation', { name: { type: 'string', description: 'The name in its base form, as the chat list would show it.' } }),
    kind('clickItem', { id: ID }),
    kind('focusItem', { id: ID }),
    kind('siteSearch', { query: STRING }),
    kind('media', { action: { type: 'string', enum: [...MEDIA_ACTIONS] } }),
    kind('pressKey', { key: { type: 'string', enum: ['Escape', 'Enter'] } }),
    kind('clearField'),
    kind('arm', { on: BOOLEAN }),
    kind('bar', { show: BOOLEAN }),
  ],
}

const EDIT = {
  anyOf: [kind('undo'), kind('clear'), kind('deleteWord'), kind('deleteSentence'), kind('replace', { from: STRING, to: STRING })],
}

const INTENT = {
  anyOf: [
    kind('dictate', { text: { type: 'string', description: 'The words for the message box, tidied into a sentence.' } }),
    kind('command', { command: COMMAND }),
    kind('edit', { edit: EDIT }),
    kind('send'),
    kind('sleep'),
    kind('wake'),
    kind('unclear', { say: { type: 'string', description: 'One short line in the request language with what he can say.' } }),
  ],
}

/** The one tool the model calls. Its input is an IntentAnswer (with null where the core has undefined). */
export const ANSWER_TOOL: Anthropic.Tool = {
  name: 'answer',
  description: 'The one intent the utterance means on this page, and a short line saying what you took it to be.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      intent: INTENT,
      say: { type: 'string', description: 'At most 8 words in the request language, or an empty string.' },
    },
    required: ['intent', 'say'],
    additionalProperties: false,
  },
}

const BOX_TEXT_MAX = 200

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The user turn: a compact listing of the request. Items as `id. [role] text` lines to save tokens. */
export function intentUserMessage(request: IntentRequest): string {
  const { page } = request
  const box = page.box.present
    ? `present armed=${page.box.armed} kind=${page.box.kind ?? 'field'} label=${JSON.stringify(page.box.label ?? '')} text=${JSON.stringify(clip(page.box.text, BOX_TEXT_MAX))}`
    : 'none'
  const media = page.media
    ? `playing=${page.media.playing} muted=${page.media.muted} volume=${page.media.volume.toFixed(2)} fullscreen=${page.media.fullscreen}`
    : 'none'
  const tabs = request.tabs.map((t) => `${t.index}${t.active ? '*' : ''}. ${t.title}`).join(' | ')
  const items = page.items.map((item) => `${item.id}. [${item.role}] ${item.text}`).join('\n')
  const lines = [
    `lang: ${request.lang}`,
    `url: ${page.url}`,
    `title: ${page.title}`,
    `box: ${box}`,
    `media: ${media}`,
    `hints: ${page.hints}`,
    `tabs: ${tabs || 'none'}`,
    `recent: ${request.recent.length > 0 ? request.recent.map((r) => JSON.stringify(r)).join(' | ') : 'none'}`,
    `items:\n${items || '(none)'}`,
    `utterance: ${JSON.stringify(request.utterance)}`,
  ]
  return lines.join('\n')
}
