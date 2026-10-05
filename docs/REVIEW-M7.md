# Review of M7 (`git diff 9532bca..HEAD`), 2026-10-05 night

Read end to end: `src/core/inpage.ts`, `browserIntent.ts`, `quickReply.ts`, `pageIntent.ts`, `src/browser/protocol.ts`,
`server/intent.ts`, `intentPrompt.ts`, `vitePlugin.ts`, `extension/src/engine.ts`, `offscreenMain.ts`, `page.ts`,
`box.ts`, `sites.ts`, `strip.ts`, `options.ts`, `newtab.ts`, `background.ts`, `messages.ts`, `relay.js`, and the tests.
Nothing here has run against a real model or a real site; this is a desk review. Findings are ranked by what a
wrong action would cost him tomorrow. "Fixed" means the fix is in this worktree (branch `m72-review`) with tests,
and `npm run typecheck && npm run lint && npm run test` is green (1833 tests). "Proposal" means it stays a diff here.

## High

### H1. "tagasi" right after "kustuta kõik" leaves the page instead of bringing the words back. Fixed.

`src/core/inpage.ts` `act` case `'back'` (was line 522): undo only when `box.text.trim() !== '' && undo.length > 0`.
After "tühjenda" / "kustuta kõik" the box is empty and `undo` holds the old text; the natural "tagasi" ("oops,
bring it back") went `history back` and navigated away from the WhatsApp chat. The mirror case was as bad: words
in the composer, nothing on `undo` (a draft the page already had), "tagasi" leaves the page with the draft.

Fix applied: an armed box with words in it, or with an `undo` entry, is always `undo()` (which says
`nothingToUndo` when the stack is empty); the page history only when he is not writing. Spec row in
`docs/ARCHITECTURE.md` section 22 updated first, tests in `inpage.test.ts` ("M7 tagasi").

### H2. One-word fixed phrases hijack one-word answers into WhatsApp. Fixed.

`src/core/browserIntent.ts` FIXED table: "välja" → `pressKey Escape` (blurs the composer), "enter" / "sisesta" /
"kinnita" → `pressKey Enter` (on WhatsApp this *sends the message*, bypassing every send safeguard in `act`:
armed, non-empty, the plain word "saada"), "sulge" / "close" → `closeTab` (closes the chat mid-message), "siia"
→ `arm` (re-arms whatever is focused), "edasi" → history forward, "paus" / "mängi" / "peata" → media. All of these
are ordinary one-word replies ("Välja.", "Edasi.", "Kinnita.", "Siia."). `classifyExact` matches the whole
utterance before dictation, so the box never got a say.

Fix applied (`inpage.ts` `SOFT_WORDS`, checked in `inpageStep`): these single words are the command only when
the armed box is empty, unarmed or absent; with words in the armed box they are dictation and, like any short
dictation, go to the model (`ask: true`), which sees the box and decides. Two-word phrases ("pane kinni",
"kirjuta siia") are unchanged. Spec paragraph "Soft words" added to section 22; tests "M7 soft words".
Note: `inpageInstant` still reports them instant (no 150 ms hold), which only affects joining; acceptable.

### H3. A long strip line turns every following `/api/intent` into a 400, and the 400 is read as "model said nothing", so the rules dictate. Fixed.

`extension/src/engine.ts` `say()` kept `recent` lines uncut; `IntentRequestSchema.recent` is `max(200)` per line.
`understood(say)` (up to ~134 chars) + `noPlaceToWrite` (112 chars) is 246 chars. After one such line the next
three asks are 400 (`bad_request`), `askIntent` maps that to `{ error: 'bad' }`, `consult` returns the rules'
step, which for an armed box is `setText` of the words. So "ava vaata hiljem" would be typed into the composer
for the next three utterances with no sign on the strip. Same class: `page.url` > 2000 (long Google URLs),
`title` > 300, `box.text` > 4000, more than 60 tabs.

Fix applied: `recent` lines clipped to 200; `readPage` in the engine clips url/title/box text to the schema;
`background.ts` `tabSummaries` slices to 60. Tests "clips the lines it tells the model" and "clips the page".

### H4. One thrown step silences the engine for the rest of the session. Fixed.

`engine.ts` `onUtterance`: `queue = queue.then(() => handle(...))`. If `handle` ever rejects (a bug in
`inpageStep`/`applyIntent`/`inpageResult` on some input nobody tested), `queue` is a rejected promise and every
later `.then` is skipped: every utterance after it does nothing, `thinking` stays whatever it was, no line says
why. M7 added three more code paths into `handle`. Fix applied: `.catch(() => undefined)` on the chain; test
"a step that throws does not stop the utterances after it".

## Medium

### M1. `clickItem` after a same-document navigation can hit a recycled element. Partly fixed, rest a proposal.

`page.ts`: `pageItems` is only replaced by the next `readPage`. `onNavigation` cleared the labels and the armed
field but not `pageItems`, so on YouTube (an SPA: `navigate` fires, the document stays) an id from the previous
page's `readPage` still resolved to an element; `isConnected` is true for recycled `ytd-thumbnail`s. In the
normal flow (readPage → model → clickItem within ~3 s) this needs the page to change under him, which YouTube
does (autoplay, lazy rows). Fixed the cheap half: `onNavigation` now also empties `pageItems`.

Proposal for the rest (not applied: a false "changed" could also cost a click): remember what was emitted and
refuse when it no longer matches.

```ts
// page.ts
let pageTexts: string[] = []
function readPage(site) { ... pageItems = elements; pageTexts = elements.map(textOf) ... }
function itemOf(id: number): HTMLElement | BrowserResult {
  const el = pageItems[id - 1]
  ...
  if (textOf(el) !== pageTexts[id - 1]) return fail('not_found', `Item ${id} changed since the page was read.`)
  return el
}
```

### M2. On WhatsApp with the chat search focused by the site, the composer is "nowhere to write". Proposal.

`box.ts` `findMessageBox`: armed element → *focused field* → site composer. WhatsApp focuses `#side` search on
load and after some navigations; `boxState` then reports the search (kind `search`, unarmed), dictation is
refused with `noPlaceToWrite` although the chat's composer is visible, and "kirjuta siia" arms *the search*.
`openConversation`/`clickItem` on a row arm the composer (`settleInComposer`), so the demo path is fine; the
failure is a chat he opened with the eye tracker, or one WhatsApp reopened on its own. Proposal:

```ts
// box.ts findMessageBox, after the armed check
const active = focusedTextField()
if (active && !(site && isSearchField(active) && lowestVisible(site.composer))) return active
if (site) { const composer = lowestVisible(site.composer); if (composer) return composer }
if (active) return active
```

Related, by design (plan: "a field the page focused by itself is not armed"): a field he clicks with the eye
tracker is also "focused by itself". He has to say "kirjuta siia" after an eye click. Tell him before the demo.

### M3. The model call: 7 s, Opus 5.5 with thinking always on, prompt not cached. Proposal.

`server/intent.ts`: `claude-opus-5-5`, `output_config.effort: 'low'`, `timeout 7000`, no retry. On Opus 5.5
thinking cannot be turned off (effort is the only lever), and nothing marks the fixed system prompt + tool for
caching (`cache_control` is never set; the API caches nothing without it), so every call pays the ~2.5k-token
prefix cold. Typical answers should still land in 2–4 s, but the engine's own 7 s timer (`ASK_TIMEOUT_MS`) equals
the server's, so the server's 504 is never seen and a slow answer means 7 s of "Mõtlen…" and then the rules
dictate the words (armed box). Two cheap changes before the demo:

```ts
// server/intent.ts
system: [{ type: 'text', text: INTENT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
```

and run the demo with `UTLE_MODEL=claude-sonnet-5-5` (same strict-tool and effort surface; faster) unless the eval
script shows Opus is needed. `tool_choice: auto` + `strict: true` + `disable_parallel_tool_use` is the right shape
for these models (forced `any`/`tool` is a 400); the schema (anyOf of closed objects, `null` unions, every
property required) is valid for strict mode; `effort` is typed in SDK 0.131 and GA. The per-request `{ timeout }`
reaches the SDK through `vitePlugin.ts`'s wrapper, `maxRetries: 0` holds. Empty utterance is a 400. The key is
never logged (`[intent] kind=… ms=…` only; the SDK error message is dropped by `toIntentError`).

### M4. Dangling fetches. Fixed.

`offscreenMain.ts`: `serverStatus` had no timeout and runs first in the engine queue (`engine.ts` status step):
a dev server that accepts and never answers would hold every utterance. `askIntent`'s fetch outlived the
engine's 7 s timer (harmless: the late resolve is a no-op on an already-resolved promise, no state is touched,
but the server kept working). Fixed with `AbortSignal.timeout` (3 s status, ASK_TIMEOUT_MS + 1 s ask).

