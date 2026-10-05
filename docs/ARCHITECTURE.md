# Ütle: architecture

As of 2026-10-05. Written before any code, then corrected where the build taught something (section 17). This is the spec; the implementation plan in
`docs/plans/` argues from it. When code and this file disagree, one of them is a bug.

## 1. What this is

A document editor for people who cannot use their hands. The user says what they mean, the
editor shows what it understood, and the user repairs it in one word. Built for challenge 2 of
the NewWorkTech hackathon (TalTech Mektory, 5 and 6 October 2026). The clickable mock-up that
defines the behaviour: https://claude.ai/artifact/V84UaVNkbmtPPMea8oyqMX

Three moves, taken from how two colleagues work on a document when one has the keyboard:

1. **Refer.** Point by meaning ("the budget deadline") or by the number every paragraph carries.
2. **Show understanding.** A proposed change appears in the document before anything changes.
3. **Repair.** Yes, no, a number, or only the corrected word.

## 2. Principles that constrain every module

| # | Principle | Consequence in code |
|---|---|---|
| P1 | The model proposes operations. It never returns a rewritten document. | `Op` union; server validates every op against the document. |
| P2 | Nothing changes without confirmation. Moving and reading need none. | Edits go `listening → thinking → confirming → listening`; `navigate` skips `confirming`. |
| P3 | One-word replies never touch the network. | `quickReply` runs locally before any request. Yes, no, numbers, undo, sleep and wake work with the API down. |
| P4 | An error never costs more than the sentence that caused it. | A failed request restores the previous mode with the pending proposal intact. |
| P5 | The core is pure. | `src/core/**` imports no DOM, no network, no timers. All behaviour is testable in Node. |
| P6 | Typed input is voice input. | One `utterance` event for both. The typed box is the demo safety net and the test harness. |
| P7 | The preview is derived, never stored. | `buildPreview(doc, ops)`; the document is untouched until yes. |
| P8 | The API key stays on the server. | The browser calls `/api/interpret` only. |
| P9 | Document text is not logged. | The server logs intent kind and duration, nothing else. |
| P10 | The numbers we claim are measured by the product. | Words spoken, edits finished and hand actions are counted in the session state. |

## 3. Scope

| Milestone | Behaviour | Status in this build |
|---|---|---|
| M1 | Speak or type, see the preview, yes or no, change applied, undo | Build now |
| M2 | Paragraph numbers, the "which one" question, one-word repair | Build now |
| M3 | Moving sections and adding items, verified by voice | Ops exist in the core because the op algebra is one unit. Not claimed until voice-tested. |
| M4 | Estonian recognition, read aloud, sleep and wake polish, comparison measurement | Sleep, wake and Estonian quick words exist in the core. Recognition quality is untested. |

Non-goals for M1 and M2: Word import and export, inline formatting, tables, more than one
document, accounts, persistence, deployment, a Word add-in, speech synthesis, free dictation
without an instruction ("add a paragraph saying ..." is the way to create text).

## 4. System shape

```
 microphone ─► WebSpeechRecognizer ─► assembler ─┐
 typed box ──────────────────────────────────────┤ utterance
 keyboard (space, enter, escape) ────────────────┤ key
                                                 ▼
                                    step(session, event)          src/core/session.ts
                                      │ pure reducer
                 ┌────────────────────┼─────────────────────┐
                 ▼                    ▼                     ▼
          quickReply            new Session            Effect: interpret
          (local)               (rendered by UI)             │
                                                             ▼
                                               POST /api/interpret   (browser → dev server)
                                                             │
                                                 server/interpret.ts
                                                  prompt + tools ─► Claude (forced single tool call)
                                                  zod check ─► validate against document
                                                  one retry with the error ─► Intent
                                                             │
                                          event: intent | interpretFailed
```

Two processes at most: the browser and the Vite dev server. The dev server hosts the API
through a Vite plugin, so `npm run dev` is the whole product. No database.

## 5. Module map

| Path | Responsibility | May import |
|---|---|---|
| `src/core/document.ts` | `Block`, `Doc`, the sample document, id generation | nothing |
| `src/core/ops.ts` | `Op` union, `applyOps`, op validation | `document` |
| `src/core/preview.ts` | `buildPreview(doc, ops)` and `diffSegments` for rendering a proposal | `document`, `ops` |
| `src/core/candidates.ts` | `Candidate`, and marking candidate quotes in a block for the "which one" question | `document` |
| `src/core/intent.ts` | `Intent`, `InterpretRequest`, zod schemas: the wire contract | `document`, `ops`, `zod` |
| `src/core/quickReply.ts` | Local recogniser for yes, no, numbers, undo, sleep, wake (English and Estonian) | nothing |
| `src/core/session.ts` | `Session`, `Event`, `Effect`, `step`: the state machine | all of core |
| `src/speech/recognizer.ts` | `Recognizer` interface | nothing |
| `src/speech/assembler.ts` | Joins recogniser finals across pauses into one utterance | `core/quickReply` |
| `src/speech/webSpeech.ts` | Chrome `SpeechRecognition` behind the interface | `recognizer`, `assembler` |
| `src/api/interpretClient.ts` | `fetch('/api/interpret')`, timeout, response validation | `core/intent` |
| `src/ui/useSession.ts` | Holds the session, runs effects, owns the recogniser | core, speech, api |
| `src/ui/*.tsx` | `App`, `DocumentView`, `VoiceBar`, `SidePanel` | core types, `useSession` |
| `server/prompt.ts` | System prompt, document serialisation, context message | core |
| `server/tools.ts` | JSON schemas of the four tools, mapping tool input to `Intent` | core |
| `server/interpret.ts` | `interpret(request, client)`: call, validate, retry once | core, `prompt`, `tools`, SDK |
| `server/vitePlugin.ts` | Mounts `POST /api/interpret` and `GET /api/status` on the dev server | `interpret`, `rehearsal` |
| `server/rehearsal.ts` | Scripted answers for the demo lines: no model, no network, no key | core, `interpret` |
| `scripts/smoke.ts` | Runs the mock-up's script through the real model and prints the result | core, server |

Rule: `src/core` never imports from `speech`, `api`, `ui` or `server`. `server` never imports
from `src/ui` or `src/speech`.

## 6. Data model

```ts
// document.ts
export type BlockType = 'h1' | 'h2' | 'p' | 'li';
export interface Block { id: string; type: BlockType; text: string }
export type Doc = Block[];                       // order is the document order
export function numberOf(doc: Doc, id: string): number;   // 1-based, 0 when absent
export function newBlockId(doc: Doc): string;             // 'b' + (highest numeric suffix + 1)
export const SAMPLE_DOC: Doc;                              // the meeting minutes from the mock-up
```

Block text is plain text. A paragraph's number is its position, so it is derived and changes
when blocks move. Ids are stable for the life of a block and are what the model refers to.

```ts
// ops.ts
export type Op =
  | { op: 'replace_text'; blockId: string; find: string; replace: string }
  | { op: 'set_text';     blockId: string; text: string }
  | { op: 'insert_block'; afterBlockId: string | null; blockType: BlockType; text: string } // null = at the start
  | { op: 'delete_block'; blockId: string }
  | { op: 'move_blocks';  blockIds: string[]; beforeBlockId: string | null };               // null = to the end

export type OpErrorCode =
  | 'no_ops' | 'unknown_block' | 'find_not_found' | 'find_ambiguous'
  | 'empty_text' | 'no_change' | 'bad_move';
export interface OpError { code: OpErrorCode; opIndex: number; message: string }
export type ApplyResult = { ok: true; doc: Doc } | { ok: false; error: OpError };

export function applyOps(doc: Doc, ops: Op[]): ApplyResult;   // pure, never throws, never mutates
```

Validation rules, each with its error code:

- An empty op list is `no_ops`.
- Any `blockId`, `afterBlockId`, `beforeBlockId` that names no block is `unknown_block`.
- `replace_text`: `find` must occur exactly once in the block. Zero is `find_not_found`, more is
  `find_ambiguous`. `find` equal to `replace` is `no_change`. An empty `find` is `find_not_found`.
- `set_text` and `insert_block`: text that is empty after trimming is `empty_text`. `set_text`
  with identical text is `no_change`.
- `move_blocks`: an empty list, a repeated id, or `beforeBlockId` inside the moved set is `bad_move`. A move that leaves the order as it was is `no_change`.
- Ops apply in order against the result of the previous op. The first failure aborts the whole list.

## 7. The wire contract

```ts
// intent.ts
export interface Candidate { blockId: string; quote: string }
export type Intent =
  | { kind: 'propose_edit';   summary: string; ops: Op[] }
  | { kind: 'ask_which';      question: string; candidates: Candidate[] }
  | { kind: 'navigate';       blockId: string; readAloud: boolean }
  | { kind: 'not_understood'; message: string };

export interface Pending { summary: string; ops: Op[] }
export interface ChoiceContext { utterance: string; candidates: Candidate[]; picked: number | null } // picked is 0-based
export interface InterpretRequest {
  doc: Doc;
  utterance: string;
  pending: Pending | null;        // set when the utterance repairs a proposal
  choice: ChoiceContext | null;   // set when the utterance answers a "which one" question
}
export const IntentSchema: z.ZodType<Intent>;
export const InterpretRequestSchema: z.ZodType<InterpretRequest>;
```

The server answers `200` with an `Intent`, or `4xx/5xx` with `{ error: { code, message } }`.
Error codes: `bad_request`, `upstream_unavailable`, `upstream_rejected`, `timeout`.

## 8. The state machine

