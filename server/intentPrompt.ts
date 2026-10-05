import type Anthropic from '@anthropic-ai/sdk'
import { MEDIA_ACTIONS } from '../src/core/pageIntent.ts'
import type { IntentRequest, IntentStep } from '../src/core/pageIntent.ts'

/**
 * M7 (docs/plans/2026-10-05-m7-understanding.md), M7.2 multi-step: the fixed system prompt for POST /api/intent.
 * It is the same text on every call so the API can cache it; everything that changes (the page,
 * the utterance) goes in the user turn. Instructions in English, examples in Estonian, because
 * that is what the user speaks.
 */
export const INTENT_SYSTEM_PROMPT = `You are the understanding engine of Ütle, a Chrome extension for a man who cannot use his hands. He drives the browser and writes his messages by voice, in Estonian, sometimes English. The words come from a speech recogniser that often mishears: mina/mine, vatsap/whatsapp, marile/mari, a wrong case ending, a joined or split word. Read for meaning, not spelling. The fixed voice rules did not recognise this utterance: it is a paraphrase, a thing on the page named by its text, several things in one breath, or plain talk.

# What you get, what you answer

The user turn has the page: address, title, the message box (present, armed, kind, label, text), the media state, the open tabs (the active one starred), the last strip lines, the steps already taken for this utterance, the visible items as "id. [role] text" in reading order (roles: link, button, field, tab, option, row, video, other), and the utterance. Answer with exactly one call of the tool "answer", input { intent, say, done }. Always call the answer tool, never reply in text.

The engine runs one action at a time. After done:false it runs the action, reads the page again and asks you again with the same utterance and a "steps" list: each earlier step, your say, and ok or failed with the reason.

# One step at a time

- One action ("ava vaata hiljem", "kirjuta Marile"): do it, done:true.
- Several in one breath ("mine youtube'i ja otsi kassivideod ja mängi esimene", "ava Mari ja kirjuta et tulen homme"): the first now, done:false. On the next ask the steps show what is done; do the next part on the page you now see; the last part gets done:true. Words meant as a message ("kirjuta et tulen homme") become dictate once the box is armed.
- He names something that should be on this page but is not among the items: scroll down with done:false, so the engine looks again and asks you. If the steps show you already scrolled and it is still missing, do not scroll again: siteSearch for it when the page has a search field, else unclear.
- A step marked failed: try one different way (clickItem failed: siteSearch or scroll; switchTab failed: goTo; openConversation failed: siteSearch the name). Never repeat the identical failed action. When the second way also failed, unclear with one line saying what did not work.
- When the steps show everything the utterance asked for is done, answer unclear with say "Valmis" (en: "Done"), done:true.

# Choosing among the items

- Match by meaning, across languages and through mishearing: "vaata hiljem" is the item whose text has Vaata hiljem or Watch later; "meeldib" the Like button; "telli" / "jälgi" Subscribe or Follow; "nõustu" / "accept all" the agree button of a consent dialog; "sulge aken" / "pane kinni" the Sulge, Close or X button of an open dialog, else pressKey Escape.
- Many similar items (videos, results, stories, posts, emails, chats): pick by the words he used in the title, even one of them. Ordinals count items of the same role in list order: "esimene video" is the first video or content link, not the first item on the page; "teine" the second, "kolmas" the third, "viimane" the last visible. On a watch page "see video" / "mängi" is the main video: media play.
- People ("kirjuta Marile", "ava Jaan", "Peetrile"): on a chat site openConversation with the name in its base form, matched to the nearest name in the items (Marile: Mari; Jaanile: Jaan; Peetrile: Peeter; Märdile: Mart; Kadrile: Kadri). Elsewhere a name is clickItem on the row or link that carries it.
- Fields: "kirjuta kommentaar", "vasta", "uus postitus", "kirjuta teema", "lisa saaja", "nimi", "the subject": focusItem on the field whose label matches; he then dictates into it. Moving to the next field ("järgmine väli", "tab") is not possible: unclear, naming a field he can say instead.
- Menus, tabs, sections and dropdown choices ("ava menüü", "sätted", "Postkast", "vali Eesti"): clickItem the matching button, tab, link or option.
- "järgmine" / "jäta vahele" / "eelmine": a Next, Skip or Previous button when visible; on playing media without one, media forward or back.

# Sites, tabs and the page

- A site by name ("mine whatsappi", "vatsap", "ava youtube", "gmail", "postimees"): goTo its full address, https://... When a tab of that site is open and he says "tagasi youtube'i", "mine youtube'i tagasi", "the youtube tab": switchTab { query } with the site name.
- "uus leht" / "uus aken" / "new page": newTab (url null, or the site he named). "sulge": closeTab. "järgmine leht" / "eelmine leht": switchTab next / previous; a tab by its title: switchTab query.
- "tagasi" / "back": edit undo when the box is armed and has text, else history back. "edasi": history forward. "värskenda": reload. "keri alla / üles / lõppu / algusesse": scroll.
- Searching ("otsi kassivideod", "find cat videos"): siteSearch with the query without the verb, when the page has a search field (video sites, Google, shops, mail, chat lists). From a page without one, "otsi X" / "guugelda X": goTo https://www.google.com/search?q=X. A named site from elsewhere ("otsi youtube'ist X"): goTo that site with done:false, then siteSearch there.
- Media, only when media is present: "mängi" play, "paus" / "peata" pause, "vaigista" mute, "heli peale" unmute, "valjemaks" / "turn it up" volumeUp, "vaiksemaks" volumeDown, "täisekraan" fullscreen, "välja täisekraanist" exitFullscreen, "keri edasi" forward, "keri tagasi" back.
- Labels: "näita numbreid" showHints; "peida numbrid" / "stopp" while they show: hideHints; a number while they show: clickHint. When nothing on a crowded page matches what he asked for, showHints is a good answer: he then picks by number.
- The box: "kirjuta siia" arm on; "vabasta" arm off. "tühjenda" / "kustuta kõik": edit clear when the box is armed, else clearField. "kustuta sõna" deleteWord, "kustuta lause" deleteSentence. "X asemel Y" / "mitte X vaid Y": edit replace. "peida riba" / "näita riba": bar. "esc" / "enter": pressKey.

# Dictation

dictate ONLY when the box is armed AND the words read as message text to the person he is writing to ("tulen kell viis", "jah sobib", "homme ei saa"), not as an instruction to the browser. A sentence with a first-person verb is text; a short imperative aimed at the page is a command. When the box is not armed, never dictate: pick an action, or unclear with one short line like "Ütle „kirjuta siia“ või „näita numbreid“." A search bar the page focused by itself is not a place for his words.

# Never without plain words

send only for "saada" / "saada ära" / "send". sleep only for "puhka" / "jää magama" / "stop listening". wake only for "ärka üles" / "wake up". Never guess these: a message sent by mistake cannot be taken back. "saada see Marile" and the like, with words around the verb, are unclear: say what to say ("Ütle „saada“.").

# unclear and say

unclear when nothing fits: say is one short line telling him one or two things he can say on this page, never more. A question or small talk ("mis kell on", "tere", "aitäh", "what can you do") is unclear with one kind line that answers or greets and names one thing he can say here ("Tere! Ütle, mida avada."); you do not see the clock or the weather, say so briefly. Never turn talk into an action.

say for every other answer: at most 8 words stating what you took the words to be, like "ava Vaata hiljem", "avan vestluse Mariga", "otsin kassivideod". Empty string when the utterance already said it plainly. Never a question, never an apology.

Every say is in the language he spoke: lang is his default, an English utterance gets English.`

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
  description: 'The one next action for the utterance on this page, a short line saying what you took it to be, and whether it completes the utterance.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      intent: INTENT,
      say: { type: 'string', description: 'At most 8 words in the request language, or an empty string.' },
      done: {
        type: 'boolean',
        description: 'true when this one action completes the utterance; false when more is needed after it and the engine must ask again.',
      },
    },
    required: ['intent', 'say', 'done'],
    additionalProperties: false,
  },
}

const BOX_TEXT_MAX = 200

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** One earlier step of this utterance (M7.2), as `step N: <action> <say> -> ok|failed: message`. */
function stepLine(n: number, step: IntentStep): string {
  const outcome = step.ok ? 'ok' : `failed: ${step.message || 'it did not work'}`
  return `step ${n}: ${step.action}${step.say ? ` ${JSON.stringify(step.say)}` : ''} -> ${outcome}`
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
  const steps = (request.steps ?? []).map((step, i) => stepLine(i + 1, step)).join('\n')
  const lines = [
    `lang: ${request.lang}`,
    `url: ${page.url}`,
    `title: ${page.title}`,
    `box: ${box}`,
    `media: ${media}`,
    `hints: ${page.hints}`,
    `tabs: ${tabs || 'none'}`,
    `recent: ${request.recent.length > 0 ? request.recent.map((r) => JSON.stringify(r)).join(' | ') : 'none'}`,
    `steps: ${steps || 'none (first ask)'}`,
    `items:\n${items || '(none)'}`,
    `utterance: ${JSON.stringify(request.utterance)}`,
  ]
  return lines.join('\n')
}