### M5. The one-letter rule can reach `arm` and `pressKey Escape`. Proposal, low confidence it matters.

`inpage.ts` `misheard`: "kirjuta siis" (write then) is one letter from "kirjuta siia" → `arm`; "pane kinn"
→ Escape. Only two-to-four-word utterances, and `pressKey Enter` has no multi-word phrase, so no send path. If it
bites tomorrow, exclude them in `attempt`:

```ts
if (action.kind === 'browser' && (action.command.kind === 'arm' || action.command.kind === 'pressKey')) return
```

### M6. The M7.2 contract (`done`, `steps`, `MAX_INTENT_STEPS`) is contract only.

`pageIntent.ts` carries `done?` and `steps?`; `server/intent.ts` never returns `done` (the answer tool has no
such property, strict mode would reject it), and `engine.ts` has no loop. Nothing breaks (`done` is optional both
ways), but HANDOFF should say multi-step utterances are not built, so nobody promises "mine youtube'i ja otsi
kassivideod" at the demo.

## Low / verified fine

- **no_model join.** Server: `502 { error: { code: 'upstream_rejected', message: 'no_key' } }` for no key, 401 or 403.
  `askIntent` reads `error.message === 'no_key'` → `no_model` → one strip line. 400/504 → `bad`/`unreachable` →
  rules, silently. `GET /api/status` `{ mode, model, intent }` matches `serverStatus`. OK.