```ts
// session.ts
export type Mode = 'listening' | 'thinking' | 'confirming' | 'choosing' | 'asleep'
  | 'confirmingSend' | 'sending';                // a message waiting for yes, and on its way (20.3)
export interface Session {
  lang: 'et' | 'en';              // the language of every line shown, and of the interpreter's replies
  draft: { to: string | null; saved: Saved } | null;   // a message being written; saved is the document it replaced
  hints: boolean;                 // numbered labels are showing in the browser
  bridgeSeq: number;              // id of the latest browser command
  doc: Doc;
  history: Doc[];                 // undo stack; history.length is the count of finished edits
  log: string[];                  // one line per finished edit, same length as history
  mode: Mode;
  resume: 'listening' | 'confirming' | 'choosing';   // where to return when a request fails
  pending: Pending | null;
  choice: { utterance: string; question: string; candidates: Candidate[] } | null;
  focusId: string | null;
  heard: string;                  // last utterance as recognised
  understood: string;             // what the editor made of it
  prompt: string;                 // what the user can say next
  words: number;                  // words spoken or typed
  hands: number;                  // typed submissions and key presses
  seq: number;                    // id of the request in flight
  asked: string;                  // the instruction sent with that request
}
export type Event =
  | { type: 'utterance'; text: string; source: 'voice' | 'typed' }
  | { type: 'key'; key: 'confirm' | 'reject' }
  | { type: 'intent'; seq: number; intent: Intent }
  | { type: 'interpretFailed'; seq: number; message: string }
  | { type: 'speechEnded' }
  | { type: 'language'; lang: 'et' | 'en' }
  | { type: 'browserResult'; seq: number; command: BrowserCommand; result: BrowserResult };
export type Effect =
  | { type: 'interpret'; seq: number; request: InterpretRequest }
  | { type: 'speak'; text: string } | { type: 'hush' }
  | { type: 'browser'; seq: number; command: BrowserCommand };
export function initialSession(doc: Doc, lang?: 'et' | 'en'): Session;   // lang defaults to 'en' for tests; the page passes 'et'
export function step(s: Session, e: Event): { state: Session; effects: Effect[] };
```

`prompt` is derived from the mode at the end of every step. The rows below cover the document; browser commands, the hint numbers and the message draft add the rows in section 20.3, and `sending` is treated like `thinking` for utterances. Transition table. "Quick" means the result of `quickReply` on the utterance.

| Mode | Event | Result |
|---|---|---|
| any | utterance that is empty after trimming | no change |
| asleep | quick `wake` | `listening` |
| asleep | anything else | no change, not counted |
| thinking | utterance or key | no change, `understood` says a request is in progress |
| listening, confirming, choosing | quick `sleep` | drop any proposal or question, clear the focus, `asleep` |
| listening, confirming, choosing | quick `wake` | message: already listening |
| listening | quick `undo`, history not empty | pop history and log, restore the document |
| listening | quick `undo`, history empty | message: nothing to undo |
| listening | quick `number` n naming a block | focus that block |
| listening | quick `number` naming no block | message: no such paragraph |
| listening | quick `yes` or `no` | message: nothing to confirm |
| listening | any other utterance | `thinking`, resume `listening`, effect `interpret` |
| confirming | quick `yes`, or key `confirm` | apply ops, push history and log, `listening` |
| confirming | quick `no` or `undo`, or key `reject` | drop the proposal, `listening` |
| confirming | any other utterance | `thinking`, resume `confirming`, effect `interpret` with `pending` |
| choosing | quick `number` in range | `thinking`, resume `choosing`, effect `interpret` with `choice.picked` |
| choosing | quick `number` out of range | message: say a number from 1 to k |
| choosing | quick `no` or `undo`, or key `reject` | drop the question, `listening` |
| choosing | any other utterance | `thinking`, resume `choosing`, effect `interpret` with `choice.picked = null` |
| thinking | intent with a stale `seq` | no change |
| thinking | intent `propose_edit` whose ops apply | `confirming` with `pending` |
| thinking | intent `propose_edit` whose ops fail | resume mode, message: nothing changed |
| thinking | intent `ask_which` with two or more candidates | `choosing` |
| thinking | intent `navigate` | resume mode with the proposal or question intact, focus the block |
| thinking | intent `not_understood` | resume mode, show the message, proposal intact |
| thinking | `interpretFailed` with the current `seq` | resume mode, show the message, proposal intact |

Counting: every utterance handled outside `asleep` and `thinking` adds its word count to
`words`. A typed utterance adds one to `hands`. A key event that is acted on adds one to `hands`.

Keys: space or enter is `confirm`, escape is `reject`, ignored while focus is in the typed box.
This is the "any single switch can stand in for yes" promise, and it is counted as a hand action.

## 9. Quick replies

```ts
// quickReply.ts
export type Quick =
  | { kind: 'yes' } | { kind: 'no' } | { kind: 'undo' }
  | { kind: 'sleep' } | { kind: 'wake' } | { kind: 'number'; n: number };
export function quickReply(text: string, opts?: { expectNumber?: boolean }): Quick | null;
```

The whole utterance must match after lowercasing and stripping punctuation. English and
Estonian word lists live in this file. Numbers: digits, words one to twenty, ordinals first to
tenth, "number two", "option two", Estonian üks to kümme. With `expectNumber` (mode `choosing`)
common recogniser homophones also count: to and too are 2, for is 4, won is 1, ate is 8.

## 10. Preview

```ts
// preview.ts
export type Segment = { kind: 'same' | 'del' | 'ins'; text: string };
export type PreviewRow =
  | { status: 'same';    block: Block; number: number }
  | { status: 'changed'; block: Block; number: number; segments: Segment[] }
  | { status: 'removed'; block: Block; number: number }   // deleted, or the old place of a moved block
  | { status: 'added';   block: Block };                  // inserted, or the new place of a moved block
export function buildPreview(doc: Doc, ops: Op[]): PreviewRow[];   // ops that fail give all-'same' rows
```

Rows keep the numbers of the current document, so what the user sees while deciding matches
what they said. A text change is shown as one span: the shared start, what goes, what comes,
the shared end (`diffSegments`). One span reads better as a confirmation than an interleaved
word diff. `added` rows sit after the nearest preceding block that did not move.

## 11. Speech

```ts
// recognizer.ts
export interface Recognizer {
  start(): void;
  stop(): void;
  setLang(lang: string): void;         // 'en-US' | 'et-EE'
  readonly supported: boolean;
}
export interface RecognizerHandlers {
  onUtterance(text: string): void;
  onInterim(text: string): void;
  onError(message: string): void;
}

// assembler.ts
export interface Assembler { final(text: string): void; activity(): void; dispose(): void }
export function createAssembler(opts: { holdMs: number; onUtterance(text: string): void }): Assembler;
```

Chrome ends a result on a short silence, so a pause to think splits one sentence into two
finals. The assembler holds a final for `holdMs` (1200) and joins it with what follows; any
interim activity restarts the hold. A final that is a quick reply on its own, with nothing
held, is released at once so yes and no stay instant. The recogniser restarts itself when
Chrome ends the session, except after an error the user is shown and must act on (microphone
blocked or missing, speech service unreachable, language unsupported): then it stops until it is
turned on again. Chrome runs one recognition session for the whole browser: a second tab that
starts listening ends the first tab's session with `aborted`. Three sessions aborted in a row
mean another tab keeps taking the recogniser, so this one stops and says so; the tab that
asked last keeps the microphone. The interpreter is language-agnostic; only the recogniser
has a language.

## 12. Server

`interpret(request, client)`:

1. Check the request with `InterpretRequestSchema`.
2. Build one user message: the numbered document (`#3 id=b3 h2: Summary`), then the pending
   proposal or the question being answered when present, then the utterance.
3. Call the model with four strict tools and `tool_choice: { type: 'any', disable_parallel_tool_use: true }`,
   so the answer is exactly one tool call. Thinking is off. Timeout 20 s, one SDK retry.
4. Map the tool input to an `Intent`, check it with `IntentSchema`, then check it against the
   document (`problemWith`): every id exists, `applyOps` succeeds, `ask_which` has two or more
   candidates and every quote is an exact substring of its block.
5. On a failed check, send the error back as a `tool_result` with `is_error` and ask once more.
   A second failure becomes `not_understood`. The user sees that nothing changed.
6. `refusal` and `max_tokens` stop reasons become `not_understood`.

Tools: `propose_edit`, `ask_which`, `navigate`, `not_understood`. Model: `claude-haiku-4-5`,
chosen for latency and cost, overridable with `UTLE_MODEL`. Haiku 4.5 accepts forced tool use
and strict tools. Models that reject forced tool use (Fable 5.1, Opus 5.5) are not supported
by this server without changing step 3.

Prompt rules given to the model: make the smallest edit that satisfies the request; never
touch text the user did not mention; `find` must be an exact and unique substring of its
block; prefer spellings found in the document when a word sounds like one (recognisers
mishear names); ask which one when two or more places fit; treat an utterance that arrives
with a pending proposal as a correction and return the complete revised proposal; write the
summary in the user's language in one short sentence.

## 13. Error handling

| Failure | Where caught | What the user sees |
|---|---|---|
| Model proposes an op that does not apply | server check, then reducer check | "Nothing changed", mode restored |
| Model returns no tool call or a malformed one | server | `not_understood` |
| Anthropic API down, rate limited, or 5xx | server, typed SDK errors | "The assistant is unreachable. Yes, no and undo still work." |
| Request slower than 25 s | client abort | same message |
| A response arrives after the state moved on | reducer, `seq` | nothing |
| Microphone denied or unsupported browser | recogniser | typed box stays usable, a line says why |
| Another tab keeps taking speech recognition | recogniser, three `aborted` sessions in a row | the microphone turns off here, a line says to close the other tab |
| Empty utterance | reducer | nothing |

## 14. Testing

