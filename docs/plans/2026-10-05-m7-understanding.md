# M7: understanding what he means, and never typing where he did not ask (2026-10-05 evening)

Written for the demo on 6 October. Ralf's report after a day of real use, in his order of weight:

1. **It only obeys exact phrases.** "Ava uus leht" did nothing (the table has "ava uus vaheleht"). He said the
   same thing seven times. A user cannot know the phrase list; "uus leht", "new page", "ava uus leht" and
   "mine whatsappi" must all work, and so must things nobody wrote down ("mine vaata hiljem", "pane heli
   vaiksemaks", "vajuta videole", "kirjuta kommentaar").
2. **Anything it does not understand is typed into whatever field is on the page**, on YouTube and Google
   that is the search bar, on WhatsApp the chat search. He cannot use the mouse to empty it.
3. "Tagasi" should undo what was just typed when there is text, not leave the page.
4. WhatsApp: he cannot open a person; the numbers are not recognised, and the words go to the search bar.
5. YouTube: cannot open a video, "watch later", lower the volume, comment.
6. There is no way to close the bar.
7. Settings: the extension's options page cannot be used by voice, and Chrome's own settings cannot either.
8. The strip looks bad.

Items 1 and 2 are the brief. 3 to 6 fall out of the same change. 7 and 8 are their own lanes.

## The change in one paragraph

Rules stay first (instant, free, offline). What the rules do not recognise no longer becomes dictation by
default: it goes to a Claude model on the local dev server (`POST /api/intent`) together with what is on
the page (address, title, the message box, the visible clickable things, the video), and the model answers
with **one intent from a fixed set**, validated in `src/core` before anything runs. Dictation happens only
where the user has asked for it: the site's own message box, a conversation he opened, or a field he
picked ("näita numbreid" + number, "vajuta otsing", "kirjuta siia"). A page's own auto-focused search bar
is never a dictation target. When the model is unreachable (no key, no network) the rules still work and
the strip says in one line that the free-form understanding is off.

## Contract (fixed before the lanes start)

### New browser commands (`src/browser/protocol.ts`)

| Command | Page side |
|---|---|
| `readPage` | Answers `page`: `{ url, title, box: BoxState & { kind, label, armed }, items: PageItem[], media: MediaState \| null, hints: boolean }`. `items` are the visible actionable elements (same collector as the numbers), each `{ id, role, text }`, text at most 60 chars, at most 120 items. The page keeps the element refs for the ids until the next `readPage`. |
| `clickItem { id }` | Clicks the item of the last `readPage` (a text field is focused and armed instead). |
| `focusItem { id }` | Focuses the item's text field and arms it for dictation. |
| `siteSearch { query }` | Finds the site's search field (site table, then `input[type=search]`, `[role=searchbox]`, `input[name=q]`, `input#search`), types the query, presses Enter. Arms nothing. |
| `media { action }` | `play`, `pause`, `toggle`, `mute`, `unmute`, `volumeUp`, `volumeDown`, `fullscreen`, `exitFullscreen`, `forward`, `back` on the largest visible `<video>` or `<audio>`. |
| `pressKey { key }` | `Escape` or `Enter` on the focused element. |
| `clearField` | Empties the focused or armed field (setText '' works only on the armed box). |
| `arm { on: boolean }` | Marks the focused field as the dictation target ("kirjuta siia") or releases it. |
| `bar { show: boolean }` | Strip hidden to a small microphone pill, or shown. Handled by the service worker. |

Adding a kind breaks `browserDoing`/`browserDone`/`browserFailed` in `src/core/strings.ts` and `execute`
in `extension/src/background.ts`: add the cases in the same commit.

### The armed box

`BoxState` gains `armed: boolean`. `present && armed` means dictation may go there. Armed when: the
element is the site's composer (WhatsApp, Messenger, and a `textarea`/`contenteditable` with a send
button beside it on an unknown site); or the user focused it through Ütle (`clickHint`, `clickItem`,
`focusItem`, `openConversation`, `arm`). A field the page focused by itself is `present` and not `armed`.
The core's dictate action, preview, repairs and send require `armed`; without it the line says where the
words can go ("Ütle „kirjuta siia“ või „näita numbreid“."). `arm` persists per tab in the page script
(a `WeakRef` to the element) until the page navigates.

### The intent request and answer (`src/core/pageIntent.ts`, pure, zod)