- **URL derivation.** `serverUrl('ws://localhost:5173/api/asr', '/api/intent')` → `http://localhost:5173/api/intent`
  (checked in node; ws→http is a special-to-special scheme change, allowed). OK.
- **CORS.** The offscreen document is an extension page with `<all_urls>`; CORS does not apply. The plugin's
  middlewares run before Vite 8's own `cors` middleware (added inside `configureServer`), so `OPTIONS` gets 204 with
  `Access-Control-Allow-Origin: *` anyway. OK.
- **Ids.** `readPage` ids are `i + 1` over the collected elements; gaps where the text is empty, never 0;
  `itemOf(id)` is `pageItems[id - 1]`. `Id = nonnegative()` admits 0 but `pageIntentFrom` requires the id to be in
  `page.items`, both on the server and again in the engine. Hints and items share `collectActionable`, so numbers
  and ids agree when both exist. OK.
- **`IntentAnswerSchema` vs the real reply.** `{ intent, say }`, `say` cut to 120 on the server, `Short` is 120.
  An `unclear.say` over 120 fails `PageIntentSchema` on the server → the default `notUnderstood`. OK.
- **Armed-box paths.** `inpagePreview` returns null unless `present && armed`; `wanted()` only puts the base back;
  `act` dictate/edit/undo/send require armed; one-breath and `openConversation` never look at the box and
  `settleInComposer` arms the composer; `siteSearch` arms nothing; `clickHint`/`clickItem`/`focusItem` on a field
  arm it (his choice); `clearField` may clear a focused unarmed search (intended, "tühjenda otsing"). `setText`'s
  append path and the engine's base both come from `findMessageBox`, same preference order, so they agree. No path
  found by which dictation reaches an unarmed search bar.
- **Engine races.** The next utterance's `Live.ready` waits on `queue`, which holds the current `handle`
  (including `consult`), so no preview is typed while the model thinks; finals are serialised. `thinking` is reset
  in `finally`; `readPage`/`tabs`/`ask` never reject. `recent` is bounded. A late answer after the 7 s timer is
  dropped without touching state. OK (plus H4).
- **Strip.** `hidden` → `room.textContent = ''` + `unfit()`, shown → `roomCss` again; `fitApp` skips when hidden.
  `stay()` re-appends, it does not re-mount, so one `storage.onChanged` listener per page. `utle-bar` /
  `utle-open-options` are accepted from any context of this extension (the strip must send them; a web page cannot
  call `chrome.runtime.sendMessage` into us without `externally_connectable`). `utle-tabs` and `utle-run` refuse
  any sender with a tab, so relay.js (sender has a tab) cannot reach them; `utle-command` checks the origin. OK.
- **Options page.** `options.html` loads `dist/page.js` before `dist/options.js`; `ourNewTab` matches
  `options.html`; the options listener answers `utle-page-run` only when `chrome.tabs.getCurrent()` is the message's
  tab id; `options_page` opens in a tab so it is the active tab of a normal window. OK.
- **Numbers.** Bare numbers and `HINT_PICK` only while `session.hints`; "kaks kümmend üks" → 21 by joining; the
  `teist` regex needs a unit before it. Without labels "üksteist" is dictation. OK.
- **`withoutNulls`** keeps `switchTab.to` object forms and `replace.from/to`; only `null` properties go. OK.
- **Prompt vs rules.** `intentPrompt.ts` lists "pane kinni" under media pause; the rule table has it as Escape.
  Whole-utterance rules win, so this only shapes variants ("pane see kinni"). Make them agree when editing the prompt.
- **Pre-existing, not M7:** `execute()` has no default case, so a bridge command of an unknown kind answers
  `undefined` and the dev page times out; `openConversation` via WhatsApp's search leaves the name in the chat
  search when the row never opens.

## What was changed in this worktree

- `src/core/inpage.ts`: H1 (`back`), H2 (`SOFT_WORDS`). `src/core/inpage.test.ts`: tests for both, existing
  tables adjusted to an empty armed box where a soft word was used with words in the box.
- `docs/ARCHITECTURE.md` section 22: the "tagasi" row and a "Soft words" paragraph (spec first, then code).
- `extension/src/engine.ts`: H3 (clip recent, url, title, box text), H4 (queue `.catch`). Tests in `engine.test.ts`.
- `extension/src/offscreenMain.ts`: M4 (`AbortSignal.timeout` on status and ask).
- `extension/src/page.ts`: M1 (`pageItems` cleared on navigation).
- `extension/src/background.ts`: H3 (at most 60 tabs).

Not touched: M1's text check, M2, M3, M5, M6, the prompt wording. `npx tsx extension/test/run.ts` was not run here
(no Chromium in this review); the page.ts change is one assignment in a handler the browser tests already exercise.