| Layer | What proves it |
|---|---|
| `ops` | Unit tests for every op and every error code. Property: `applyOps` never mutates its input. |
| `preview` | Unit tests per row status. Property: `buildPreview` never changes the document. |
| `quickReply` | Table tests in English and Estonian, including homophones only under `expectNumber`. |
| `session` | The mock-up's twelve-line script as one scenario with scripted intents. Stale response, request failure, undo, asleep. |
| `assembler` | Fake-timer tests: joined across a pause, quick reply released at once, activity extends the hold. |
| `server/interpret` | Fake client: valid call passes, bad `find` triggers one retry, two failures give `not_understood`, API error maps to a code. |
| Whole product, live | `npm run smoke`: the script through the real model, printing each intent and the final document. |
| Whole product, in the browser | Typed input driven in Chrome on localhost, screenshots looked at. |
| Voice | Ralf, with a headset. Not verifiable by the builder. |

Gate: `npm run check` runs typecheck, lint, tests and build. All four green before "done".

## 15. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | React 19, Vite, TypeScript strict, Tailwind 4, Vitest | The house stack. No component library: four components. |
| D2 | API hosted as a Vite dev-server plugin | One command runs everything. A production host is not needed for a demo on localhost, where the microphone is allowed. |
| D3 | Plain-text blocks | Formatting adds a second document model for no demo value. |
| D4 | Undo is a stack of whole documents | Documents are a few kilobytes. Inverse ops are a source of bugs. |
| D5 | Effects are data returned by the reducer | The whole conversation logic runs in tests without a browser, a microphone or a model. |
| D6 | Chrome's built-in recognition first | Free and no key. The `Recognizer` interface lets a paid recogniser replace it. |
| D7 | zod for both directions of the wire | The model's output is untrusted input. |
| D8 | One-span diff written here, no `diff` package | The preview wants a single contiguous change, which is twenty lines and fully tested. Reversed from the first draft. |
| D9 | Haiku 4.5 by default | Sub-second answers matter more than depth for single-sentence edits. The smoke test decides whether it is good enough. |
| D10 | No persistence | Reload resets to the sample document, which is what a demo wants. |
| D11 | Rehearsal mode (`npm run rehearse`) | Scripted answers checked by the same document validation. Lets the interface be exercised and the pitch rehearsed with no key, and covers a network failure at the venue. The interface says when it is on. Added during the build. |

## 16. Open questions for the room

- Where does editing break in the Danish fieldwork: accuracy, moving around, correcting, formatting?
- Is Chrome's Estonian recognition usable, or is a paid recogniser needed?
- Which repair words does a person with lived experience actually reach for?

## 17. State of the build, 2026-10-05

| Thing | State |
|---|---|
| Core, server and speech units | 269 tests pass. |
| Interface | Walked in Chrome on localhost in rehearsal mode with typed input: preview, yes, no by key, move, which-one, repair, insert, navigation, undo, sleep, read aloud, stop, help. |
| Voice path without a person (M3) | The scripted recogniser played the demo hands-off from page load to asleep: three edits standing after an undo, 45 words, 0 hands. Its first line is sent as two finals with a silence between and arrived as one utterance. |
| Voice check | Ran in scripted mode: 3 of 41 words wrong, 7.3 percent, from the three slips written into the script. Real recognition is not measured yet. |
| Design (section 19) | Looked at in the dark theme only: listening, preview, which-one, focus, help, voice check. The light theme has not been looked at. Timing was not observed: the automation tab is hidden and Chrome throttles its timers. |
| Live model (`npm run smoke`) | Not passed. The Windows user-level `ANTHROPIC_API_KEY` is rejected: `401 authentication_error: API key is invalid`. Ralf is looking into the key. Until the smoke passes, the prompt and tool schemas are unproven against a real model. |
| Real voice | Not tested. Needs a person with a microphone in Chrome: the voice check gives the number. |
| Read aloud | Speaks through the browser. Confirmed that Chrome started speaking and that stop ended it; not listened to. |
| The paper stays white | Decided during the build: the sheet keeps white paper and dark ink in the dark theme, so the red pencil, the blue pencil and the highlighter keep their meaning. Section 19's dark column for Sheet is superseded by this. |

## 18. Voice without a model (M3)

The model is one of three tiers that turn an utterance into an action. Each tier is tried in order and the first that answers wins.

| Tier | Where | Answers | Network |
|---|---|---|---|
| Quick reply | `core/quickReply.ts` | yes, no, a number, undo, stop, help, sleep, wake | none |
| Local command | `core/localIntent.ts` | moving through the document, reading aloud, deleting a paragraph by number | none |
| Interpreter | `server/interpret.ts` | everything else | model |

A local command returns the same `Intent` the interpreter would, so the reducer treats both alike and edits still need yes. Only a whole utterance can be a local command. A sentence that merely starts like one goes to the interpreter.

Reading aloud is an effect. `navigate` with `readAloud` sets `reading` and emits `speak`; a heading reads its whole section. While reading, any handled utterance emits `hush` first. The recogniser stays open during reading so that stop can be heard, which is why reading can never be allowed to produce an edit by itself: an utterance heard while reading stops the reading and is then handled as usual, and the user is expected to wear a headset.

The assembler releases at once anything the hook marks as instant (a quick reply or a local command on the current document), looking through the recogniser's alternatives while nothing is held. Everything else waits for the hold so a pause does not split a sentence.

Hands-free start: the first visit needs one click, because browsers require a gesture to grant the microphone. After that the page starts listening by itself when permission is already held and the microphone was on last time.

Proof without a person: `speech/scripted.ts` is a recogniser that replays a script with realistic timing, including a mid-sentence silence. `?voice=demo` plays the demo hands-off. The voice check scores real recognition against the demo lines with word error rate (`core/wer.ts`), per language, so "is Chrome's Estonian good enough" becomes a number.

## 19. Design

**Subject.** A copy desk, operated by voice. The vernacular is proofreading and captioning: a red pencil for what goes, a blue pencil for what comes, a yellow highlighter for "which of these", a change bar in the gutter, and captions for what was heard.

**Two parts.** The document is the whole screen: text straight on the ground, no sheet and no box. Ütle itself is one bar fixed to the bottom, holding the wordmark, your words and its answer. The bar is the part that could later float over any program.

**The one bold thing.** The two dots of the ü are the listening light. They are hollow when the microphone is off or Ütle is asleep, solid red when listening, and they swell with the voice. Everything else stays quiet.

**Colour.** The house palette shared with EFS. Colour marks the exception only.

| Role | Light | Dark |
|---|---|---|
| Ground | #F7F5F0 | #0E0F11 |
| Ink | #141517 | #ECE9E2 |
| Soft ink | #5C625F | #A19F97 |
| Hairline | #E6E3DA | #26292E |
| Strong hairline: the top of the bar, the typed box | #C9C5B8 | #34383F |
| Red pencil: removed text, the listening dots | #B3261E | #F2857C |
| Blue pencil: added text, focus, links | #1A5FB4 | #6FA8F0 |
| Highlighter: candidates, with ink #141517 in both themes | #FFE04A | #FFE04A |

**Type.** Atkinson Hyperlegible Next for everything. It was drawn for the Braille Institute for readers with low vision, which is the reason it is here. Weights 400, 600 and 800. Paragraph numbers use tabular figures. Sizes: 13 controls, 14 margin notes, 18 document, 30 title, 16 heard and 22 answer in the bar, 26 wordmark. Sentence case everywhere.

**Layout.** One text column of at most 40rem, left-aligned, with the wordmark in the same gutter as the paragraph numbers.

```
 English  Eesti          minutes-5-october.docx      Microphone  Voice check
 ---------------------------------------------------------------------------
        1   Minutes: supplier onboarding
        2   Attendees: ...                             Changes
        6 | ... to finance by Thursday Friday.         Budget: Thursday becomes Friday
                                                       Say undo to take the last one back.
 ---------------------------------------------------------------------------
            Change the budget deadline to Friday
     ütle   Budget: Thursday becomes Friday. Say yes or no.        Yes  No
```

While you speak, your words stand beside the wordmark; once understood they move to the small line above and the answer takes their place. The margin stays empty until there is a change or help to show. The typed box lives in the bar; it is the fallback, not the product. Mock: `docs/mocks/`.

**Rules.** No cards, no rounded panels, no all-caps labels, no monospace labels, no gradient, no icon set. A rule or a fill appears only where it carries a state: the change bar, the highlight, the focus mark.

## 20. M4: Estonian first, a local recogniser, the browser and messages (2026-10-05)

Decided after talking to a user with a motor disability. His words: typing messages is slow; he wants to move around the browser by voice; Estonian, not English. This section is the frame. Each of the three parts below is filled in by the lane that builds it, under its own heading (20.1, 20.2, 20.3).

**What changes.**

| Part | Decision |
|---|---|
| Language | Estonian is the default language of recognition, of the interface and of what Ütle says back. English stays selectable. |
| Recognition | TalTech's `streaming-zipformer-large.et-en` (MIT, Estonian and English in one model) runs on this machine through `sherpa-onnx-node`, inside the dev server. No audio leaves the laptop. Chrome's recognition stays as the fallback. Replaces decision D6. |
| Browser | A web page cannot open tabs or touch another site, so a Chrome extension does it. The page and the extension speak the contract in `src/browser/protocol.ts`, which is the source of truth for both sides. |
| Where Ütle sits | In its own narrow window beside the browser window, so the microphone, the captions and the repair loop are always visible. The extension opens and docks it. |
| Messages | A message is written and repaired in Ütle, where say, see, repair works. Sending puts the finished text into the site's message box. Ütle never edits inside another site's text box. |

**Rules that follow.**