```ts
interface IntentRequest {
  lang: 'et' | 'en'
  utterance: string
  page: PageContext            // the readPage answer
  tabs: { index: number; title: string; active: boolean }[]
  recent: string[]             // the last 3 strip lines, for "no, the other one"
}

type PageIntent =
  | { kind: 'dictate'; text: string }                        // only honoured when the box is armed
  | { kind: 'command'; command: BrowserCommand }             // any kind above except readPage
  | { kind: 'edit'; edit: 'undo' | 'clear' | 'deleteWord' | 'deleteSentence' | { replace: [string, string] } }
  | { kind: 'send' }
  | { kind: 'sleep' } | { kind: 'wake' }
  | { kind: 'unclear'; say: string }                         // one short Estonian line, shown on the strip
```

`pageIntentFrom(unknown): PageIntent | null` validates; `applyIntent(session, intent, page)` turns it
into an `InpageStep` through the same `act` as the rules (so undo, hints and lines behave the same).
`clickItem`/`focusItem` ids must be in `page.items`; `goTo` must be http(s); `switchTab` index within
`tabs`. Anything else is `null` and the strip says it did not understand.

### The server (`server/intent.ts`, `POST /api/intent`)

One `messages.create` with `tools: [answer]` (strict, `tool_choice: auto`, `disable_parallel_tool_use`),
`claude-opus-5-5`, `output_config: { effort: 'low' }`, `max_tokens: 512`, 6 s timeout, no retry. The
system prompt (`server/intentPrompt.ts`) is fixed text (cached); the page context goes in the user turn.
Logs kind and ms only, never the utterance or the page (CLAUDE.md). `UTLE_MODEL` overrides the model.
No key or a 401: `503 { error: 'no_model' }`, once, and the extension shows one line.

### When the engine asks the model (`extension/src/engine.ts`)

1. `inpageStep` as today. If the action is anything but `dictate`, run it: no model.
2. If `dictate` and the box is armed and the utterance has 9 words or more: dictation, no model
   (long sentences are sentences; the preview is already in the box).
3. Otherwise `readPage`, `POST /api/intent`, `applyIntent`. The preview stays in the box meanwhile; if
   the answer is not dictation the base is typed back (the engine already does this for commands).
4. Model unreachable or `unclear`: with an armed box and a sentence-like utterance, dictate; otherwise
   the strip line says so and nothing is typed.

The strip shows "Mõtlen…" while waiting, at most 6 s.

### Rules added (no model, `src/core/*`)

- `newTab`: "uus leht", "ava uus leht", "uus aken", "ava uus aken", "new page", "new window".
- "tagasi" / "back": undo when the armed box has text and `undo` is not empty; else history back.
- "sulge" / "close": closeTab. "peida riba" / "näita riba": bar. "kirjuta siia": arm. "stopp"
  (while hints show): hideHints. "otsi X": `siteSearch` on a site with a search field, else Google.
  "otsi googlest X", "otsi youtube'ist X": that site. "mängi", "paus", "vaigista", "heli valjemaks /
  vaiksemaks", "täisekraan": media.
- Numbers while hints show: also "number N", "vajuta N", "ava N", digits with a trailing full stop.

## Lanes

- **core**: protocol types, `pageIntent.ts`, rules, `inpage.ts` armed box, strings. Tests first.
- **server**: `server/intent.ts`, prompt, `/api/intent`, tests with a fake client.
- **page**: `extension/src/page.ts` commands above, `box.ts` armed logic, `background.ts` switch,
  `extension/test/run.ts` cases on stand-in pages (a YouTube-like page with a video and a search bar,
  the WhatsApp stand-in).
- **engine**: steps 1 to 4 above, strip state `thinking`, bar hide/show, `engine.test.ts`.
- **ui**: the strip restyle (Atkinson Hyperlegible, 96 px, hide button, three example phrases that
  change with the page, calmer colours), the pill, and the options page mounting the strip with large
  controls: bar size, microphone side, push-to-talk, hide.

Gate: `npm run check`, then `npx tsx extension/test/run.ts`. The voice test needs the model files,
which this machine does not have; Ralf runs it.

## Not in this milestone

Push-to-talk flushing mid-utterance (needs `flush` on the ASR wire); Chrome's own settings pages
(impossible from an extension; the answer is the options page and voice commands for its settings);
Messenger verification; the key itself (the server has none; Ralf's is rejected with 401 as of 15:30).