- Browser commands that only move (tabs, history, scrolling, numbers) are local: no model call and no yes. They are reversible.
- Sending a message leaves the machine and cannot be taken back, so it always shows who and what and waits for yes.
- `src/browser/protocol.ts` is pure types and constants. `src/core/**` may import it. The extension does not import from `src/`; it follows the file by hand, and a change to the contract changes both in one commit.
- The local recogniser's server never logs audio or text.
- Messenger's page is not ours and cannot be tested without a logged-in person. Everything site-specific is best effort and says so when it fails; the numbered labels are the fallback that works on any page.

### 20.1 The local recogniser

TalTech's `streaming-zipformer-large.et-en` runs inside the dev server through `sherpa-onnx-node`. It hears Estonian and English with one model, so `setLang` changes nothing on this engine. No audio leaves the laptop.

**Where the model lives.** `models/streaming-zipformer-large.et-en/` in the repository root: `encoder.int8.onnx` (155 MB), `decoder.int8.onnx`, `joiner.int8.onnx`, `tokens.txt`. `models/` is gitignored. `npm run model` downloads the missing files from `https://huggingface.co/TalTechNLP/streaming-zipformer-large.et-en/resolve/main/<file>`. The model is loaded once, when the dev server starts listening, and shared by every connection. The native addon is loaded with `createRequire` from `server/asr*.ts` only, so the browser bundle and `npm run build` never contain it.

**Wire.** A websocket at `/api/asr` on Vite's own http server; only upgrades to that path are taken, so Vite's HMR socket is untouched. Types and constants are in `src/speech/asrProtocol.ts`.

| Direction | Frame | Meaning |
|---|---|---|
| browser to server | binary | Mono audio, 16 kHz, 32-bit float little-endian samples, about 100 ms per frame. At most 1 s per frame; anything else is ignored. |
| server to browser | `{"type":"ready"}` | The model is loaded; send audio. Sent once per connection. |
| server to browser | `{"type":"unavailable","reason":"model_missing" \| "addon_missing" \| "load_failed"}` | This machine cannot recognise; the server closes the socket. |
| server to browser | `{"type":"partial","text":"..."}` | What is heard in the current utterance so far. Sent when it changes. |
| server to browser | `{"type":"final","text":"..."}` | The utterance ended. The stream is reset for the next one. |

**Audio.** The browser opens the microphone with echo cancellation and noise suppression, runs it through an `AudioContext` at 16 kHz (the browser resamples) and an `AudioWorklet` (`public/asr-worklet.js`) that posts 1600-sample frames.

**Endpoint rule.** sherpa's endpoint rules, with modified beam search: an utterance ends after 1.0 s of silence once something was heard (rule 2), after 2.4 s of silence with nothing heard (rule 1, which sends no final), or at 30 s of speech (rule 3). A final then goes through the same assembler as Chrome's (section 11), so a pause to think still joins two finals, but with a hold of 700 ms (`LOCAL_HOLD_MS`) instead of 1200: the endpoint has already waited 1 s of silence. The hold is kept longer than `INSTANT_SETTLE_MS`, so a quick reply that follows a held final joins it instead of overtaking it. Measured on the fixture sentence, the final arrives about 1.6 s after speech ends, so the app acts about 2.3 s after it.

**Quick replies do not wait for the final.** When nothing is held and a partial is a quick reply (`isInstant`) that stays unchanged for 650 ms (`INSTANT_SETTLE_MS`, chosen to be longer than the roughly 620 ms between the model's partials, so a reply that goes on, such as "ei, mitte kolm, vaid neli", is seen growing before it could be released; a one-word reply therefore acts about 1.4 s after speech ends), the client releases it as the utterance at once. The final for those same words is then swallowed on the client: when the next final's words (lower case, punctuation removed) start with the released words, only the words after them are delivered, and a final that does not start with them is delivered whole. Nothing is sent to the server. A partial that grows past the quick reply before the settle time is not released. Measured on a recorded "Jah.", the first partial reading "jah" arrives about 0.77 s after speech ends, so it is released after about 1.1 s instead of about 2.1 s. The model updates partials only about every 0.62 s, so a reply followed by more words within about 0.6 s can be released before the growth is seen; the words after it then arrive as their own utterance. The model often hears the same breath a little differently in its final ("saada" becomes "saadake", "keri alla" becomes "keri alla ja"); the command has already run, so a final no more than one word longer than the released words is taken as that breath and dropped, whatever its words.

**Fallback.** `src/speech/pick.ts` tries the local recogniser first. When the server says `unavailable`, when the socket cannot be opened, or when a lost connection fails to come back after three tries 500 ms apart, it switches to Chrome's recogniser in the current language, keeps the microphone on, and shows one line through `onNotice`: the user does nothing. It does not try the local recogniser again until the page is reloaded.

**What the server logs.** Load time, the reason it is unavailable, connection counts and error codes. Never audio, never text.

### 20.3 Commands, messages and the gaze target

**Language.** A fresh profile is Estonian: recognition `et-EE`, the interface, every line Ütle shows, and the sample document (`sampleDoc('et')`, the same minutes in Estonian with the same ids). The session carries `lang: 'et' | 'en'` and sends it to the interpreter as `lang`, which tells the model which language to write summaries, questions and messages in (prompt section "Reply language"). Every string the user can read lives in one table, `src/core/strings.ts`, keyed by language, so a native speaker proofreads one file. Switching language while the session is untouched (no edits, no draft, listening) also swaps the sample document.

**Order of the tiers** (extends section 18). Each utterance is tried in this order and the first that answers wins:

1. Quick reply (section 9). Exception: while numbered labels are showing in the browser (`hints`), a bare number clicks that label instead of focusing a paragraph, except in `choosing`.
2. Message commands: start, send, drop.
3. Local document command (`localIntent`).
4. Local browser command (`browserIntent`).
5. Message dictation (an empty draft only) or the interpreter.

**Ambiguity rule.** The document wins: an utterance that is a document command on the current document stays one ("ava eelarve", "järgmine", "eelmine", "go back"). A browser command must name the browser (a tab word, a site from the table or an address, page, search, scroll, numbers) or be a fixed phrase with no document meaning ("mine tagasi", "edasi", "laadi uuesti"). So "järgmine" is the next paragraph and "järgmine vaheleht" the next tab; "ava eelarve" opens the Budget heading and "ava messenger" the site; English "go back" stays the previous paragraph and the browser's back is "page back" or "go back a page". Only whole utterances match, as in section 18.

**Browser phrase table.** Text is lowercased, punctuation dropped except dots inside an address, and "punkt" or "dot" between words becomes a dot.

| Command | Estonian | English |
|---|---|---|
| `newTab` | ava uus vaheleht, uus vaheleht, ava vaheleht | new tab, open a new tab |
| `closeTab` | sulge vaheleht, sulge see vaheleht, pane vaheleht kinni | close tab, close this tab |
| `switchTab next / previous` | järgmine vaheleht, eelmine vaheleht | next tab, previous tab |
| `switchTab {index}` | kolmas vaheleht, vaheleht kolm, vaheleht number 3, mine kolmandale vahelehele | tab three, third tab, go to tab 3 |
| `goTo` | ava X, mine X, mine lehele X, ava leht X | open X, go to X |
| `goTo` (search) | otsi X | search X, search for X |
| `history` | mine tagasi, tagasi, eelmine leht; mine edasi, edasi, järgmine leht | page back, go back a page, previous page; go forward, forward, next page |
| `reload` | laadi uuesti, lae uuesti, värskenda | reload, refresh, reload the page |
| `scroll` | keri alla, keri üles, lehe algusesse, keri algusesse, lehe lõppu, keri lõppu | scroll down, scroll up, scroll to the top, scroll to the bottom |
| `showHints` | näita numbreid, näita numbrid | show numbers, show hints |
| `hideHints` | peida numbrid, peida numbrid ära | hide numbers, hide hints |
| `clickHint` | vajuta viis, vajuta 5, klõpsa viis; a bare number while labels show | click five, press 5; a bare number while labels show |

X is a site name or an address. Site names: messenger, facebook, gmail, google, youtube, postimees, delfi, err, linkedin, cv.ee, cvkeskus (also "cv keskus"), töötukassa. An address is a word with a dot and a top-level domain ("postimees.ee"), opened as `https://` plus the address. A search opens `https://www.google.com/search?q=` plus the words. Anything else after "ava" or "mine" is not a browser command and goes on to the interpreter.

Browser commands are local, need no yes and leave the document, the proposal and the question as they are. The reducer emits `{ type: 'browser', seq, command }`; the hook sends it through `src/browser/bridge.ts` and dispatches `{ type: 'browserResult', seq, command, result }`, which sets one short line: on success what happened (the tab's title when the extension gives one), on failure a plain reason; `no_extension` says to install the Ütle extension and reload the page. A result whose `seq` is not the latest is ignored. `showHints` that succeeds sets `hints`; `clickHint`, `hideHints` and any command that changes the page clear it.

**Bridge client.** `sendCommand(command)` posts a `BridgeRequest` with a fresh id on the window and resolves the `BridgeResponse` with the same id. Messages from another source, with another id, or malformed, are ignored. Only `ping` uses the short `BRIDGE_TIMEOUT_MS`; no answer is `{ ok: false, code: 'no_extension' }`. Before any other command the bridge pings once (again after a failed command) and does not post the command when the ping goes unanswered. The command itself may load a page or a conversation first, so it waits up to `BRIDGE_COMMAND_TIMEOUT_MS` (20 s); no answer then is `failed` with the message `timed_out`, shown as "the browser did not answer in time". When the `insertText` of a send times out, the message may already have gone, so the line says to look at the conversation before sending again; the draft is kept. While a command is in flight the line says what is being done. Window and timers are injected, so it is tested without a DOM. `?bridge=fake` installs an in-page fake extension that answers every command with success, for demos without the extension.

**Messages.** A message is a document of its own, the draft.

| Phrase (Estonian / English) | Result |
|---|---|
| kirjuta sõnum Marile, uus sõnum Marile, sõnum Marile / message Mari, write a message to Mari, new message to Mari | Start a draft to Mari |
| uus sõnum, kirjuta sõnum / new message, write a message | Start a draft with no recipient |
| kirjuta Marile, et ... / write to Mari that ..., tell Mari that ... | Start a draft to Mari with the text after "et" or "that" proposed |
| saada, saada ära, saada sõnum / send, send it, send the message | Ask to send |
| katkesta sõnum, loobu sõnumist / cancel the message, drop the message | Drop the draft |

States and transitions while a draft is open (`draft` is set; the modes are those of section 8 plus `confirmingSend` and `sending`):

| From | Event | To |
|---|---|---|
| listening, confirming, choosing, no draft | start | The document, its history, its log and focus are saved in the draft; an empty document is shown with the recipient; `listening`. With one-breath text, `confirming` with that text proposed. |
| any, draft open | start | Message: a message is already open; say send or cancel the message |
| listening, empty draft | any other utterance that is not a command | `confirming` with the utterance proposed as the draft's text, no model call |
| listening, draft with text | any other utterance | the interpreter, with `message: { to }` in the request; the prompt says the document is a message being written, and that plain words are text to add |
| confirming | anything | as section 8: yes applies, no drops, other words repair |
| confirming | send | Message: say yes or no first |
| listening, empty draft | send | Message: the message is empty |
| listening | send | `confirmingSend`: shows who and what, waits |
| confirmingSend | yes, or key confirm | `sending`, effect `openConversation{name}` (skipped without a recipient), then on success `insertText{text, submit: true}` |
| confirmingSend | no, or key reject | `listening` with the draft |
| confirmingSend | any other utterance | stays, asks for yes or no |
| sending | `insertText` succeeds | The saved document comes back with its history; message: sent |
| sending | any step fails | `listening` with the draft kept; message: the reason |
| sending | utterance | Message: one moment |
| listening, confirming, confirmingSend | drop | The saved document comes back; the draft is gone |

Undo inside a draft undoes the draft's own edits. Sleep keeps the draft. The text sent is the draft's blocks joined with a space, so a line break never presses Enter early.

**What needs yes.** Edits to the document or the draft, and sending. Browser commands and starting or dropping a draft do not.

**The name rule.** Estonian names arrive in the allative ("Marile", "Jaanile", "Märdile"). The page strips a final "-le" from the last word and capitalises the first letter: Marile becomes Mari, Jaanile becomes Jaani, Märdile becomes Märdi. The extension matches the name fuzzily against the conversation list, so Jaani still finds Jaan as a prefix. Known limit: names whose stem changes (Mart, Märdi; Peeter, Peetri) may not match; the extension then answers `not_found`, the draft stays, and the numbered labels are the fallback. English names are sent as heard.

**The gaze target.** A microphone control of at least 96 by 96 pixels sits in the bar, always visible, with `data-listening` true or false and a filled or hollow state. Clicking toggles listening. Resting the pointer on it for `DWELL_MS` (1000 ms) toggles it without a click: a fill grows over that second, leaving cancels it, and after it fires it does not fire again until the pointer has left and come back. A click during the same hover after the dwell fired is ignored, and a click before it cancels the dwell, so a setup that also has dwell-click turned on toggles once, not twice. The Yes and No controls shown in `confirming` and `confirmingSend` have the same size and the same dwell. The logic is one piece, `src/ui/dwell.ts`, tested with fake timers.

**Scripted demo.** `?voice=demo` speaks Estonian: one document edit, a new tab, Messenger, a one-breath message to Mari, one repair, yes, send, yes, sleep. `?voice=demo&bridge=fake` plays it to the end without the extension.

### 20.2 The extension

`extension/` is a Manifest V3 Chrome extension in plain JavaScript with no build step (load it unpacked). It implements the extension side of `src/browser/protocol.ts` and nothing else; it does not import from `src/`.

**Parts.**

| File | Runs in | Job |
|---|---|---|
| `relay.js` | the Ütle page (content script on `http://localhost/*` and `http://127.0.0.1/*`) | Relays BridgeRequests to the service worker and posts BridgeResponses back. |
| `background.js` | the service worker | Finds the target tab, runs tab commands, injects the page script for the rest, docks Ütle. |
| `page.js` | the target tab (injected on demand) | Scroll, numbered labels, inserting text, opening a conversation. |
| `sites.js` | the target tab, injected before `page.js` | Every site-specific selector (Messenger) in one object, so a person can adjust it in a minute. |
| `options.html` | the options page | The Ütle address, default `http://localhost:5173`. |

**The relay.** The content script accepts a window message only when it comes from its own window (`event.source === window`), from its own origin, and its data has `source: 'utle-app'`, a numeric `id` and a `command` with a `kind`. Everything else is ignored, including the extension's own answers. The service worker then checks that the sender's origin is exactly the origin of the configured Ütle address; any other localhost page gets no answer at all, as if no extension were installed. The answer is posted with `source: 'utle-extension'` and the request's `id`, to the page's own origin.

**The target tab.** Commands act on the active tab of the most recently focused ordinary (`normal`) browser window that is not the window the request came from. The service worker keeps a most-recently-focused list of window ids in session storage; when it knows nothing, it takes any ordinary window other than the sender's. Ütle's own window is never a target: when docked it is a popup window, and in any case it is the sender's window. No such window: `no_target`. `newTab` opens in the target window and so becomes the target. Pages an extension may not script (`chrome://`, `chrome-extension://`, `about:`, the Chrome Web Store, and any page where injection fails with an access error) answer `not_allowed` with a plain sentence. `newTab` and `goTo` accept only `http` and `https` addresses. Tab commands that navigate wait for the tab to finish loading (at most eight seconds) and answer with the resulting `tab: {title, url}`. Chrome skips history entries made without a user gesture, which includes every navigation the extension makes, so when `tabs.goBack` refuses, `history` runs the page's own `history.back()`; if the address does not change, the answer is `not_found`.

**Numbered labels.** An element is actionable when it matches one of: `a[href]`, `button`, `input` (not hidden), `textarea`, `select`, a `contenteditable` root, `role` button, link, tab, menuitem, option, checkbox or textbox, or an `onclick` attribute; and is not disabled. It is visible when it has a non-empty box that intersects the viewport, `checkVisibility` (visibility, opacity, content-visibility) passes, and a hit test at its centre (or one of four inner points) lands on the element or inside it, so things under a dialog are skipped. An element nested inside another actionable element with nearly the same box is the same target and gets no second number. Labels are small black-on-yellow numbers in a shadow-DOM layer positioned in document coordinates, so they scroll with the page. A label sits outside its element so the element's text stays readable: left of it, else above, right or below, taking the first spot inside the viewport that covers no other element or label, else the spot that covers least; it sits on the element's corner only when no outside spot fits in the viewport. They stay until `clickHint`, `hideHints`, a new `showHints`, or a navigation (a real one unloads the page; a same-document one fires the Navigation API's `navigate` event, which removes them). `clickHint` focuses a text field (input, textarea, contenteditable) and puts the caret at the end; anything else gets pointer and mouse down/up events and then `click()`.

**Inserting text.** The box is looked for for up to 3 s (`BOX_TIMEOUT_MS` in `page.js`), because composers render late. It is the focused editable element; else, on the messaging site, the composer named in `sites.js`; else the visible `contenteditable` with `role="textbox"` lowest on the screen (where composers live), else a visible textarea, else a visible text input. The text goes in with `document.execCommand('insertText')`, which fires a real `beforeinput` and `input`, so framework editors (React, Lexical) take it as typing and the text arrives once. If the command is refused, an input or textarea gets its value through the native setter and an `input` event, and a contenteditable gets a dispatched `beforeinput`. `submit` then dispatches `keydown`, `keypress` and `keyup` for Enter; if the box still holds the text after a moment, it clicks the site's send button when `sites.js` names one, or submits the input's form.

**Opening a conversation.** It always happens on the messaging site. When the target tab is elsewhere, a tab of the messaging site in the same window becomes active; with none, the target tab goes to the messaging home (`https://www.messenger.com/` in `sites.js`, overridable with the stored `messagingHome`, as the test does). Names are compared lower-cased with diacritics removed (`Märt` matches `mart`). Score: whole name equal 100; every spoken word equal to a word of the name 80; every spoken word a prefix of a word 60; contained anywhere 40; every spoken word sharing with a word of the name a prefix of at least 3 letters that is at least all but the last two letters of the shorter word 20. The last tier exists because the page strips only the final "-le" from Estonian names, which leaves the genitive stem: `Jaani` matches Jaan, `Märdi` Märt, `Peetri` Peeter. Highest wins, ties go to the shorter name, then the first on screen. Candidates are the conversation links named in `sites.js`, then, if none match, every visible link, list item, row or option. The search repeats for up to 4 s (`FIND_TIMEOUT_MS`), because the list renders after load. Nothing matches: `not_found`, and when no conversation list is on screen at all the message says the site may need logging in. After the click the service worker waits up to 3 s (`SETTLE_TIMEOUT_MS` in `background.js`) for the address to change, then for the page to load, then 500 ms more (`SETTLE_QUIET_MS`) for the page to swap its composer. If the clicked link pointed somewhere else and the address did not move, the answer is `failed`, so the app never types into the conversation that was open before. The settle waits live in the service worker rather than the page because a real navigation would unload the page script mid-wait.

**The dock.** The toolbar button opens Ütle in a popup window, 440 px wide and full height at the left edge of the work area of the display under the current window, and moves the current browser window to fill the rest. A second click finds the existing popup showing the Ütle origin and focuses it. Ütle is a top-level page there, so microphone permission works as in a tab.

**Best effort, and says so.** Everything about Messenger's markup (`sites.js`) is unverified until a logged-in person tries it. Synthetic Enter is not a trusted key press; a site that checks `isTrusted` will not send, which is why the send-button fallback exists. Hit testing cannot see elements inside cross-origin iframes or closed shadow roots, so those get no number.

## 21. In-page mode: writing inside the site itself (2026-10-05, replaces the separate window)

The owner cancelled the shape in section 20 the same day it was built. His words: "The message, corrections, everything should be easily done within the messenger or whatsapp window, the voice control should be able to be used within browser to scroll pages or switch tabs." Section 20's separate Ütle window, the dock and the draft-then-send flow are dropped. What section 20 built underneath is kept: the local recogniser (20.1), the extension's tab, scroll, number and message-box commands (20.2), the Estonian phrases and strings (20.3).

**The picture.** He is on WhatsApp Web (or Messenger, or any page). A strip drawn by the extension sits at the bottom of that page: a large microphone target for the eye tracker, the words being heard, and one line saying what was done. He speaks; the words appear in the site's own message box. He says a correction; the text in the box changes. He says "saada"; the site sends it. He says "keri alla" or "järgmine vaheleht"; the browser does it. Nothing else is on screen.

**Where things run.**

| Part | Where | Why |
|---|---|---|
| Microphone, recogniser client, the session | An extension offscreen document | One microphone and one session for the whole browser; they survive switching tabs and pages. A content script would lose both on every navigation. |
| Speech model | The dev server on this machine, `ws://localhost:5173/api/asr` (20.1) | Unchanged. |
| The strip | A content script in the page in front, in a closed shadow root | It must be where he is looking. |
| Reading and changing the message box, tabs, scrolling, numbers | The extension (20.2), extended with `readBox`, `setText`, `pressSend` in `src/browser/protocol.ts` | The page's own box is the editor now. |
| Deciding what an utterance does | `src/core/inpage.ts`, pure | Same rule as the rest of the core: testable without a browser. |

**Rules.**

- An utterance that is a command acts; anything else is dictation and is added to the message box. A mistaken dictation is visible in the box and "võta tagasi" removes it.
- Nothing is sent until he says "saada". The box is the preview, so sending needs no second yes.
- Repairs work without the model: "mitte kolm, vaid neli", "kustuta viimane sõna", "kustuta kõik", "võta tagasi". Model-backed repair of the box text comes after, when a working key exists.
- "puhka" stops everything being typed; "ärka üles" resumes. The strip shows which.
- Extension code is TypeScript bundled by `npm run ext` into `extension/dist/`, so it imports `src/core` and `src/speech` instead of copying them.
- The section 20 page at localhost stays as a development harness and the voice check; it is not part of what he uses.

### 21.1 What an utterance does

`inpageStep(session, utterance, box)` in `src/core/inpage.ts` decides; the extension runs the commands it returns in order and reports the first failure, or the last success, to `inpageResult`, which gives the line for the strip. Phrases are matched on the whole utterance, lowercased with punctuation dropped, in either language whatever the session's language; the lines are in the session's language and live in `src/core/strings.ts` (`inpage`).

**Order.** The first rule that matches wins.

1. Asleep: only the wake phrase does anything (it wakes); everything else is ignored with a line saying Ütle is resting. Awake, a sleep phrase puts it to sleep.
2. While numbered labels show (`hints`), a bare number ("viis", "5", "number viis") is `clickHint`.
3. Send.
4. Undo ("võta tagasi").
5. Repairs of the box text.
6. Conversations, including the one-breath form.
7. Browser commands: the table of 20.3 (`browserIntent`) plus the bare words below.
8. Everything else is dictation.

**Sleep and wake.** Sleep: puhka, ära kuula, maga / sleep, go to sleep, stop listening. Wake: ärka üles, ärka / wake up, start listening.

**Conversations.**

| Phrase (Estonian / English) | Commands |
|---|---|
| ava vestlus Mariga, ava Mari vestlus, kirjuta Marile, sõnum Marile, kirjuta sõnum Marile / open chat with Mari, open the conversation with Mari, message Mari, write to Mari | `openConversation{name: 'Mari'}` |
| kirjuta Marile, et ma jõuan homme kell kolm / write to Mari that ..., tell Mari that ... | `openConversation{name}`, then `setText{'Ma jõuan homme kell kolm.'}`. It does not send. |
| uus sõnum, kirjuta sõnum / new message (no name) | Nothing; the line asks for the name. |

The name rule of 20.3, plus the comitative: the last word loses "-le" (Marile, Mari) or "-ga" (Mariga, Mari; Jaaniga, Jaani), and every word is capitalised. Pronouns are not names: "kirjuta mulle" (mulle, sulle, talle, meile, teile, neile, endale) is dictation. Opening a conversation (and anything else that changes the page in front) empties the undo list, because the earlier texts belong to another box; the one-breath form then pushes the empty text, so "võta tagasi" clears what it typed.

**Send.** saada, saada ära, saada sõnum, saada see / send, send it, send the message: `pressSend`. An absent or empty box: no command, the line says there is nothing to send. No second yes: the box is the preview. A successful send empties the undo list.

**Repairs.** None uses the model. Each emits one `setText` with the whole new text and pushes the old text onto `undo` (at most 30 entries, the oldest dropped). With no box: no command, the line says to pick a text field.

| Phrase (Estonian / English) | What happens to the box text |
|---|---|
| mitte X, vaid Y; mitte X vaid Y; X asemel Y; asenda X sõnaga Y / not X but Y; replace X with Y; change X to Y | The last occurrence of X (case-insensitive, whole words, X and Y may be several words) becomes Y. When the replaced text began with a capital letter at a sentence start, Y does too. "X asemel Y" is a repair only when X and Y are at most two words each (longer is a sentence being dictated), and because "asemel" takes the genitive ("kolme asemel neli"), a one-word X that is not found also matches a word it extends by one or two letters (kolme finds kolm). X not found: no command, the line quotes X. |
| kustuta viimane sõna / delete the last word | The last word goes, with the punctuation attached to it. |
| kustuta viimane lause / delete the last sentence | Everything after the last sentence end (. ! ? or a line break) before the final one goes. |
| kustuta kõik, tühjenda, alusta uuesti, katkesta sõnum / delete everything, clear, start again, cancel the message | The box is emptied. |
| uus rida, reavahetus / new line | A line break is appended. |
| punkt, koma, küsimärk, hüüumärk / full stop, period, comma, question mark, exclamation mark | As the whole utterance only: the mark is appended, replacing a mark already at the end. Inside dictation the words stay words (the recogniser punctuates). |
| võta tagasi / undo, undo that | The newest text on `undo` is put back. It leaves `undo` when that `setText` succeeds (in `inpageResult`), so a failed undo loses nothing. Nothing there: the line says so. |

An empty box makes the word, sentence and mark repairs say the box is empty.

**Browser.** Everything in the 20.3 table. The ambiguity rule of 20.3 existed because a document came first; in this mode there is no document, so bare words go to the browser: "tagasi" / "back", "go back" are `history back`; "edasi" / "forward" are `history forward`; "järgmine" / "next" and "eelmine" / "previous" are `switchTab next / previous` (the tab is what he moves between; pages have "tagasi" and "edasi"). "Võta tagasi" stays undo. `hints` stays true only after `showHints`, `scroll`, `ping`, `readBox`, `setText` and `pressSend`, which do not remove the labels (20.2); every other command clears it, and a failed `showHints` clears it in `inpageResult`.

**Dictation.** Anything else is appended to the box text with one `setText`; the old text is pushed onto `undo`. With no box (`present` false): no command, the line says to pick a text field ("näita numbreid" and the number) or open a conversation.

- Joining: nothing between when the old text is empty or ends with a line break; otherwise one space (trailing spaces of the old text are dropped first).
- Continuing a sentence: when the utterance starts with a joining word (ja, ning, ega, või, aga, kuid, vaid, sest, et, kui / and, or, but, because, so, that) and the old text ends with a full stop, that full stop is dropped and the utterance continues the sentence; before aga, kuid, vaid, sest, et, but and because a comma takes its place, as Estonian punctuation wants. This is what makes "Ma jõuan homme kell neli." plus "ja võtan koogi kaasa" one sentence; a sentence that should start with "Ja" can be fixed with "punkt" first, which is rare in a chat message.
- First letter: capitalised when the box is empty or the old text ends a sentence (. ! ? … or a line break). Otherwise the recogniser's capital is lowered, except when the word cannot be a plain word: it has a capital after its first letter (ERR, iPhone), it is English "I" or starts with "I'", or the same word with the same capital already stands in the box in the middle of a sentence (a name he has used, such as "Mari").
- Final full stop: added only when the utterance has more than two words and ends without punctuation (. ! ? … , : ;).

**Instant.** `inpageInstant(session, utterance)` is true for everything rules 1 to 7 recognise except the one-breath form, and for everything while asleep (it is ignored, so there is nothing to join). It is false for dictation, for the one-breath form (a sentence a pause may split) and for an empty utterance. A bare number is instant only while labels show.

**Results.** `inpageResult` maps the result code, never the extension's message text. Success: `pressSend` says "Saadetud." and empties `undo`; `setText` says it is done; `openConversation` names the conversation; tab and navigation commands give the tab title (20.3 `browserDone`); `showHints` gives the label count. Failure: the failed command is taken to be the first of the step (only the one-breath form has two, and when `openConversation` fails `setText` never ran); `not_found` names the conversation, the number or the box; `no_target` says no browser window was found; a timed-out `pressSend` says the message may or may not have gone. `undo` stays true to the box: a step whose `setText` text equals the newest `undo` entry was an undo, and that entry is removed when it succeeds; any other step with a `setText` pushed the old text, and that entry is removed when the step fails. A repair that would leave the text as it is emits nothing, so the two cannot be confused.

### 21.2 The extension in in-page mode

The extension is the whole product. Nothing opens a window or a page for him to work in; the one extension page that ever opens is the microphone permission page, once, during setup.

**Parts.** Source is TypeScript in `extension/src/`, bundled by `npm run ext` (esbuild, `scripts/ext.ts`) into `extension/dist/`, which is gitignored; `extension/manifest.json` points at `dist/`. Load the `extension/` folder unpacked after `npm run ext`. `npm run check` typechecks `extension/src` and runs the build.

| File (`extension/src/`) | Runs in | Job |
|---|---|---|
| `background.ts` | the service worker | Target tab, tab commands, `runInPage`, the offscreen document, the strip state, the permission page, the relay for the localhost harness. |
| `offscreen.ts`, `engine.ts` | the offscreen document (`offscreen.html`, reason `USER_MEDIA`) | Microphone, recogniser client (`src/speech/local.ts` with an explicit address), the `InpageSession`, the utterance loop. |
| `content.ts`, `strip.ts` | every http and https page (content script, top frame only) | The strip, in a closed shadow root, and making room for it. |
| `page.ts`, `sites.ts` | the page in front, injected on demand | Scroll, numbers, the message box (`readBox`, `setText`, `pressSend`, `insertText`), opening a conversation. |
| `permission.ts` | `permission.html`, an extension tab | Asks for the microphone, then closes itself. |
| `options.ts` | the options page | The Ütle harness address and the speech address. |

`extension/relay.js` stays plain JavaScript: it relays the section 20 localhost page's BridgeRequests, which remain a development harness.

**The engine and its message flow.** One offscreen document for the whole browser, created once (when listening is first turned on) and kept; it holds the microphone and the session, so neither is lost when he switches tabs or pages.

1. The strip (or the toolbar button) sends `utle-toggle` to the service worker.
2. The service worker creates the offscreen document if there is none and forwards `toggle` to it.
3. The offscreen engine starts or stops `createLocalRecognizer` against `ws://localhost:5173/api/asr` (the stored `asrUrl` overrides; the test uses 5193). `inpageInstant` is its `isInstant`.
4. Every change (listening, heard words, the line, a problem) goes to the service worker as `utle-state`; it writes `stripState` to `chrome.storage.session` (opened to content scripts), and every strip renders from that key, so the strip of whichever tab is in front shows the same state.
5. For each utterance the engine has the service worker run `readBox`, calls `inpageStep(session, utterance, box)`, runs the returned commands in order through the service worker's command executor (`utle-run`), stopping at the first failure, calls `inpageResult` with that failure or the last success, and publishes the line. Utterances are handled one at a time, in order.
6. Commands act on the active tab of the most recently focused ordinary window (section 20.2's rule; the offscreen document has no window of its own).

The engine takes `initialInpage`, `inpageStep`, `inpageResult` and `inpageInstant` as a dependency: `offscreen.ts` passes `src/core/inpage.ts`; the end-to-end test builds `extension/test/standin-offscreen.ts` instead, with a stand-in of the same signatures.

**Failure is said plainly.** When the speech server cannot be reached, the recogniser gives up on the first refused connection (20.1: no retries before the server has ever answered), listening turns off, and the strip shows one Estonian line saying the speech model is not reachable. Turning listening on again tries once more. When the microphone is refused, the strip says so and the permission page opens.

**The permission page.** An offscreen document cannot show a permission prompt. `permission.html` opens in a tab on install, and again whenever turning listening on finds the microphone refused. It calls `getUserMedia`; once granted it stops the stream, tells the service worker (which starts listening if he had asked for it) and closes its own tab. A helper does this once during setup.

**The strip.** A fixed bar across the bottom of the viewport, 128 px high, in a closed shadow root on `<utle-strip>` at the end of `<html>`, with its own opaque dark background and white and yellow text, so it reads the same on light and dark pages. Left: the microphone control, 104 by 104 px, three states (listening: filled, "Kuulan"; not listening: hollow, "Ei kuula"; resting while the session is asleep: "Puhkan"). Click toggles; resting the pointer on it for 1 s toggles too, with a fill growing over that second (`src/ui/dwell.ts`: leaving cancels, no refire until the pointer has left). Pressing it does not take focus from the page's text field. Right: the words heard right now (26 px; after an utterance, the last utterance stays until new speech), and one line (20 px): a problem when there is one, else what was understood or done. Strings are in `src/core/strings.ts` under `strip`.

**Making room.** The strip must never cover the site's composer, which on WhatsApp and Messenger sits at the bottom of a full-height app. Two steps: (1) a page style gives `html` a content-box height of `100% - 128px` and 128 px of bottom padding, which shrinks every layout built on percentage heights and lets a scrolling page scroll its last 128 px out from under the strip; (2) once a second, if the page's message box (the `readBox` order) reaches under the strip, its outermost ancestor that is as tall as the viewport (a `100vh` app) gets an inline height of `calc(100vh - 128px)`. Elements a site fixes to the bottom of the viewport can still be covered.

**The three commands** (page side, `page.ts`). The box is found in the existing order: the focused text field, else the site's composer (`sites.ts`), else the lowest visible textbox, textarea or input.

- `readBox`: `{present, text}` at once, no waiting. Text is the field's value, or a contenteditable's `innerText` without trailing line breaks.
- `setText`: waits for the box like `insertText`, selects everything inside it (`select()` for a field, a range over its contents in a contenteditable), then types the text through `execCommand('insertText')` line by line. Between lines it dispatches a `beforeinput` of type `insertLineBreak` (what Shift+Enter produces, which Lexical takes), falling back to `execCommand('insertLineBreak')` when no editor handles it; a textarea gets `\n` typed. So a Lexical editor registers every change, and a line break never reaches the Enter handler that sends. Where an editor cancels the native edit and applies it in its own update (Lexical over a selection), the text is checked again 30 ms later before any fallback, so nothing is typed twice. An empty text selects all and deletes. Fallbacks as `insertText` (native value setter; `beforeinput`). Answers with the box read back.
- `pressSend`: `failed` when the box is empty. Otherwise Enter; if the text is still there after 500 ms, the site's send button; with none, the field's form. Answers `ok` with the box once it is empty (up to 2 s), else `failed`.

**Sites.** `sites.ts` holds one entry per messaging site, each selector on its own line marked verified or unverified. Which entry applies to a page: the stored `siteOverrides` (address prefix to site name; the test maps fixture pages to `whatsapp`), else each entry's `isHere`, else the stored `messagingHome`'s origin (Messenger, as section 20.2's test does).

WhatsApp Web, read from a logged-in page with no chat open (verified): the chat list `#pane-side [role="grid"][aria-label="Chat list"]`, each chat a `[role="row"]` named by the `title` of its first `span[title]`; the search field `#side input[role="textbox"][aria-label="Search or start a new chat"]`; no `#main` and no editable box before a chat is opened. Unverified (no chat was opened): the composer `#main footer div[contenteditable="true"][role="textbox"]` (Lexical), the send button `#main footer button[aria-label="Send"]` or the button around `[data-icon="send"]` / `[data-icon="wa-wds-send"]`, the open chat's name `#main header span[title]`, and whether a synthetic Enter sends.

**openConversation on WhatsApp.** WhatsApp does not change its address when a chat opens, so the page waits instead: it matches the name (section 20.2's score) against the visible rows' names; with no match it types the name into the search field and waits up to 4 s for a matching row; it opens the row with pointer and mouse events, then waits up to 3 s for a composer and for the open chat's name to be the row's name, and answers `settled`, which tells the service worker not to wait for an address change. The messaging home for routing is whichever of WhatsApp or Messenger is already open in the window (WhatsApp first), else the stored `messagingHome`, else `https://web.whatsapp.com/`.

**Removed.** The dock and the companion window. The toolbar button now turns listening on or off (and opens the permission page when the microphone is refused).

### 21.3 After the first real use: live words, one bar everywhere, misheard commands (2026-10-05)

The owner used it on WhatsApp Web. It worked, and he named three faults.

| His words | Cause | Change |
|---|---|---|
| "there were delays on the voice and it wasn't very natural how the text appeared" | Dictation reached the box only after the endpoint silence (1 s) plus the hold (0.7 s), and all at once. | Words are typed into the box while he speaks: `inpagePreview` in `src/core/inpage.ts` gives the box text for each partial, and null while the words may still be a command. The hold after a final is short in this mode. |
| "When you have no tabs open, you can't see the text box anywhere ... There needs a constant bar that can show you the text that is being heard" | Chrome lets no extension draw on its new-tab page, so the strip vanished there. | The extension provides the new-tab page itself, with the same strip and large tiles for the known sites. The strip shows the words being heard at all times while listening. |
| "I said 'Mine whatsappi' but the thing saw 'Mina whatsappi' so it didn't work" | Commands matched exact words and bare site names. | A short utterance that is one letter away from a command is taken as that command, and site names are understood with their Estonian case endings. The strip says what it took it to be. |

#### What the core decides

**The preview.** `inpagePreview(session, partial, box)` is called on every partial with the box as it was before the utterance began. It returns the whole box text to show: the earlier text joined with the partial by the dictation join rules of 21.1 (separator, capital, the joining-word rule), except that no closing full stop is added, because the sentence is not finished. So for the same words, `inpageStep`'s `setText` is the last preview, or that plus ".". It returns null, and nothing is typed, when the session is asleep, the box is not present, the partial is empty, or the partial may still be a command. When a preview turns back to null (the words grew into a command), the extension puts the earlier box text back.

**When a partial may still be a command.** Any one of:

1. It is a command now: anything `inpageStep` would not dictate, including the one-breath form (its text belongs to another conversation's box), a bare number while labels show, and a command reached by the endings or the one-letter rule below.
2. It is one word. Any word may be the X of "X asemel Y", and most single words start a command.
3. Its words are the first words of a fixed command phrase (the 21.1 and 20.3 tables, the send, sleep, wake and undo phrases), where each word may also be one letter off (the one-letter rule below) and the last word may be the start of the phrase's word ("sulge vahe" for "sulge vaheleht").
4. It is the start of a pattern command that is not complete yet: "mitte", "not", "asenda", "replace", "change" followed by at most four words and optionally "vaid", "but", "sõnaga", "with", "to"; one or two words then "asemel"; "ava", "mine", "open", "go", "go to", "mine lehele", "ava leht", "ava vestlus", "chat with", "write to", "tell", "message" followed by at most two words; "vajuta", "klõpsa", "click", "press" with or without "number"; "kirjuta", "saada", "sõnum", "uus sõnum" (each optionally followed by "sõnum") followed by at most two words, or by a name ending in "-le" and then "et" (the one-breath form), except when the first word after them is a pronoun (mulle, sulle, talle, meile, teile, neile, endale); "tell X that", "write to X that".

"otsi" followed by anything is a complete search command (20.3), so a partial starting with "otsi" never previews. Once a partial has outgrown every command it could have been ("Saada mulle", "Mine sa homme poodi" at its fourth word), it previews.

**Site names with endings.** `browserIntent` matches a site name as it stands, else with one Estonian case ending removed (-isse, -sse, -ile, -le, -is, -it, -i, -s, -t; an apostrophe is dropped first, so "youtube'i" is "youtubei"), when at least three letters are left. Stems that change are extra rows of the site table ("postimehe" for Postimees), as are the usual mishearings of WhatsApp (vatsap, vatsapp, whats app, whatsup, votsap).

**The one-letter rule.** When an utterance of two to four words is not a command as it stands, each word of at least four letters is tried against the command vocabulary (every word of the fixed phrases, the site names and the pattern verbs) at edit distance 1, or 2 for words of eight letters or more (a letter changed, added, dropped, or two neighbours swapped), and each pair of neighbouring words is tried joined into one ("vahe leht" is "vaheleht"). One word is corrected at a time. When the corrected utterances that are commands all mean the same command, it is that command, and the line starts with what it took it to be (`Sain aru: „mine whatsappi“.`); the line for the endings rule says the same. Two different commands possible: dictation.

**Its limits.** A single word is never corrected (one word has too little around it to tell "kama" from "koma"). A heard word that is a vocabulary word plus a verb ending (-n, -d, -b, -s, -me, -te, -vad, -ma, -sin, -sid, -nud) is not corrected: "otsin sind", "kustutan kõik", "võtan tagasi" and "kirjutas Marile" are sentences about doing it, not misheard commands. The free-text patterns are not reached by a correction: "otsi", "mitte", "vaid", "asemel", "asenda" and "sõnaga" (and the English "search", "not", "but", "replace", "with", "change") are left out of the vocabulary, because what follows them is any text.

**Never corrected.** Send ("saada", "send"), sleep and wake, and undo. A message sent or silence broken by mistake cannot be taken back, and undo throws away the text in the box with no way to redo it. These words are not in the vocabulary, and a correction that would end in one of them is dropped: "saadan", "sada", "puhkan" and "ärkan" are dictation.

#### What the extension does

**Live dictation in the engine** (`extension/src/engine.ts`). An utterance begins with its first non-empty partial. The engine then reads the message box once (`readBox`, queued after any earlier utterance's commands) and keeps it as the utterance's **base**. On every partial it calls `inpagePreview(session, partial, base)`: a text is typed into the box with `setText`; null types nothing, and if a preview of this utterance is already in the box (the words have turned into a possible command), the base is typed back. At most one `setText` is in flight: partials that arrive while the page is still typing only replace the wanted text, and when the page answers the engine types the newest one, skipping those in between. When the utterance arrives, the engine waits for the typing in flight, then calls `inpageStep(session, utterance, base)` with the base, never the box as it reads now (which holds the preview). If the step has no `setText` (a command, or nothing) and a preview is in the box, the base is typed back first; then the commands run as in 21.2. Turning the microphone off in the middle of an utterance types the base back too. The strip shows the words heard on every partial, whatever the preview says. On the page side, `setText` whose text only adds to what the box holds (no line break in the added part) puts the caret at the end and types just the added words, so a growing preview never blanks the box; anything else goes the 21.2 way (select all, delete, type).

**The short hold.** In this mode every final can be appended to the box on its own, so the assembler need not wait to join it with the next one: the offscreen engine gives the local recogniser `holdMs` of 150 ms (`INPAGE_HOLD_MS`) instead of `LOCAL_HOLD_MS` (700 ms, unchanged for the localhost page). Two finals within 150 ms still join. A pause to think now ends one utterance and starts the next; with the join rules of 21.1 the box reads the same.

**The heard words.** While listening, the strip's upper line (26 px) shows the words of every partial, and the last utterance stays there until new speech replaces it, also across tabs and pages; the lower line says what was done.

**The strip on every page, from the start.** The content script runs at `document_start`, so the strip is there while the page loads. It is mounted once per document and survives same-document navigations (`pushState`, which do not reload the content script). If a page removes it, the once-a-second check puts it back. A page restored from the back/forward cache reads the state again on `pageshow`, so it shows what is true now.

**The new-tab page.** Chrome lets no extension draw on its own new-tab page, so the extension replaces it (`chrome_url_overrides.newtab` -> `newtab.html`). It shows the same strip (the same `mountStrip`, the same state in `chrome.storage.session`, the same microphone control), and above it a grid of large tiles, one per site in `SITES` of `src/core/browserIntent.ts` (one per address, WhatsApp first), each at least 96 px high with the site's name in large type. Clicking a tile, or resting the pointer on it for 1 s (the strip's dwell), opens the site in this tab. The WhatsApp tile opens the stored `messagingHome` when one is set (the test points it at a fixture). The service worker cannot inject scripts into an extension page, so `newtab.html` loads `dist/page.js` itself, and for a target tab showing the new-tab page the service worker sends page commands (`scroll`, `showHints`, `clickHint`, `readBox`, ...) as a runtime message `utle-page-run` with the tab's id; the page whose `chrome.tabs.getCurrent()` id matches runs it through the same `__utle.run` and answers. Tab commands and `goTo` work on it as on any tab. So "näita numbreid" numbers the tiles and a number opens that tile in the same tab.

**Where nothing can be drawn.** `chrome://` pages other than the new tab (settings, extensions, history), the Chrome Web Store, `view-source:`, the PDF viewer, and other extensions' pages. The extension does not try; the strip comes back on the next ordinary page, and commands there answer `not_allowed` (21.2). They are listed in `extension/README.md`.

## 22. M7: understanding by meaning (2026-10-05 evening)

The plan is `docs/plans/2026-10-05-m7-understanding.md`. The contract (protocol, `src/core/pageIntent.ts`) is in the commits before this section; each lane adds its own subsection.

### 22.3 The server: `POST /api/intent`

`server/intent.ts`, mounted next to `/api/interpret` in `server/vitePlugin.ts`. The body is an `IntentRequest` (`src/core/pageIntent.ts`), checked with `IntentRequestSchema`; a bad body is `400 { error: { code: 'bad_request' } }`. One `messages.create`: the default model `claude-opus-5-5` (`UTLE_MODEL` overrides it, for `/api/interpret` too), `max_tokens: 400`, `output_config: { effort: 'low' }`, one strict tool `answer` whose input schema mirrors `IntentAnswer` (discriminated on `kind`, every command kind enumerated, `additionalProperties: false`, every property required, `null` where the core has an optional field such as `newTab.url`), `tool_choice: auto` with `disable_parallel_tool_use` (the models reject a forced choice with strict tools, so the system prompt says to always call the tool), timeout 7 s, no retry. The system prompt (`server/intentPrompt.ts`) is fixed text, English instructions with Estonian examples, so the API caches it; the user turn is the request as compact lines, items as `id. [role] text`.

The reply's `answer` call has its `null`s dropped and goes through `pageIntentFrom(intent, request)`. `null` from that, a text-only reply, a refusal or `max_tokens` all answer `200 { intent: { kind: 'unclear', say: STRINGS[lang].inpage.notUnderstood }, say: '' }`: the model never gets a second try, a voice command answers at once. Errors use the `InterpretError` codes and statuses of `/api/interpret`; a `401` or `403` from the API, or no `ANTHROPIC_API_KEY` at all, is `502 { error: { code: 'upstream_rejected', message: 'no_key' } }`. `GET /api/status` adds `intent: 'live' | 'no_key'` (`no_key` when the environment has no key) so the strip can say in one line that free-form understanding is off. Every `/api/*` answer carries `Access-Control-Allow-Origin: *` and answers `OPTIONS` with 204, because the extension's offscreen document calls from a `chrome-extension://` origin.

The log line is `[intent] kind=<kind> ms=<n>` or `[intent] error=<code> ms=<n>`, never the utterance or the page. `server/intent.test.ts` covers it with a fake client; `npx tsx scripts/intent-eval.ts` runs 28 Estonian utterances against fake YouTube, WhatsApp, Google and new-tab pages through the real model and prints pass or fail with the latency per case (needs a key).
