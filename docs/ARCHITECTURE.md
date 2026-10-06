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
| server to browser | `{"type":"lag","ms":N}` | Decoding is N ms behind the audio received; audio was dropped to catch up (23.1). `0` once caught up. |
| browser to server | `{"type":"flush"}` (text) | End the utterance now: the server decodes what it holds, sends its final, and resets the stream (23.1). |

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

**Order.** The first rule that matches wins. Since round 5 two rules come before the list, in `inpageStep` itself: "katkesta" and its kin (the global cancel, 25.2), asleep or not; then, in an armed one-line form field (`box.single`), the form keys of 25.1 ("valmis", "edasi" are Tab, "kinnita", "logi sisse" are Enter), whatever the box holds.

1. Asleep: only the wake phrase does anything (it wakes); everything else is ignored with a line saying Ütle is resting. Awake, a sleep phrase puts it to sleep.
2. While numbered labels show (`hints`), a bare number ("viis", "5", "number viis") is `clickHint`.
3. Send.
4. Undo ("võta tagasi"), then "tagasi" / "back" (section 22).
5. Repairs of the box text, then typing at the caret ("kirjuta siia vahele X", the Editing table below).
6. Conversations, including the one-breath form.
7. Browser commands: the table of 20.3 (`browserIntent`, which also holds the fixed editing phrases of the Editing table) plus the bare words below.
8. The editing patterns with a word or a count ("mine sõna X ette", "kustuta kolm tähte"; the Editing table).
9. Everything else is dictation.

A command whose phrase names a word ("vali X", "mine X juurde", "kustuta sõna X") is a command only when X stands in the box (as spoken, or as a word X extends by one or two letters: "kooli" for "kool"); otherwise the words are dictation, which the engine sends to the model (section 22): "mine sisukorra juurde" may name a part of the page. The soft words of section 22 are checked at the same point.

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

**Editing** (round 3, the edit lane). The caret, a selection, typing at the caret and the editing keys, as a keyboard would do them, inside the box in front. None uses the model. The fixed phrases live in `browserIntent.ts` (`FIXED`); the forms with a word, a count or free text are patterns in `inpage.ts` (`EDITING`, `TYPE_AT_CARET`). All of them need a box that is `present`: the armed field, else the field he or the page focused, else the site's composer (what `readBox` reports, 21.2); with none the line is `pickField`. Being armed is not required: the page side acts on the armed field, else the focused text field, else the box in front (`editTarget` in `page.ts`, 23.5). Counts are digits or number words (`spokenNumber`, to the thirties); the page caps a count at 50.

| Phrase (Estonian / English) | Command | Needs |
|---|---|---|
| mine algusesse, teksti algusesse, mine teksti algusesse / go to the start, go to the beginning, start of the text | `caret{start}` | a box |
| mine lõppu, teksti lõppu, mine teksti lõppu / go to the end, end of the text | `caret{end}` | a box |
| rea algusesse, mine rea algusesse / start of the line, line start, go to the start of the line | `caret{lineStart}` | a box |
| rea lõppu, mine rea lõppu / end of the line, line end, go to the end of the line | `caret{lineEnd}` | a box |
| lause algusesse, mine lause algusesse / start of the sentence, sentence start, go to the start of the sentence | `caret{sentenceStart}` | a box |
| lause lõppu, mine lause lõppu / end of the sentence, sentence end, go to the end of the sentence | `caret{sentenceEnd}` | a box |
| sõna tagasi, üks sõna tagasi / word back, one word back, back a word, back one word; N sõna tagasi / N words back | `caret{wordBack}`, N times | a box |
| sõna edasi, üks sõna edasi / word forward, one word forward, forward a word, forward one word; N sõna edasi / N words forward | `caret{wordForward}`, N times | a box |
| mine sõna X ette, sõna X ette, sõna X juurde, enne sõna X, mine X juurde, mine X ette (X one or two words) / go before X, go to before the word X | `caret{find: X, where: before}` | a box holding X |
| mine sõna X taha, sõna X taha, sõna X järele, pärast sõna X, mine X taha / go after X, go to after the word X | `caret{find: X, where: after}` | a box holding X |
| vali kõik, vali kogu tekst / select all, select everything | `select{all}` | a box |
| vali see sõna, vali sõna / select the word, select this word | `select{word}` (the word at the caret, else the one before it) | a box |
| vali see lause, vali lause / select the sentence, select this sentence | `select{sentence}` | a box |
| vali see rida, vali rida / select the line, select this line | `select{line}` | a box |
| vali viimane sõna / select the last word, select last word | `select{lastWord}` | a box |
| vali viimane lause / select the last sentence, select last sentence | `select{lastSentence}` | a box |
| vali sõna X, vali X (X one or two words) / select X, select the word X | `select{find: X}` | a box holding X |
| kustuta sõna X / delete the word X, delete word X | `select{find: X}`, then `pressKey{Backspace}`; the line names the word | a box holding X |
| kirjuta siia vahele X, kirjuta vahele X, lisa siia vahele X, lisa siia X, sisesta siia X, sisesta X / insert X, insert here X, type here X, add here X | `typeText{X}` (a closing full stop is dropped; spacing and the capital are worked out on the page, 23.5) | a box |
| kustuta täht, kustuta üks täht, kustuta tagant, kustuta valitud, kustuta see / delete a letter, delete one letter, delete the letter, delete the selection, delete selection, delete this, backspace; kustuta N tähte / delete N letters | `pressKey{Backspace}`, N times | a box |
| kustuta ees, kustuta eest, kustuta järgmine täht / delete forward, delete the next letter, delete next letter | `pressKey{Delete}` | a box |
| vasakule, üks vasakule, üks täht vasakule / arrow left, go left, one left, one to the left; N korda vasakule, vasakule N korda, N tähte vasakule, N vasakule / N times left, left N times, go left N times, arrow left N times | `pressKey{ArrowLeft}`, N times | a box |
| paremale, üks paremale, üks täht paremale / arrow right, go right, one right, one to the right; the same count forms | `pressKey{ArrowRight}`, N times | a box |
| üks rida üles, rida üles / line up, one line up, arrow up; N rida üles / N lines up | `pressKey{ArrowUp}`, N times | a box |
| üks rida alla, rida alla / line down, one line down, arrow down; N rida alla / N lines down | `pressKey{ArrowDown}`, N times | a box |
| tee uuesti / redo, redo that | `pressKey{Redo}` | a box |
| järgmine väli, mine järgmisele väljale / next field, go to the next field | `pressKey{Tab}`: the next focusable element in page order; a text field reached this way is armed, as a real Tab arms it | nothing (Tab leaves the box) |
| Round 5, forms: valmis, olen valmis, edasi, järgmine väli / done, next, next field | `pressKey{Tab}` (25.1): the next field, whatever the box holds; "edasi" is history forward everywhere else | an armed one-line field (`box.single`) |
| Round 5, forms: kinnita, sisesta, enter, logi sisse, saada vorm, esita vorm / confirm, submit, log in, login, sign in, submit the form, send the form | `pressKey{Enter}` (25.1): the page submits the form as a real Enter would; "kinnita" and "enter" are the soft Enter of 22 everywhere else | an armed one-line field |
| Round 5, forms: numbritena, numbrid, numbritega, kirjuta numbritena / as digits, in digits, write as digits | `session.spell = 'code'` (25.1): dictation is written as digits with no spaces until "tavaliselt"; no command, the line says "Kirjutan numbritena." | nothing |
| Round 5, forms: tavaliselt, tähtedena, sõnadena, kirjuta tavaliselt / normally, as words, in words | `session.spell = null`: dictation is written for the kind of field in front again; "Kirjutan tavaliselt." | nothing |
| Round 5, forms: kirjuta kood X, sisesta e-post X, kirjuta telefon X, kirjuta number X, kirjuta parool X / type code X, enter email X, write phone X | `setText` with X converted for that kind of field, this utterance only (25.1); a command in its own right, never asked of the model | an armed box |

What the commands do to the session: `typeText`, Backspace, Delete and "kustuta sõna X" push the old box text onto `undo` (so "võta tagasi" puts the whole text back, as after a repair), and `inpageResult` drops that entry when the step fails; the caret, a selection and the arrows push nothing. The editing commands stay in the box in front, so they leave the labels and the undo list as they are; Escape, Enter and Tab leave the box (a dialog closes, a form submits, the focus moves), so they clear both, as every other page change does. A repeated command ("kolm sõna tagasi") is that many copies of one command, run in order and stopped at the first failure.

What is never reached by a correction (21.3, 23.4): the forms with a word or free text ("vali X", "mine X juurde", "kustuta sõna X", "kirjuta siia vahele X") and every key, so "pane kinn" is not Escape and "vali kõigi" is not select all; the words of the free-text patterns (vahele, lisa, insert, juurde, ette, taha, järele, pärast, enne, before, after) are left out of the vocabulary. The fixed caret and selection phrases ("mine algusesse") can be reached. "Vasakule", "paremale" and the other one-word editing phrases are not soft words: while he writes, "vasakule" moves the caret. The live preview (21.3) holds back a partial that could still become one of these: "mine", "enne" or "pärast" followed by "sõna" and up to three words, "mine" and one or two words, "vali" and up to two, "kustuta" and one, "kustuta sõna" and up to two, anything starting "kirjuta siia", "lisa siia", "sisesta siia", "insert", "type here", "add here", "go", "select", "go before", "go after", "vasakule", "paremale", "left", "right" with up to two words, and one or two words followed by "korda", "rida", "sõna", "tähte", "times", "line(s)", "word(s)" or "letter(s)".

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
| `background.ts` | the service worker | Target tab, tab commands, `zoom` (round 5: `chrome.tabs.getZoom` and `setZoom` through a step table; text and layout grow together and Chrome keeps the level per site), `runInPage`, the offscreen document, the strip state, the permission page, the relay for the localhost harness. |
| `offscreen.ts`, `engine.ts` | the offscreen document (`offscreen.html`, reason `USER_MEDIA`) | Microphone, recogniser client (`src/speech/local.ts` with an explicit address), the `InpageSession`, the utterance loop, the chain of goals (24.1). |
| `content.ts`, `strip.ts` | every http and https page (content script, top frame only) | The strip, in a closed shadow root, and making room for it. |
| `page.ts`, `sites.ts` | the page in front, injected on demand | Scroll (a page, a little, slowly, stop; 23.4), numbers, the message box (`readBox`, `setText`, `pressSend`, `insertText`), opening a conversation, what the model sees (`readPage`, `clickItem`, `focusItem`, `siteSearch`, `media`, `clearField`, `arm`; section 22), editing inside the box (`caret`, `select`, `typeText`, `pressKey`; 23.5), the text items and `hover`, `contextMenu`, `scrollTo` (24.3). |
| `permission.ts` | `permission.html`, an extension tab | Asks for the microphone, then closes itself. |
| `options.ts` | the options page | The settings as large buttons (bar height, microphone side, bar at start, listening mode, gaze target, speech model; 23.3; the owner's voice, 24.2), and under "Täpsemalt" the Ütle harness address and the speech address. |

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

- `readBox`: `{present, text}` at once, no waiting. Text is the field's value, or a contenteditable's `innerText` without trailing line breaks. Since M7 the `BoxState` also carries `armed` (section 22), `kind` (composer, search, field, none) and `label` (the placeholder, aria-label, title or `<label for>` text, 60 characters); since round 5 every `<input>` is `single: true` with a `fieldKind` (email, tel, code, number, password or text, from `fieldKindOf` in `box.ts`, 25.1; a search box stays kind `search` with fieldKind text), and a textarea or a contenteditable has neither.
- `setText`: waits for the box like `insertText`, selects everything inside it (`select()` for a field, a range over its contents in a contenteditable), then types the text through `execCommand('insertText')` line by line. Between lines it dispatches a `beforeinput` of type `insertLineBreak` (what Shift+Enter produces, which Lexical takes), falling back to `execCommand('insertLineBreak')` when no editor handles it; a textarea gets `\n` typed. So a Lexical editor registers every change, and a line break never reaches the Enter handler that sends. Where an editor cancels the native edit and applies it in its own update (Lexical over a selection), the text is checked again 30 ms later before any fallback, so nothing is typed twice. An empty text selects all and deletes. Fallbacks as `insertText` (native value setter; `beforeinput`). Answers with the box read back. Round 5: a one-line `<input>` is never previewed, so it is always selected and replaced whole with the text as the core converted it, never typed at the end of.
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

## 22. M7: understanding what he means, and never typing where he did not ask (2026-10-05 evening)

The plan is `docs/plans/2026-10-05-m7-understanding.md`; the contract is `src/browser/protocol.ts` (the new commands, `BoxState.armed`), `src/core/pageIntent.ts` (the model's one intent, validated) and `applyIntent` in `src/core/inpage.ts`. This section is what the core decides; the extension, the server and the strip are the other lanes' sections. Where it disagrees with 21.1, this section is what is built.

**The armed box.** `BoxState` is `{present, text, armed, kind?, label?, fieldKind?, single?}` (`src/browser/protocol.ts`; `fieldKind` and `single` since round 5, 25.1). `BoxState.armed` is true only where words may go: the site's composer, or a field he picked through Ütle (`clickHint`, `clickItem`, `focusItem`, `openConversation`, `arm`). A field the page focused by itself (YouTube's or Google's search bar, WhatsApp's chat search) is `present` and not armed. In `act`, dictation, the repairs, undo and send require `present && armed`: present and not armed gives no command and the line `inpage.noPlaceToWrite` ("Ütle „kirjuta siia“ ..."); not present keeps `inpage.pickField` (send keeps `nothingToSend`). `inpagePreview` returns null for an unarmed box, so live words never land in a search bar. The one-breath form and opening a conversation never look at the box.

**`ask`.** `inpageStep` sets `ask: true` exactly when the rules took the utterance for dictation (`classify` gave `dictate`), whatever the box. The engine then asks the model (plan, "When the engine asks the model"); without a model the step stands, and with an unarmed box that step is the refusal above.

**`applyIntent(session, intent, page, say)`.** The model's intent goes through the same `act`: `dictate` is the dictation join of 21.1 (armed box only), `command` is one browser command with `browserDoing` as its line, `edit` is the repair or the undo of 21.1, `send`, `sleep` and `wake` as the rules, `unclear` is no command and the model's `say` (or `inpage.notUnderstood` when it has none). A non-empty `say` comes first: `Sain aru: „…“.` `afterCommands` treats `clickItem`, `focusItem`, `siteSearch`, `pressKey` with Escape, Enter or Tab, and since round 4 `hover`, `contextMenu` and `scrollTo`, as page changes (labels and undo cleared); `readPage`, `media`, `bar`, `arm`, `clearField`, since round 5 `zoom`, and the editing commands (`caret`, `select`, `typeText`, the other keys) leave both.

**Rules added** (no model; whole utterances, either language). All of them are instant, in the one-letter vocabulary of 21.3 and in the "may still be a command" set of the preview.

| Phrase | Command |
|---|---|
| uus leht, ava uus leht, uus aken, ava uus aken / new page, new window, open a new page | `newTab` |
| tagasi / back, go back | Undo while he is writing: the box is armed and has words, or `undo` has an entry (the words he just cleared come back). With nothing to take back the line says so; the page history is left alone while words are in the box, because leaving the page loses them. Otherwise `history back`. "Võta tagasi" stays undo, "mine tagasi" stays the page. "back" is never reached by a one-letter correction. |
| sulge / close | `closeTab` |
| peida riba, peida ütle / hide the bar; näita riba / show the bar | `bar{show: false / true}` |
| Round 5: suurenda, suurenda lehte, suumi sisse, tee suuremaks, suurem tekst, suurem kiri, tee tekst suuremaks / zoom in, bigger, make it bigger, larger text; vähenda, vähenda lehte, suumi välja, tee väiksemaks, väiksem tekst, väiksem kiri / zoom out, smaller, make it smaller; tavaline suurus, algne suurus, suumi tagasi / reset zoom, normal size | `zoom{direction: in / out / reset}`: the service worker steps `chrome.tabs.getZoom` through 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300 % (`setZoom`); reset is 100 %. Chrome keeps the level per site. The strip zooms with the page, which is intended. Keeps the labels and the undo texts. |
| kirjuta siia, siia / write here, type here; ära kirjuta siia / do not write here | `arm{on: true / false}` |
| stopp, stop, lõpeta, while the labels show | `hideHints` (without labels they stop a slow scroll, 23.4) |
| tühjenda otsing, kustuta otsing, tühjenda kast / clear the search, clear the field | `clearField` |
| sulge aken, pane kinni, välja / escape, close this; enter, sisesta, kinnita | `pressKey{Escape}`; `pressKey{Enter}` |
| otsi X / search for X | `siteSearch{query: X}` (the extension falls back to Google when the page has no search field). This replaces the Google search of 20.3, in in-page and document mode alike. |
| otsi googlest X, guugelda X, google X / search google for X | `goTo` the Google search |
| otsi youtube'ist X, otsi youtubest X / search youtube for X | `goTo https://www.youtube.com/results?search_query=X` |
| mängi, esita / play; paus, peata / pause, stop the video; vaigista, heli maha / mute; heli tagasi, heli peale / unmute; heli valjemaks, valjemaks, kõvemaks, pane heli valjemaks / louder, volume up; heli vaiksemaks, vaiksemaks, pane heli vaiksemaks / quieter, volume down; täisekraan / full screen; välju täisekraanist / exit full screen; keri edasi; keri tagasi | `media{action}` |
| Round 3: the scroll phrases (a little, slowly, stop) | `scroll{mode}` (23.4) |
| Round 3: the editing phrases | `caret`, `select`, `typeText`, `pressKey` (the Editing table of 21.1) |

**Soft words.** The one-word fixed phrases that are also ordinary words of a message (välja, siia, edasi, sulge, enter, sisesta, kinnita, paus, peata, mängi, esita / close, play, pause, forward, escape, and since round 3 the chat-reply stop words aitab, lõpeta) are the command only when the armed box is empty, unarmed or absent. With words in the armed box they are dictation (and so go to the model like any short dictation): a one-word answer into WhatsApp ("aitab") never presses Escape or Enter in the composer, closes the tab or stops a scroll; "stopp", "seis" and "stop" are not soft, so a slow scroll is always stoppable in one word. While the labels show he is navigating, not writing, so the soft words are commands whatever the box holds ("stopp" hides the labels). Phrases of two words or more ("pane kinni", "kirjuta siia", "lõpeta kerimine") are commands whatever the box.

**Numbers while the labels show.** Besides a bare number and "number N": "vajuta N", "ava N", "vali N", "open N", "choose N", digits with trailing punctuation ("12."), and Estonian number words to the thirties in `spokenNumber` (üksteist ... üheksateist, kakskümmend, kakskümmend üks ..., also heard as "kaks kümmend üks"; English "twenty one" ... "thirty"). Without labels "ava viis" and "üksteist" are dictation.

### 22.2 The engine: when the model is asked, type first, one step at a time (M7.2)

`extension/src/engine.ts`. After `inpageStep`, a step with `ask` is handled by where the words could go. How the queue keeps up when the model is slow (stale utterances, barge-in, the verification off the critical path, the lag line) is round 3's work and is in 23.2; this section is what M7.2 built and what still holds.

- **Armed box, fewer than `LONG_UTTERANCE_WORDS` words: type first, verify after.** The rules' step runs at once (the joined text is typed, its line shown), then the model is asked with the page as it is and the box text as it was *before* the utterance. The model says `dictate` or `unclear`, or cannot be reached: nothing more happens, the words stay. Anything else: the session goes back to what it was before the typing (the undo entry the typing pushed goes with it, unless a later utterance has moved the session on), one `setText` puts the earlier text back, and the model's step runs. Since round 3 this verification runs in the background and checks the box before it takes anything back (23.2).
- **Armed box, `LONG_UTTERANCE_WORDS` words or more:** dictation, never asked. The constant is 60 since round 4 (the M7 plan said 9, M7.2 made it 14): a chain of goals said in one breath is long, and with the verification off the critical path (23.2) the cost of asking is one model call, not a wait. So almost every dictation is verified; only a sentence of 60 words or more goes unasked.
- **No armed box: wait first.** Nothing was typed, so there is nothing to show yet: the line says "Mõtlen…", the model is asked, and its step runs; with no model (or when the question is given up) the rules' step runs (its line says where the words can go).

**One step at a time.** The model's answer carries `done`. While `done` is false, the engine runs the step, waits `SETTLE_MS` (300 ms; the page commands that navigate already waited for the load), reads the page again and asks again with the same utterance and `steps` (what was done, as "command clickItem 12" and so on, its say, ok or the failure line). It stops after `MAX_INTENT_STEPS` (4), after `MAX_STEP_FAILURES` (2) failed steps (a failed step is asked about once more even when the model said it was done, because it could not know the click would miss), after `INTENT_LOOP_BUDGET_MS` (15 s since the utterance arrived; was 25 s before round 3), on `unclear`, when the model cannot be reached, or when a later utterance arrives (23.2). `thinking` is shown while any question to the model is in flight (a count, since verifications overlap); the strip line is each step's say, then the last step's result.

**Limits.** Every request is clipped to what `IntentRequestSchema` takes (strip lines 200 characters, address 2000, title 300, box text 4000, 60 tabs); the engine waits `ASK_TIMEOUT_MS` (9 s, longer than the server's 7 s so a slow answer comes back as the server's 504 rather than the engine giving up first) and aborts the fetch itself at that point (`offscreenMain.askIntent` ends the request one second later still, so no fetch dangles). A step that throws is caught so the queue goes on. `recent` holds the last three lines from before the utterance, never its own typing lines.

### 22.3 The server: `POST /api/intent`

`server/intent.ts`, mounted next to `/api/interpret` in `server/vitePlugin.ts`. The body is an `IntentRequest` (`src/core/pageIntent.ts`), checked with `IntentRequestSchema`; a bad body is `400 { error: { code: 'bad_request' } }`. Since round 5 the request carries `care` (`'quick' | 'careful'`, 25.2: the effort, the token cap, the timeout and a second system block), and its `page.box` may carry `single` and `fieldKind` (25.1), which the user turn prints on the box line as `single=true fieldKind=code` and which the prompt's "Form fields" paragraph explains (a password's text is printed as dots). Since round 4 the request may carry `chain` (`IntentChain`: `original` up to 1,000 characters, `completed` and `remaining` up to 12 goals of 200 characters each, `goal`) and the answer may carry `plan` (up to 12 strings of 200 characters): the goals after the one the action serves, in his words (24.1). One `messages.create`: the default model `claude-sonnet-5-5` (since round 3; Opus 5.5 measured p50 2.7 s per command; `UTLE_MODEL` overrides it, for `/api/interpret` too), `max_tokens: 400` and `output_config: { effort: 'low' }` for a quick ask (800 and `high` for a careful one, `careSettings`, 25.2), one tool `answer` whose input is `{ intent, say, done, plan }` and mirrors `IntentAnswer` (discriminated on `kind`, every command kind enumerated, `hover`, `contextMenu` and `scrollTo` among them since round 4, `additionalProperties: false`, every property required, `done` and `plan` among them, `null` where the core has an optional field such as `newTab.url`), `tool_choice: auto` with `disable_parallel_tool_use` (the models reject a forced choice with strict tools, so the system prompt says to always call the tool), timeout 7 s (12 s careful), no retry. The tool is not strict: with this many command shapes the API answered 400 "The compiled grammar is too large" on every call (seen 2026-10-05); the schema stays closed and fully required as guidance, and `pageIntentFrom` validates every answer anyway. The tool's `scroll` carries `mode` too (null for the default), so the model can ask for a little, a slow or a stop (23.4). The system prompt (`server/intentPrompt.ts`) is fixed text of about 1,300 words, English instructions with Estonian examples, so the API caches it; the user turn is the request as compact lines, items as `id. [role] text`, the chain as `chain: 2/4`, `chain original`, `chain done`, `chain goal` and `chain next` (or `chain: none`), and the earlier steps of the utterance as `step N: <action> "<say>" -> ok` or `-> failed: <message>` (`steps: none (first ask)` on the first ask).

**M7.2, one step at a time.** The server keeps no state between asks. The prompt tells the model that the engine runs one action, reads the page again and asks again with `steps` when `done` was false; so a compound utterance ("mine youtube'i ja otsi kassivideod ja mängi esimene") answers its first action with `done: false`, a single action `done: true`, and the next ask continues from what the steps show. When the thing he named is not among the items the model answers `scroll down` with `done: false` (once; after a scroll that found nothing it uses `siteSearch` or `unclear`). A step reported `failed` gets one different way (`siteSearch` or `scroll` for a failed `clickItem`, `goTo` for a failed `switchTab`, `siteSearch` the name for a failed `openConversation`), never the identical action again; a second failure is `unclear` with the reason in one line. When the steps show everything done, the answer is `unclear` with say "Valmis". The prompt covers, by kind rather than by site: choosing among similar items (by meaning; ordinals count items of the same role in list order), names with case endings and misheard letters (`Marile → Mari`, `Peetrile → Peeter`, `Märdile → Mart`), fields to focus and then dictate into ("järgmine väli" is `unclear`, there is no Tab key), like/subscribe/follow/skip/close/consent buttons, menus and tabs, media, tabs by site name (`switchTab { query }` when one is open), hints when nothing fits, plain questions and small talk (`unclear` with a kind one-line answer, never an action), English utterances (English `say`), and the send/sleep/wake words that are never guessed ("saada see Marile" is `unclear`).

The reply's `answer` call has its `null`s dropped and goes through `pageIntentFrom(intent, request)`; `done` passes through as given, absent meaning true; `plan` is cleaned (strings only, trimmed, cut to 200 characters, empties dropped, at most `MAX_PLAN_GOALS`, 12) and left out when empty. `null` from that, a text-only reply, a refusal or `max_tokens` all answer `200 { intent: { kind: 'unclear', say: STRINGS[lang].inpage.notUnderstood }, say: '' }`: the model never gets a second try, a voice command answers at once. Errors use the `InterpretError` codes and statuses of `/api/interpret`; a `401` or `403` from the API, or no `ANTHROPIC_API_KEY` at all, is `502 { error: { code: 'upstream_rejected', message: 'no_key' } }`. `GET /api/status` adds `intent: 'live' | 'no_key'` (`no_key` when the environment has no key) so the strip can say in one line that free-form understanding is off. Every `/api/*` answer carries `Access-Control-Allow-Origin: *` and answers `OPTIONS` with 204, because the extension's offscreen document calls from a `chrome-extension://` origin.

The log line is `[intent] kind=<kind> done=<bool> plan=<n> care=<quick|careful> ms=<n>` (round 5, 25.2) or `[intent] error=<code> care=<…> ms=<n>`, never the utterance, the goals or the page. `server/intent.test.ts` covers it with a fake client (`done` passes through, the steps appear in the user turn, the schema stays strict with every property required). `npx tsx scripts/intent-eval.ts` runs about 60 cases, Estonian with a few English, against fake YouTube (watch, home, results), WhatsApp (list, armed chat), Google, Gmail (inbox, compose), a news site with a cookie dialog, a Facebook feed, an e-service form and a new tab, through the real model and the real `pageIntent`. Multi-step cases simulate the engine's loop (each step its own page, the earlier steps sent back, a step reportable as failed); a case may accept either of two answers. Round 4 adds two chain cases (YouTube: go, search, play, quieter; WhatsApp: go, Karin's last message, delete for everyone): the first ask must plan the right number of goals, each later ask gets one goal with the chain and must answer that goal alone. It prints pass or fail with the latency per ask, then p50/p95 latency and the pass rate; `UTLE_MODEL` picks the model, `UTLE_EVAL_ONLY=<text>` filters by name, utterance or site, `UTLE_EVAL_JSON=<path>` writes every result (needs a key).
## 23. Round 3 (2026-10-05, night)

The owner's list after a day of real use, in his order: speed, push-to-talk by gaze, mishearing, editing, smooth scrolling, and everything a person with no hands might need. Six lanes, one subsection each. The contract is `src/browser/protocol.ts` (`caret`, `select`, `typeText`, the keys, `scroll.mode`), `src/speech/asrProtocol.ts` (the flush frame and the lag message) and `StripSettings` in `extension/src/strip.ts`. Nothing in this section has been tried with a real voice, a real eye tracker, Soniox with a key, or Google Docs itself: it is proven with recorded fixtures, stand-in pages and unit tests.

### 23.1 The recogniser never falls minutes behind

The owner's report: "at the start it worked super well; at the end it reacted to 'open WhatsApp' four or five minutes later." The cause was an unbounded backlog. The browser sends a 100 ms frame every 100 ms, and the server decoded each one synchronously on Node's main thread, which also serves `/api/intent` and Vite. When decoding ran slower than real time (screen recording, another tab, a model call in flight), the socket's receive queue grew without limit and every utterance arrived later than the one before. Three things fix it.

**The decoder on its own thread** (`server/asrWorker.ts`, `server/asrModel.ts`). `sherpa-onnx-node` is a context-aware N-API addon: it loads inside a `worker_threads` Worker, also while the main thread holds it, and a bad config throws instead of aborting (checked on this machine). So the model is loaded and every frame decoded on a worker; the main thread forwards frames (the `Float32Array` buffer is transferred, not copied) and gets `{ text, endpoint }` back, one result per frame, in frame order. The worker's entry is `server/asrWorker.ts` itself, started by path from the project root (the server runs out of Vite's bundled config, so `import.meta.url` is no guide); Node 22.18 and later strip its types, which is what `erasableSyntaxOnly` and the `.ts` import extensions are for. When the worker cannot start (an older Node, the file missing: `load_failed` from the start, or no `loaded` within `WORKER_LOAD_TIMEOUT_MS`, 120 s), the model is loaded on the server thread instead, with the same session logic in front of it; `model_missing` and `addon_missing` are the worker's own answers and are final. The log says which: `[asr] model loaded on a worker thread in N ms` or `on the server thread`, and each connection logs `opened on the worker` or `on the thread`. If the worker dies, the next connection loads the model again. One worker serves every connection, one stream each.

**A bounded backlog** (`server/asrSession.ts`). Frames go into a per-connection queue and are decoded from a drain loop that takes one frame per turn of the event loop (`setImmediate` between frames), so even in-thread decoding gives `/api/intent` its turns. The session counts audio received, decoded and dropped. When the queue holds more than `MAX_BACKLOG_MS` (1500 ms) of audio, the oldest is dropped until `KEEP_MS` (300 ms) is left, so the delay once decoding resumes is at most that; the cut is a contiguous block from the oldest end, and when it would fall between two loud frames it moves on to the next quiet frame (RMS below `SILENCE_RMS`, 0.01) within `CUT_SEARCH_MS` (300 ms), so a word is less often spliced to another. Silence is not dropped selectively: the endpoint rule needs 1 s of trailing silence, and a server that kept only speech would never end an utterance. Each drop sends `{"type":"lag","ms":N}` with the backlog at that moment, at most every `LAG_REPORT_MS` (500 ms), and once the queue has emptied `{"type":"lag","ms":0}` follows, also no sooner than 500 ms after the last report. A flush text frame goes into the same queue, in order: the frames before it are decoded, the text so far is sent as a final (none when empty), the stream is reset, and the next frame starts a fresh utterance. Nothing is logged but counts: the close line says how many seconds were received and dropped.

**The browser side** (`src/speech/local.ts`, `src/speech/microphone.ts`). The microphone frames are `ASR_FRAME_SAMPLES` (1600, 100 ms) and a frame is dropped, never queued, when the socket is not open; stopping closes the worklet's port and the context, so nothing accumulates once the socket is gone. A frame is also dropped when `socket.bufferedAmount` exceeds `MAX_BUFFERED_BYTES` (2 s of audio: the network is not taking it), and that drop reaches `onLag` with the queue's length, then `onLag(0)` on the next frame that goes. The server's lag messages reach the same optional handler `RecognizerHandlers.onLag(ms)`. `flush()` on the local recogniser sends the flush text frame, releases a settling quick reply at once (its final is then swallowed as in 20.1), and delivers what the assembler holds without the hold (`Assembler.releaseNow`): when words are in progress and the socket is open, the server's final is moments away, so it joins what is held first and the whole goes at once; the hold timer remains as the safety net. The engine's `flush()` calls `recognizer.flush?.()`; the strip shows the lag. A stop while a flush still waits for its final (the gaze left; the server is behind, or Soniox is finalising over the network) delivers the utterance as last heard (the newest partial, joined with what is held) before the socket closes, so a release never loses the words; a partial that arrives between the flush and its final (the frames queued before the flush) does not cancel the "at once" of that final. The offscreen document stops `FLUSH_STOP_MS` (800 ms) after a flush. Without a flush, a stop drops the utterance in progress and what is held, as before (round 3 review).

Tests: `server/asrSession.test.ts` runs the drain loop by hand with a fake recogniser (a slow decode gives lag messages and a bounded backlog, the cut lands at a quiet frame, a flush gives the final and the next frame starts fresh, an asynchronous decoder keeps the frame order); `src/speech/local.test.ts` covers the lag handler, the `bufferedAmount` guard and the flush. The worker itself was run on this machine against a fake addon (two sessions, flush, endpoint) and against the real addon without the model files (it answers `model_missing` from inside the worker); with the model it is not verified without a person.

### 23.2 The engine keeps up: stale utterances, barge-in, verification off the path (ENGINE lane)

The owner's first item was speed: a command must act within about a second by the rules and about three with the model, and never drift. 23.1 keeps the recogniser from falling behind; this is what `extension/src/engine.ts` does so the model's slowness never holds the next utterance.

**Jobs.** Each utterance becomes a `Job` when it arrives from the recogniser: the utterance, `arrived` (`Date.now()`), whether the rules alone take it for a plain send (`isPlainSend`: `inpageStep` against `SEND_PROBE_BOX`, a pretend armed box with text, gives exactly one `pressSend`; the probe box is never typed into), and the flags below. One serial queue still runs the utterances in order, and the page commands of one utterance always run in order. What the queue no longer does is hold a later utterance behind an earlier one's model work.

**Stale utterances are not thought about.** When a job's turn comes more than `STALE_MS` (3 s) after it arrived, it gets the rules' step only: no question, no loop, and both of its lines carry the suffix `catchingUp` ("Jõuan järele…"). An answer minutes late would act on a page that has changed. The clock runs from arrival, so time spent waiting for a verification (below) counts.

**Barge-in.** A new utterance interrupts every earlier job at its next safe point (`interrupt`): the page command in hand finishes, no further step of a multi-step loop is asked for (`interrupted`), and the question in flight is given up (`cancelled`: the `AbortController` passed through `deps.ask(request, signal)` is aborted; `askIntent` in `offscreenMain.ts` ends the fetch with it, and `askOnce` answers null). The interrupted utterance's strip line stays what its last step said. A job still waiting its turn when a later utterance arrived is cancelled too, so it runs the rules' step and is never asked. The exception is a plain send ("saada"): it does not touch a verification that is still judging (nothing is sent while the box is being judged, so it waits for it instead), it marks every other job interrupted, and it cancels only a job that is already in its loop (`looping`, past its first step); a verification that has already found a command and is acting on it is interrupted like any other. A verification given up leaves the typed words in place. Round 4 adds two exceptions (24.1): a plain send waits behind a job that is working through a chain of goals instead of interrupting it, and a continued utterance ("siis ava Karin") interrupts nothing.

**Verification off the critical path.** Type first, verify after (22.2) now runs the verification as its own job, in the background, outside the serial queue: the next utterance is handled while the model judges the words. The verifications in flight are tracked (`pending`), and of those, the ones running page commands (`acting`). Before its turn, a plain send waits for every verification pending; any other utterance waits only for a verification that is acting, so the commands of two utterances never interleave. A verdict of `dictate` or `unclear`, no answer, or a cancellation leaves the words. A verdict of anything else first reads the box again: when it still reads as the typing left it (the rules' `setText` text), the session goes back to what it was before the typing (unless something since has moved the session on), the base text is put back with one `setText`, and the model's step runs through the same loop as a first-asked utterance; when the box has changed since (more was typed, or the page changed it), nothing is touched and the strip says `lateCommand` ("Hiljem: see oli käsk „…“, teksti ei muutnud."). `thinking` counts the questions in flight, so the dots show while any verification runs.

**A lag line.** The recogniser reports how far behind the speech server is through `onLag(ms)` (23.1: the server's lag messages and the browser's own dropped frames both reach it). The engine publishes `lag` to the strip from `LAG_SHOWN_MS` (1 s, below the server's `MAX_BACKLOG_MS` of 1.5 s, so a drop is never silent; the review of round 3 found both thresholds at 2 s, which hid every drop) and clears it (`lag: 0`) once it is below again and when listening stops; the strip (23.3) shows "Kõne jääb maha N s" from `LAG_SHOW_MS` (1 s) and keeps the line until the lag is 0.

**Flush.** `Engine.flush()` calls the recogniser's `flush()` (23.1): push-to-talk by gaze (23.3) uses it to deliver the words said so far the moment the pointer leaves.

Tests: `extension/src/engine.test.ts` (68 cases) drives the engine with fakes: a stale utterance gets the rules and the suffix, a later utterance aborts the question and the loop, a send waits for a verification and a verification that found a command puts the box back only when it still reads as typed, the lag line appears and clears, a thrown step does not stop the queue.

### 23.3 Push-to-talk by looking, and the settings (PTT lane)

The owner's words: listen while the eye tracker's pointer rests on the button, stop and deliver the words when it leaves; a setting to make the whole bar the button so he can watch the words while speaking; toggle mode stays available.

**The gaze** (`src/ui/gaze.ts`, pure: no DOM, the caller wires it). Four phases: `off`, `arming`, `on`, `leaving`. `enter()` from off starts `arming`; after `GAZE_ON_MS` (250 ms) it is `on` and `onStart` fires, so a pointer passing through does nothing. `leave()` while arming goes back to off with nothing said; while on it starts `leaving`, and after `GAZE_OFF_MS` (600 ms) of grace it is off and `onStop` fires, so an eye tracker's jitter does not cut a sentence. `enter()` during the grace goes straight back to `on` without a restart. `dispose()` (the mode was switched off, the target went away) stops at once and says `onStop` when it was on or leaving. `onPhase` reports each change for the fill.

**The strip** (`extension/src/strip.ts`). In gaze mode (`listenMode: 'gaze'`) the target is the microphone square, or the whole bar when `gazeTarget` is `'bar'`, or the pill's microphone while the bar is folded; `bindGaze` rebinds whenever the target changes and disposes the old gaze first, so the microphone never stays open on a target that went away. `pointerenter` and `pointerleave` on the target drive it, and because a page can swallow the leave event the strip also keeps the pointer's last position (a capturing `pointermove` listener on the document) and every `GAZE_POLL_MS` (1 s) checks it against the target's rectangle, entering or leaving accordingly; a target that appears under the pointer (the mode changed, the bar unfolded) is entered at once. `onStart` sends `utle-listen {on: true}` and `onStop` sends `utle-listen {on: false, flush: true}` to the service worker, which forwards `start` or `stop {flush}` to the offscreen document; there (`offscreenMain.ts`) a stop with flush calls `engine.flush()` and stops `FLUSH_STOP_MS` (800 ms: the server's final must first decode up to 1.5 s of backlog), and a stop with a flush pending delivers the newest partial and the held words before the recogniser is torn down, so a release never loses the utterance. On the wire the flush is the `{"type":"flush"}` frame of 23.1. What he sees: an amber fill growing over the 250 ms of arming and draining over the 600 ms of grace (`data-gaze` on the target); the whole bar as target gets a green inner outline while on and an amber one while leaving; the square reads "Vaata siia ja räägi" while off. In this mode a click or a one-second dwell on the microphone does nothing (`dwellable`'s `when`), and resting on the pill for two seconds no longer unfolds the bar (the small **Näita** does). In toggle mode nothing changed.

**The settings** (`StripSettings`, in `chrome.storage.local`, read by `settingsFrom` with a default for anything missing or unknown):

| Key | Values (default first) | What |
|---|---|---|
| `barHeight` | 128, 96, 192 | The bar's height; the microphone square, the controls and the type scale with it (`sizes`). |
| `micSide` | `left`, `right` | Which side the microphone square is on. |
| `barHiddenDefault` | `false`, `true` | The bar starts folded to the pill when the browser starts. |
| `listenMode` | `toggle`, `gaze` | A click or dwell turns listening on and off, or it listens while the pointer rests on the target. |
| `gazeTarget` | `mic`, `bar` | What the gaze rests on in gaze mode. |
| `speechEngine` | `local`, `soniox` | TalTech's model on this computer, or Soniox through the dev server (23.6). |

The options page (`options.ts`) shows them as groups of large buttons that a click or a one-second dwell chooses, each saved at once ("Salvestatud"), with the Estonian label and the English under it; the gaze-target group is shown only while the listening mode is gaze; the speech-model group carries one note (Soniox needs `SONIOX_API_KEY` on the dev server; the choice takes effect the next time listening starts). The same strip is mounted on the page, and `dist/page.js` is loaded so "näita numbreid" can number the buttons as on the new-tab page. Under "Täpsemalt" are the two addresses of section 20. Every strip reads the settings on `chrome.storage.onChanged`, so a change applies to every tab without a reload.

**The speech engine on the way to the server.** The service worker puts the speech address and the engine into the offscreen document's address (`offscreen.html?asr=…&engine=local|soniox`); `ensureOffscreen` compares the wanted address with the existing document's and, when they differ, closes the old document and creates a new one, which starts not listening. The offscreen side (`asrAddress`) appends `?engine=soniox` to the socket address when that engine is chosen, which is how the server routes the connection (23.6). So a changed engine takes effect when listening is next turned on, as the note says.

Tests: `src/ui/gaze.test.ts` (the phases and timers with fake clocks); `extension/src/engine.test.ts` for `flush`. The strip's wiring to a real pointer, and the whole thing with a real eye tracker, are not verified without a person.

### 23.4 Sound-alike commands and scrolling (NAV lane)

The owner's words: the recogniser writes "juutuba" for YouTube, "aga whatsapp" for "ava whatsapp", "vatsap", "saadake" for "saada", "keri ala". The one-letter rule of 21.3 does not reach these (two letters off, or a three-letter word, which it never corrects).

**Phonetic keys** (`src/core/phonetic.ts`, pure). `phoneticKey(word)`: lowercase, apostrophes dropped, non-letters dropped, then the clusters sch, sh, wh, ck, x → s, s, v, k, ks, then w→v, y→i, c→k, q→k, z→s, š→s, ž→s, and the voiced stops to their unvoiced pair (b→p, d→t, g→k), and every run of one letter collapsed to one, so a long vowel is a short one and a double consonant a single ("keeri" and "keri" are "keri", "saada" and "sada" are "sata", "whatsapp" is "vatsap"). `phoneticStem(word)` is the key of the word with one ending taken off (-sse, -ke, -ge, -gu, -ga, -le, -st, -i, longest first) when at least three letters remain ("youtubei" is "youtube", "avage" is "ava", "saadake" is "saada"). `soundsLike(heard, target)` is true when the keys are equal, the stem of either equals the key or the stem of the other ("delfist" is "delfi"), or the keys are both at least four letters and one edit apart (optimal string alignment: a letter changed, added, dropped, or two neighbours swapped); a three-letter key may differ in its middle letter only, which is the consonant between two vowels that the recogniser loses ("aga" is "ava", "ega" is not); this applies to words of at most three letters, so "teeb" never becomes "tab". Two neighbouring words are joined into one only when both have at least three letters, so "ei lõpeta" stays a sentence.

**Where it is used.**

1. *Site names* (`siteUrl` in `src/core/browserIntent.ts`). After the exact name, the name with an ending off (21.3) and a bare address, the name is matched by sound against every row of `SITES` (spaces removed, "vatsäpp" against "whats app"), then with an ending off; it must sound like the rows of exactly one address, else it is not a site. The table has the usual Estonian spellings as rows, which are also anchors for what sounds like them: juutuub, juutuba, jutuub, uutuub (YouTube), guugel, gugel (Google), gmeil, fäisbuk, feisbuk, mesendžer, messendžer, postimehes, delfis. The table also gained ERR, LinkedIn, CV.ee, CV Keskus and Töötukassa as plain rows. The line names the row it took ("Sain aru: „ava juutuub“").
2. *The misheard rule* (`misheard` in `src/core/inpage.ts`), as a second pass: when no one-letter correction fires, each word of three letters or more is tried as each vocabulary word that sounds like it, one word at a time, under the same rule (the corrections that are commands must all mean one command) and the same protections (never send, sleep, wake, undo, back, arming or a key; not a vocabulary word plus a verb ending; a single word is never corrected). So "aga whatsapp" is "ava whatsapp", "keri ala" is "keri alla", "geri alla" is "keri alla"; "sada", "saata sõnum" and "sul on õigus" stay dictation.
3. *Send is literal* (`SEND` in `src/core/message.ts`): no correction ever reaches it, so every form is listed as heard: saada, saada ära, saada sõnum, saada see, saadake, saadake ära, saadake sõnum, saadame, saadame ära. "Sada", "saadan", "saata" and "saada mulle pilt" are not send.

**Scrolling** (`scroll` in `src/browser/protocol.ts` gains `mode`; `extension/src/page.ts`; the model's tool asks for a mode too). `page` (the default) scrolls 80% of the view (`PAGE_SCROLL_SHARE`) with `behavior: 'smooth'` and answers once the scroll has settled (unchanged over two looks of 50 ms after it moved, at most `SCROLL_SETTLE_MAX_MS`, 600 ms); `little` a third (`LITTLE_SCROLL_SHARE`), the same way; `top` and `bottom` stay instant. Both keep the rule that nothing scrolled is `failed`: the first container under the middle of the screen that can still move in that direction is the one scrolled. `slow` starts a steady scroll at `SLOW_SCROLL_PX_PER_S` (90 px/s, one `requestAnimationFrame` loop, whole pixels with the fraction carried) and answers at once; it ends on `stop`, on any other scroll command, on a navigation (`onNavigation`), or when the container stops moving. `stop` ends it and is ok when nothing was moving. The phrases: keri natuke alla / üles, natuke alla / üles, keri veidi alla, veidi üles, scroll down a little, a little up → `little`; keri aeglaselt alla / üles, keri tasa alla, aeglaselt alla, scroll slowly down, scroll up slowly → `slow`; stopp, seis, aitab, lõpeta, lõpeta kerimine, peata kerimine, kerimine seis, stop, stop scrolling → `stop`. While the labels show, "stopp", "stop" and "lõpeta" still hide them (22); "seis" and "aitab" stop the scroll and leave the labels. While an armed box holds words, "aitab" and "lõpeta" are soft words (22): message words, not a stop; "stopp", "seis", "stop" and every two-word form stop the scroll whatever the box. The core cannot know whether a slow scroll runs, so a stop with nothing moving answers "Kerimine seis." and changes nothing. "Keri edasi" and "keri tagasi" stay the video's. `extension/test/run.ts` measures all of it: a page scroll ends at 80% of the view, a little one at a third, a slow one moves about 90 px over 1 s and stays where it is once stopped, and another scroll ends it.

**Numbers with endings** ("vajuta 5.", "number viis.", "12.") already clicked the label through `cleanForBrowser` and `normalise`; verified by test, unchanged.

### 23.5 Editing in the box (EDIT lane)

The owner's words: move between sentences and words, erase letters, insert in the middle, undo; an essay, not only a chat message; Google Docs as far as a canvas editor allows. The phrases and what the core does are in the Editing table of 21.1; this is the page side (`extension/src/page.ts`) and the contract (`src/browser/protocol.ts`: `caret{to}`, `select{what}`, `typeText{text}`, `pressKey{key, times}` with `PressableKey` extended by Backspace, Delete, the four arrows, Home, End, Undo, Redo and SelectAll).

**The field.** Every editing command acts on `editTarget`: the armed field, else the focused text field, else the site's composer when it is armed, else the box in front (`findMessageBox`). With none the answer is `not_found` ("No field is picked to write in."). Backspace, Delete, the arrows, Home, End, Undo, Redo and SelectAll are editing keys: when the focused element is not a text field, `pressKey` focuses the edit target first. Escape, Enter and Tab are leaving keys and go to whatever is focused; Tab moves the focus itself (`focusNext`: the next focusable element in page order, wrapping, skipping the strip and the labels), and a text field reached that way is armed as a real Tab arms it (M7.2). A count is capped at 50.

**One text model for both kinds of field.** A textarea or input is its value; a contenteditable is the text of its text nodes in order, with a line break for `<br>` and between block elements (`BLOCK_TAGS`: div, p, li, headings, blockquote, pre, tr, section, article, dd, dt). Character offsets in that text map to DOM positions and back (`domPosition`, `offsetOf`), so the caret, a selection and typing at the caret behave the same in both. The field's selection is read as offsets (`spanOf`: the end of the text when the selection is elsewhere on the page) and set as offsets (`setSpan`); editors such as Lexical read the selection on a task, so a moment is given after setting it.

**The caret and a selection.** `start`, `end`, `lineStart`, `lineEnd` by the text's line breaks; `sentenceStart` is the start of the sentence the caret is in, and from a sentence's very start the one before; `sentenceEnd` is after the mark; `wordBack` and `wordForward` by word boundaries. `{find, where}` finds the nearest match of the spoken words (`findSpan`): the last match before the caret, else the first after it; whole words first (case-insensitive, any spaces between words), then for one word the word in the text that it extends, or that extends it, by one or two letters (the genitive: "kooli" finds "kool" and "Koolid"), then a substring; nothing found is `not_found` ("That text is not in the field."). `select` takes the same targets plus `all`, `word` (the word at the caret, else the one before it, with the spaces after it, else the spaces before it, so deleting it leaves one space), `sentence` (with its trailing space), `line`, `lastWord` (the last word with its punctuation and the spaces before it, what "kustuta viimane sõna" takes), `lastSentence`. Both answer with the box.

**Typing at the caret.** `typeText` sets the selection as it is (a selection elsewhere on the page means the caret is nowhere in the field: the end), then types through the same path as `setText` (`typeAtSelection`: `execCommand('insertText')`, checked 30 ms later for editors that apply it themselves, else the native value setter for a field or `beforeinput` for an editor), with the spacing worked out on the page (`joinAtCaret`): a space before when the character before is not a space and the text does not start with a mark, a space after when a letter, digit or opening quote follows, a capital first letter at a sentence start (the start of the text, or after . ! ? … or a line break), else a small one unless the word carries a capital of its own (ERR, iPhone, English "I"). A selection is replaced.

**The keys inside a field** (`editKey`). The arrows, Home and End move the caret through the text model (`moveBy`: lines by the text's line breaks, keeping the column), because a synthetic key event moves nothing by itself. Backspace and Delete remove the selection, else one character (`deleteAt`): `execCommand('delete' | 'forwardDelete')` first, checked 20 ms later; else a field's value is cut and an `input` event sent, and an editor gets the `beforeinput` a key would produce (`deleteContentBackward` | `deleteContentForward`), the range cut when nobody cancelled it. Undo and Redo try `execCommand`, then the key with Ctrl. SelectAll selects everything inside the field. Every key answers with the box (`readBox` after it), except Tab, which answers with the field it landed in.

**Google Docs** (`docs.google.com`). Docs draws its page on a canvas: there is no text to read and nothing to find. Its keyboard target is a contenteditable inside the `iframe.docs-texteventtarget-iframe` document (`docsEditor`); when it is not there, every editing command answers `failed` ("The Google Docs editor was not found. Click into the document first."). On Docs the keys are dispatched to that target as key events (`dispatchKey`), the caret moves by keys (`docsCaret`: start and end of the text are Ctrl+Home and Ctrl+End, of the line Home and End, a word Ctrl+Arrow; a sentence or a found word answers `failed` with "Google Docs has no text Ütle can read. Say the keys instead…"), `select` does `all`, `word` (Ctrl+Left, Ctrl+Shift+Right), `lastWord` (Ctrl+Shift+Left) and `line` (Home, Shift+End) and refuses the rest, and `typeText` types one character at a time as `keypress` events (`docsType`; a line break is Enter). **The Docs box.** So that dictation reaches Docs, `readBox` there answers a box that is present, armed, kind `composer`, label "Google Docs", whose text is what Ütle itself typed in the last `DOCS_TYPED_RESET_MS` (4 s), not the document; the core joins its dictation onto that, and `setText` types only the new tail, or erases with Backspace back to the common prefix when the text shrinks (a preview turning into a command). After 4 s of silence the remembered text is empty and the next utterance starts fresh. The repairs of 21.1 ("mitte X, vaid Y", "kustuta viimane sõna") therefore reach only what was typed in the last 4 s; "võta tagasi" on Docs needs the model to answer `pressKey Undo`. The model is told the same in its prompt (22.3). Nothing of this has been run against Google Docs itself: the selectors and key habits come from knowledge of its markup.

**The essay fixture.** `extension/test/fixtures/essay.html` holds the same three-paragraph text as a plain contenteditable (one `div` per paragraph, as a browser makes them on Enter) and as a textarea. `extension/test/run.ts` runs the same sequence on both: typing after a found word gets a space before and none before the full stop, a mid-sentence insert gets a small first letter and spaces on both sides, the sentence at the caret is selected with its trailing space and Backspace removes it, `lastWord` takes the space before it, `sentenceStart` and `sentenceEnd`, three `wordBack` then typing lands before the right word, `lineStart` and typing before the line, ArrowDown then ArrowRight five times, End, ArrowUp, Home, a found word selected and deleted, "kooli" finds "Koolid", a word that is not there is `not_found`, and typing over select all is capitalised.

### 23.6 A second recogniser: Soniox

TalTech's model mishears often enough that the owner asked for Soniox, a hosted real-time
speech-to-text service that lists Estonian among its languages. It sits behind the same wire as the
local model (section 20.1): the browser speaks the Ütle protocol and never sees Soniox; the key
stays on the dev server. `server/soniox.ts` carries, in its first comment, every Soniox field name
it relies on with the date and sources, so a difference from Soniox's real API is fixed in one place.

**Choosing it.** A connection to `/api/asr?engine=soniox` goes to Soniox; so does every connection
when the dev server runs with `UTLE_ASR=soniox`. Everything else is the local model, unchanged. The
key is `SONIOX_API_KEY` in the server's environment (never in a file in the repository). `GET
/api/status` reports `speech: { local, soniox }`: `local` when the model directory is on disk,
`soniox` when the key is set.

**What the server does per connection** (`attachSonioxSession`). Opens
`wss://stt-rt.soniox.com/transcribe-websocket`, sends the JSON config as its first frame (`api_key`,
`model` `stt-rt-v5` or `SONIOX_MODEL`, `audio_format: 'pcm_s16le'`, `sample_rate: 16000`,
`num_channels: 1`, `language_hints: ['et']`, `enable_endpoint_detection: true`), then answers the
browser with `ready`. The browser's float32 frames are converted to 16-bit little-endian PCM and
forwarded; frames that arrive before Soniox is open are buffered in order. Soniox answers with
tokens: final tokens accumulate, non-final tokens replace the previous non-final ones, and the
concatenation of both is sent as `partial` whenever it changes. A token whose text is `<end>` (the
endpoint) closes the utterance: `final` with its text, and the next utterance starts empty. The
browser's `{"type":"flush"}` becomes Soniox's `{"type":"finalize"}`; the finals Soniox then returns
(and the `<fin>` marker) produce the `final`. `{"type":"keepalive"}` goes to Soniox every 10 s
(it wants one within 20 s of silence). When the browser leaves, Soniox gets the empty end frame
and is closed. A Soniox error (`error_code`, for example 401 for a bad key), a socket error, or
Soniox closing first all become `unavailable` with reason `load_failed` and a 1011 close, after
which `src/speech/pick.ts` falls back to Chrome's recogniser as for the local model (the development page only; the extension shows the unreachable line, 21.2). No key at all
is `unavailable` at once, with a warning on the server that names `SONIOX_API_KEY`.

**Logged.** `[soniox] connecting`, `session open`, `browser closed, code N`, `error N`, `closed by
Soniox, code N`. Never audio, never text.

**Not verified without a key.** The field names were taken from Soniox's client source and two
integrations because Soniox's documentation site was not reachable from the machine that wrote
this; `server/soniox.test.ts` proves the mapping against a scripted Soniox, not against Soniox.
Audio leaves the laptop on this engine; `THIRD-PARTY.md` says so.

## 24. Round 4 (2026-10-06)

The owner's words after the demo morning: one breath should carry several things to do ("mine whatsappi, siis ava Karini viimane sõnum, siis kustuta see kõigi jaoks"); the microphone picks up other people's conversations; and what he refers to on a page (a message, a heading) must be something the model can see and act on. Three lanes after a contract commit (`src/core/chain.ts`, `IntentChain` and `plan` in `src/core/pageIntent.ts`, `hover`, `contextMenu`, `scrollTo` and the `text` role in `src/browser/protocol.ts`, `speaker`, `enrol` and `onlyOwner` in `src/speech/asrProtocol.ts`, `onlyOwner` in `StripSettings`), one subsection each. Nothing in this section is proven with a real voice or on a real site: it is unit tests, the browser suite on stand-in pages, and the eval's fakes.

### 24.1 Chains of goals (CHAIN lane)

One utterance may hold many goals, and a pause between two of them must not break the chain. Three parts share `src/core/chain.ts` (pure): the speech side holds longer after a connective and joins a continuation; the rules never take a text ending in a connective as instant; the engine works through the goals the model planned, one at a time, and shows where it is.

**The connectives.** `TRAILING`, the words that end a part and promise another, longest first: pärast seda, ja siis, and then, after that, seejärel, siis, ning, then, ja. `LEADING`, the words that open a continuation of what was just said: pärast seda, ja siis, seejärel, siis, then; a bare "ja" is too common to count at the start. `endsWithConnective(text)` is true when the tidied text (lower case, letters, digits and apostrophes only) ends with one and has words before it; `startsWithConnective(text)` the same at the start with words after it.

| Constant | Value | What |
|---|---|---|
| `CONNECTIVE_HOLD_MS` | 2,500 ms | The hold for a final that ends with a connective, instead of the normal hold (150 ms in the extension, `INPAGE_HOLD_MS`; 700 ms on the development page, `LOCAL_HOLD_MS`). |
| `CONTINUE_WINDOW_MS` | 2,500 ms | A final that starts with a connective this soon after a delivery continues it. |
| `MAX_PLAN_GOALS` | 12 | Goals the model may plan after the one it acts on (`IntentAnswerSchema`, `server/intent.ts`, the engine). |
| `GOAL_CHARS` | 200 | A goal's length; `chain.original` is cut to 1,000. |
| `MAX_CHAIN_STEPS` | 16 | Page steps a chain may take in all. |
| `MAX_CHAIN_MS` | 90 s | A chain's life since the utterance arrived. |
| `MAX_INTENT_STEPS`, `MAX_STEP_FAILURES`, `INTENT_LOOP_BUDGET_MS` | 4, 2, 15 s | Still per goal (22.2); the budget's clock restarts at each goal. |

**The hold** (`src/speech/assembler.ts`). The assembler holds a final for `holdMs` and joins what follows (20.1). Since round 4, when the held text ends with a connective ("mine whatsappi ja"), the hold is `connectiveHoldMs` instead: he is promising more, and the pause while he thinks of it may be long. Speech activity restarts the hold as before, so "mine whatsappi ja … siis ava Karin" is one utterance. A connective-ending text is never released as instant, and the recogniser's other readings are not searched for an instant one: `inpageInstant` in `src/core/inpage.ts` answers false for it before classifying. The dot and the comma that the recogniser may put after the connective are ignored.

**The continuation** (`onUtteranceContinued`). When nothing is held, a final that starts with a connective ("siis ava Karin") within `CONTINUE_WINDOW_MS` of the last delivery is marked as continuing; it is held like any text and, on release, goes out through `onUtteranceContinued(whole, added)`: `whole` is the last delivered utterance with the new words appended, `added` the new words alone. The last delivery is then `whole`, so a third part continues too. Without that handler (the development page), such a final is an utterance of its own through `onUtterance`. `src/speech/local.ts` passes `CONNECTIVE_HOLD_MS` and the handler when the caller gives one; `dispose` forgets a continuation in progress. The protocol's `RecognizerHandlers.onUtteranceContinued` is optional; the engine's `EngineHandlers` always has it.

**The plan.** The model's answer carries `plan`: the goals after the one its action serves, in his own words, in order, `[]` for one goal. The server cleans it (22.3) and the engine cleans it again (`planFrom`: strings, trimmed, cut to `GOAL_CHARS`, empties dropped, at most `MAX_PLAN_GOALS`). The prompt (`server/intentPrompt.ts`, "Several goals in one breath") tells the model to split on ja, siis, ja siis, pärast seda, seejärel, ning, commas and sentence ends wherever each part is an action of its own; to answer the first goal's action with `done` judged for that goal alone; never to split words that are a message to type; and, when the user turn has a chain, to work on `chain goal` only, answer `plan: []` unless the goal itself still holds several actions, judge by the page as it is now, and answer `unclear` "Valmis" when the steps show the goal finished. The user turn carries `chain: n/total`, `chain original`, `chain done`, `chain goal`, `chain next`, or `chain: none`.

**The chain in the engine** (`extension/src/engine.ts`). A `Job` has `chain: IntentChain | null` and `continued`. The model is asked with `chain.goal` as the utterance when there is a chain, and the chain in the request. `planChain` runs on a goal's first ask only (no steps yet) and only when the plan is not empty: with no chain yet, the chain starts as `{ original: the utterance, completed: [], goal: firstGoal(utterance, plan, say), remaining: plan }`; in a chain, a plan means the goal itself held several parts ("siis ava Karin ja kustuta see"): the goal narrows to its first part, and the planned goals not already in `remaining` go before what remained, cut to 12. `firstGoal` is the utterance up to where the first planned goal's words begin (whatever the case and the punctuation between them), with trailing commas and connectives trimmed ("mine whatsappi, siis" is "mine whatsappi"); when the plan is not in his words (the model paraphrased) it is the model's `say`, and with none the whole utterance.

`runGoal` is M7.2's loop (22.2) for one goal: it answers `done` when the model's step ran and said no more, or when an `unclear` comes after at least one good step ("Valmis"); `stopped` on an `unclear` with nothing done, at the step cap (`MAX_INTENT_STEPS`, or what the chain has left of `MAX_CHAIN_STEPS`), after `MAX_STEP_FAILURES`, after `INTENT_LOOP_BUDGET_MS` since the goal began, on barge-in, and when the model cannot be reached. `follow` works through the goals: after a goal ends `done` with goals remaining, and while fewer than `MAX_CHAIN_STEPS` steps are taken, `MAX_CHAIN_MS` has not passed since the utterance arrived and no later utterance has interrupted, the chain shifts (`completed` gains the goal, `goal` is the next, `remaining` the rest), the engine waits `SETTLE_MS`, marks the job `looping`, and asks afresh with that goal as the utterance, the chain, and no steps. The chain ends when nothing remains or on any stop, and `lastDone` keeps what was finished (the chain's completed goals and its goal; for a single goal, the utterance) for a continuation. A verification (23.2) inherits the job's chain and `continued`, so a dictation that the model judges to be a chain runs the chain after the box is put back.

**The continued utterance.** `onUtteranceContinued(text, added)` shows `text` as the words heard, ends the live preview, and queues a job for `added` with `continued: true` and a chain `{ original: text, completed: [], goal: added, remaining: [] }`. It interrupts nothing (no barge-in: the earlier job's model work goes on). At its turn it waits for every verification pending, as a plain send does; its `completed` becomes `lastDone`, so the model is told what the earlier utterance finished; and it is never stale (`STALE_MS` does not apply: it was meant to wait). Then the rules run as for any utterance, and the model is asked with the chain. The whole is not re-run: only the new words are a goal.

**The chain on the strip.** `StripState.chain` is `chainLine(chain)`: "2/4 · ava Karini viimane sõnum" (the goal in hand, its number, the total), published on every shift and set to `''` when the chain ends, however it ends. The strip draws it as a thin dim line under the lag line, in the same style, and only while it is not empty.

**Barge-in and send.** A later utterance interrupts a chain at its next safe point as it interrupts a loop (23.2): the step in hand finishes, no further goal is asked for, the chain line clears. The exception is a plain send ("saada"): it does not interrupt or cancel a job with a chain and waits its turn behind it, so "ava Mari, kirjuta et tulen homme" followed by "saada" sends after the chain has typed. A continued utterance, as above, interrupts nothing.

**What the model is told.** Only the goal in hand as the utterance, the chain lines, the page as it is now, and this goal's steps. It never sees the earlier goals' steps; `chain done` tells it what was finished. The engine, not the model, keeps the chain between asks: the server keeps no state (22.3).

Tests: `src/core/chain.test.ts` (the connectives, `firstGoal` with a plan in his words, a paraphrase and no plan, `chainLine`); `src/speech/assembler.test.ts` (the longer hold after a connective, no instant release for it, a continuation within the window and not after it, the joined text and the added words); `src/speech/local.test.ts` (the handler through the recogniser); `extension/src/engine.test.ts` (83 cases: a plan starts a chain and the goals are asked in turn with the chain, the caps, a stop ends the chain and clears the line, a send waits behind a chain, a continued utterance carries `completed`, a verification that finds a chain); `server/intent.test.ts` (the chain lines in the user turn, the plan cleaned, `plan` in the log). The eval's two chain cases run the chain through the real model against fakes (22.3). Not verified without a person: whether the recogniser hears "siis" as "siis" after a pause, and what a real page shows between two goals.

### 24.2 The owner's voice (VOICE lane)

The owner's words after the demo: "the microphone keeps picking up background conversations, so it needs a totally quiet environment." Push-to-talk by gaze (23.3) is one half of the answer: the microphone is open only while he looks. This is the other half: the server knows his voice, and with **Kuula ainult mind** on, an utterance in another voice is dropped. Nothing changes for anyone who never presses the button: no profile, no `speaker` on any final, the client delivers everything as before.

**The model** (`server/speaker.ts`, `server/speakerModel.ts`). sherpa-onnx's speaker embedding extractor over WeSpeaker CAM++ trained on VoxCeleb (`wespeaker_en_voxceleb_CAM++.onnx`, 29.3 MB, from sherpa-onnx's speaker-recognition release on GitHub; the URL is in the file header). A speaker embedding describes the voice, not the words, so it is text- and language-independent by design; VoxCeleb is interviews in many languages; nothing in that release was trained on Estonian and nothing in it is for one language. CAM++ is the lightest of the release's VoxCeleb models, so a three-second utterance is embedded well under 150 ms on a laptop CPU (not measured here: no model files on this machine). `npm run model` downloads it as a second, optional step into `models/speaker/`; a failure there is a warning. The server works without it (below).

**The profile.** `models/speaker/owner.json`: `{ version: 1, model, embedding: number[], rms, seconds }`. The embedding is unit length; `rms` is the mean RMS of the owner's speech frames at enrolment; never audio. Loaded once when the gate is made (in the decode worker, or on the server thread when the worker cannot start), replaced at the next enrolment. The log says `[asr] speaker model loaded; owner's voice learnt`, or `[asr] no speaker model (npm run model fetches it; loudness only until then); owner's voice not learnt yet`, or the mix of the two (`speakerLine` in `server/asr.ts`), never whose voice an utterance was.

**The verdict** (`createSpeakerGate(extractor, { profilePath })`). `judge(frames)` embeds one whole utterance and takes the cosine similarity to the profile: `owner` at or above `OWNER_THRESHOLD` (0.55), `other` at or below `OTHER_THRESHOLD` (0.35), `unknown` between. VoxCeleb-trained CAM++ scores the same speaker on different sentences at about 0.6 to 0.8 and different speakers at about 0.0 to 0.3, with the equal-error point near 0.45; 0.55 sits above it so a stranger is rarely let through, and the owner on a bad day (a cold, a far microphone) lands in `unknown`, which is still obeyed, rather than `other`, the only verdict that drops words. An utterance shorter than `MIN_JUDGE_SECONDS` (0.8 s) is `unknown` whatever it sounds like. Without a profile `judge` answers null and the final carries no speaker. A profile whose `model` is not the gate's model (another version, or made without one) is judged by loudness only, and vectors that cannot be compared score `unknown`: a stale profile never makes the owner a stranger (review). The thresholds are constants: nobody has measured them on an Estonian voice, and a session with the owner may move them.

**The energy gate, without the model.** Enrolment still records the owner's speech RMS, and `judge` then calls an utterance whose speech RMS is below `ENERGY_OTHER_RATIO` (40 %) of it `other`, everything else `unknown`; `owner` is never said. Its limits: it tells distance from the microphone, not voices. A loud stranger near the microphone passes; the owner speaking softly fails (the strip says someone else spoke; he says it again). With the model the embedding alone decides.

**In the session** (`server/asrSession.ts`, `server/asrWorker.ts`). The decoder keeps the frames of the utterance in progress (the newest `MAX_KEPT_MS`, 8 s since the review: the judgement holds the decoder for the clip's length, and eight seconds tell a voice as well) and, at an endpoint, those of the utterance that ended; `Decoder.judge()` hands them to the gate. The session judges before it sends a final, at an endpoint and at a flush (judged before the reset, so the frames are still the decoder's), and sends `{"type":"final","text":"…","speaker":"owner"|"other"|"unknown"}`: one frame, so the client never acts on a final whose speaker is still coming. Nothing is sent until the judgement is in; with the worker it is a `judge` message and a `judged` answer in the same order as the frames. A judge that throws or whose worker is gone loses the verdict, not the words: the final goes without a speaker (review). `{"type":"onlyOwner","on":true}` from the client only counts: an `other` final is still sent, with its speaker, so the client decides (the close line counts the finals of other voices). `{"type":"enrol","seconds":N}` (1 to `MAX_ENROL_SECONDS`, 30) makes the decoder collect the next N seconds of speech frames (RMS at or above `SILENCE_RMS`; silence between words is skipped), give them to `gate.enrol`, and answer `{"type":"enrolled","ok":true|false,"seconds":N}`; it gives up with `ok: false` after `ENROL_PATIENCE` (4) × N seconds of audio with too little speech, when the gate has under `MIN_ENROL_SECONDS` (2 s) of speech, or when the stream closes. A second `enrol` replaces the first.

**The client** (`src/speech/local.ts`, in its own block). `LocalOptions.onlyOwner` sends the `onlyOwner` frame right after `ready`. A final with `speaker: 'other'` while the mode is on is dropped: the interim is cleared, a settling quick reply is cancelled, a flush that waited for it still releases the words held before it, and `handlers.onForeign()` is called. Its partials were already shown and typed as a preview; the engine's `onForeign` ends that live utterance and takes the preview back at once, as `stop()` does for an utterance without a final (review; no empty utterance is sent, so nothing barges in on an earlier utterance's model work). `Recognizer.enrol(seconds)` sends the `enrol` frame (or holds it until `ready`); `enrolled` reaches `handlers.onEnrolled(ok, seconds)`.

**The extension.** The options page has a group **Minu hääl**: the 112 px button **Õpeta mu hääl** sends `utle-enrol {seconds: 8}` to the service worker, which forwards `enrol` to the offscreen document; there `Engine.enrol(seconds)` starts listening if it was off, sends the frame through the recogniser and ignores every utterance, continuation and partial until `onEnrolled`, a microphone or model error, a stop, or `ENROL_TIMEOUT_FACTOR` (5) × seconds with no answer (review: what he says to teach his voice is neither typed nor run); the strip's line says "Räägi 8 sekundit tavalisel häälel…", then "Hääl on õpitud." or "Hääle õppimine ei õnnestunud.". The two choices **Kuula ainult mind** / **Kuula kõiki** set `onlyOwner` in `chrome.storage.local`; like the engine, it travels in the offscreen document's address (`&onlyOwner=1`), so it takes effect the next time listening starts, as the group's note says. When a final is dropped, `StripState.foreign` shows "Keegi teine rääkis, jätsin vahele." as a thin dim line for `FOREIGN_SHOWN_MS` (3 s).

| Setting | Values (default first) | What |
|---|---|---|
| `onlyOwner` | `false`, `true` | Only the owner's voice is obeyed. Needs the learnt voice; the speaker model for anything but the energy gate. |

Tests: `server/speaker.test.ts` (a fake extractor: enrol, the thresholds, short and no-profile verdicts, the profile file round trip in a temp dir, the energy gate); `server/asrSession.test.ts` (the speaker on a final and on a flush, the frames judged, the asynchronous judge, the enrolment flow and its giving up); `src/speech/local.test.ts` (the `onlyOwner` frame, dropped finals, the handlers, enrol). The options page and the strip typecheck only. Not verified without a person: the model on a real voice, the thresholds, the time a judgement takes.

### 24.3 Everything on the page: text items, hover, the context menu, scroll to (PAGE lane)

The model only knows what `readPage` reports (22, `extension/README.md` "What the page tells the model"). Until round 4 that was the clickable things, so "Karini viimane sõnum" named nothing the model could point at, and a control that shows on hover only (WhatsApp's arrow on a message, YouTube's card menu, Gmail's row actions) was never listed. `extension/src/page.ts` now lists the text he may refer to, rests the pointer on an item, opens an item's context menu, and scrolls an item into view. The contract: `PageItem.role` gains `text`; `hover {id}`, `contextMenu {id}` and `scrollTo {id}` in `src/browser/protocol.ts`, validated by `pageIntentFrom` against the page's ids like `clickItem`, and treated by `afterCommands` as page changes (labels and undo cleared).

| Constant | Value | What |
|---|---|---|
| `MESSAGE_PREFIX`, `MINE_PREFIX` | `[sõnum] `, `mina: ` | A message of the open chat; his own messages are `[sõnum] mina: …`. |
| `MESSAGE_MENU_NAME` | `sõnumi menüü` | The name of a message's menu control (`messageMenu`) when it is listed. |
| `TEXTUAL` | `h1, h2, h3, p, li, [role="listitem"]` | The things he may refer to that are not clickable. |
| `TEXT_MIN`, `TEXT_LONG` | 12, 160 characters | A list item or paragraph shorter is a label or a crumb, longer an article; a heading needs 2. |
| `NAME_MAX` | 60 | Every item's text is cut to this, text items too. |
| `TEXT_MAX` | 40 | Text items at most. |
| `TOTAL_MAX` | 150 | Items in all (`IntentRequestSchema`'s cap on `page.items`). |
| `HOVER_REPEAT_MS`, `HOVER_HOLD_MS` | 200 ms, 3 s | A hover re-sends the pointer move this often, for this long. |
| `SCROLL_SETTLE_MS` | 200 ms | `scrollTo` waits this long after the scroll. |

**The text items** (`collectText`). After the actionable items (visible, then `[allpool]`) and the markers (`[pealkiri]`, `[vestlus]`) come the text items, role `text`, so the numbers of `showHints` and the ids still agree on the actionable ones and the text ids continue after them. First the open chat's messages when the site has `messageRows` (`extension/src/sites.ts`): each outermost match that is on screen and passes the hit test, its text from the first non-empty `messageText` inside it, else its own text, marked `mina: ` when it or something inside it matches `messageMine`. Then the `TEXTUAL` elements: not inside a message, not inside or around an actionable element (that text is the element's name already), not holding another `TEXTUAL` element (a block is listed through its parts), not the `h1` that is the `[pealkiri]` marker, within the length limits. Deduplicated by lower-cased text, sorted top to bottom in bands of 12 px then left to right. The limit is the smaller of `TEXT_MAX` and what `TOTAL_MAX` leaves after the actionable items and markers; over it, a chat keeps the bottom-most (the latest messages), any other page the top-most. A message container, and WhatsApp's `role=row` around one, is not an actionable item (`isMessagePart`: a row or plain element inside a message or wrapping one), so a chat is not listed twice; a control inside a message (the hover arrow, a link, a button) still is, and the `messageMenu` control inside a message row is named `sõnumi menüü` whatever its own label.

**The pointer** (`arrive`, `leave`, `move`, `restOn`). Every pointer event is sent at the centre of the element's box clamped to the screen, to the element a real pointer would land on there (`targetAt`: the element at that point when it is inside the item, else the item), so it bubbles from a message's text span as a real one would. `arrive` sends `pointerover` and `mouseover` (bubbling), then `pointerenter` and `mouseenter` on the element and each ancestor from the document down (not bubbling, as the browser fires them), then `pointermove` and `mousemove`; `leave` sends `pointerout`, `mouseout` and the `leave` pair up the ancestors. One element is `hovered` at a time: `restOn(el)` leaves the old one first (`stopHover`), unless the new one is inside it, because leaving a parent would hide what he is after. **Every click starts with the hover sequence**: `activate` is `restOn`, `arrive`, then `pointerdown`, `mousedown`, `pointerup`, `mouseup` and `click`, so a control that needs hover state reacts to a click too. `clickItem` on a text item (a message) is `bringIntoView` and one `activate` at its centre with none of the click fallbacks of M7.2 (Enter, Space, following a link): on WhatsApp it selects the message.

**`hover {id}`.** `hideHints`, `bringIntoView`, `restOn`, `arrive` on the target, then a `move` every `HOVER_REPEAT_MS` for `HOVER_HOLD_MS`, so a control that shows on hover only is still there when the page is read again (the model is told to answer `done: false` after a hover, so the engine reads the page and asks again) and clicked. The repeat stops early when another element is hovered, the element leaves the document, or the time is up; the next `hover` on an unrelated element sends the leave events to the old one. A navigation (`onNavigation`) stops the repeat and keeps `hovered`: a same-document navigation keeps the element. Answers `ok`, or `not_found` for an id that is gone. The line is "Näitan valikuid.".

**`contextMenu {id}`.** The same arrival, then a right click: `pointerdown` and `mousedown` with `button: 2` and `buttons: 2`, `contextmenu` (bubbling, cancelable), `pointerup` and `mouseup`. For sites whose actions live in their own context menu; the page's own menu opens, the browser's does not (a synthetic event never opens it). The line is "Avan menüü.".

**`scrollTo {id}`.** `scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })` on the item, in whatever pane holds it, then `SCROLL_SETTLE_MS`. For a message cut off at the top of the chat, or a heading he named. The line is "Kerin selle juurde.". All three take a text item as well as an actionable one; the failure line for a gone id is the one `clickItem` has ("Seda ei ole enam lehel. Ütle uuesti.").

**What the model is told** (`server/intentPrompt.ts`). Messages, headings and paragraphs are `text` items; a text item can be hovered, right-clicked, scrolled into view or clicked; after `hover` or `contextMenu` always `done: false`, so the page is read again and the control that appeared is seen; "ava Karini viimane sõnum" on a chat page is the last text item of that chat without `mina:`, hovered, then its menu; "kustuta see kõigi jaoks" is the menu entry Kustuta / Delete, the choice "Kustuta kõigi jaoks" / "Delete for everyone", then the confirming button. The tool's `hover` and `contextMenu` ids carry the same instruction in their descriptions.

**The WhatsApp and Messenger selectors** (`sites.ts`, all marked `UNVERIFIED 2026-10-06`). WhatsApp: `messageRows` `#main [role="row"] [data-id]`, `#main [data-id].message-in, #main [data-id].message-out`, and the older `#main .message-in, #main .message-out`; `messageText` `.selectable-text.copyable-text`, `.copyable-text .selectable-text`, `.selectable-text`; `messageMenu` `[role="button"][aria-label="Context menu"]` (also `Context Menu` and the Estonian `Kontekstimenüü`) and `[data-icon="down-context"]`; `messageMine` `.message-out`. Messenger: `messageRows` `[role="main"] [role="grid"] [role="row"]` and `[role="main"] [role="row"]`, `messageText` `[dir="auto"]`, `messageMenu` the `More` / `Rohkem` button, no `messageMine`. They are guesses from the DOM of earlier builds, and so is whether WhatsApp's arrow shows on a synthetic `mouseover` (React tracks hover through `mouseover` and `mouseout`, which are sent). If the demo shows no `[sõnum]` items or no `sõnumi menüü` after a hover, those lines are the place to fix.

Tests: `extension/test/run.ts` on the WhatsApp stand-in (`extension/test/fixtures/whatsapp.html`, which has the guessed structure, a hover-only arrow, a menu with Vasta, Edasta and Kustuta sõnum, a confirmation dialog with `div[role=button]`s, and a `contextmenu` handler): the open chat's five messages are `[sõnum]` text items after every actionable id, his own marked, the last in view, the `role=row` not listed as a row; the arrow is not listed before a hover; `scrollTo` brings the message cut off at the top to the middle of the pane; a click on a message selects it; after `hover` on Karin's last message the arrow is the button `sõnumi menüü`, clicking it lists the menu's options, "Kustuta sõnum" opens the dialog listed first with its three buttons, and "Kustuta kõigi jaoks" removes the message; `contextMenu` on a message opens the page's own menu and "Vasta" in it replies; 999 answers `not_found` for all three. On the video stand-in a card's menu button is listed only after a hover, one only, and the page's heading is listed once (as `[pealkiri]`, not again as text). Not verified without a person: every selector above, the hover on the real sites, and the whole delete-for-everyone chain on real WhatsApp.

## 25. Round 5 (2026-10-06, afternoon)

The owner's report after the demo with the real user, as the lanes' commits carry it, in his order: (1) putting in an e-mail address, a phone number or an ID code is very hard, because the recogniser writes numbers as words; (2) for a long prompt it should take some time to think about what is really wanted (with a very long message it hurried to act too fast), but not at the cost of executing short commands efficiently; (3) it got stuck thinking at one point and became unusable for a few minutes; (4) correcting a form field was a hassle, and a Smart-ID login needs a way to move on and to confirm by voice; (5) he could not zoom or enlarge the text. Three lanes from the contract commit on branch `r5`: FIELDS (25.1, items 1 and 4), BRAIN (25.2, items 2 and 3), ZOOM (25.3, item 5), each green on the gate and the browser suite before its merge. Nothing in this section has met a real voice, a real Smart-ID page or a real bank form; what is proven is on `extension/test/fixtures/login.html` and with fakes.

### 25.1 Numbers and form fields (FIELDS lane)

The recogniser writes numbers as words ("kolm üheksa null kaks") and symbols as words ("ät", "punkt"); an ID code, a phone number, an e-mail address or a PIN needs digits and characters. The lane makes the page say what a one-line field is for, converts his words for it in the core, keeps a one-line field out of the live preview, reads the field back, and gives him the words that move a form on.

**The conversion.** `typedFromSpoken(text, kind)` in `src/core/spelling.ts` (pure, 99 tests). Numbers become digits digit by digit when spoken one by one ("kolm üheksa null kaks" is 3902, zeros kept) and as a number when spoken as one ("kakskümmend kolm" and "kaks kümmend kolm" are 23, "sada kaksteist" 112, "kolm tuhat" 3000, "twenty-three" 23), Estonian and English, to the thousands; digits already written stay; a run of numbers is one digit string with nothing between its parts. Symbols: ät, ätt, at (@); punkt, dot, point (.); sidekriips, miinus, kriips, dash, hyphen (-); alakriips, alljoon, allkriips, underscore (_); tühik, space; kaldkriips, slash; koolon, colon; koma, comma; pluss, plus. Letters by their Estonian names (bee, tsee, dee, ee, eff, gee, haa, ii, jott, kaa, ell, emm, enn, oo, pee, kuu, ärr, ess, tee, uu, vee, kaksisvee, iks, igrek, tsett) or as a single letter; "suur a", "suurtäht a", "capital a" is A. Per kind:

| Kind | What his words become |
|---|---|
| text | Unchanged, except that a run of three or more number words becomes digits ("kolm üheksa null kaks üks" is 39021; "kell viis" and "kaks kolm" stay words). Then the sentence join of 21.1 (space, capital, full stop). |
| email | Lowercase, no spaces: numbers to digits, "ät" to @, "punkt" to a dot, letters by name joined, ordinary words joined with nothing between them ("ralf punkt sepp ät gmail punkt com" is ralf.sepp@gmail.com, "ralf sepp" is ralfsepp). A word after a dot is a domain ending, never a letter name (".ee" is Estonia, not the letter e). |
| tel | Digits only, a leading + kept ("pluss kolm seitse kaks viis üks kaks kolm neli viis kuus seitse" is +37251234567). |
| code | Digits and letters, no spaces; "suur a" is A (an ID code, a PIN, a one-time code). |
| number | A number with a decimal point ("viis koma kaks" is 5.2), a leading minus kept; with no digit at all the words stay. |
| password | Spelled letters, digits and words joined with nothing; "suur a" is A. |

`kind` may also be `auto`, which chooses by content (an "ät" is an e-mail address, half or more number tokens a code, else text); the core itself always passes the kind of the field.

**What a field is for.** `fieldKindOf(input)` in `extension/src/box.ts`, in order of trust: the `type` (email, tel, number, password); the `inputmode` (tel, email, decimal is number; numeric is number when the clues say an amount, `NUMBER_CLUE`: summa, kogus, number, arv, amount, quantity, sum, and not a code, else code); `autocomplete` (email, tel, one-time-code and cc-number are code, password, username is email when the clues hold @ or e-mail and else goes by the clues); then the words of its name, id, placeholder, aria-label and `<label>` text: `EMAIL_CLUE` (e-post, e-mail, meil, meiliaadress, username, kasutajanimi), `TEL_CLUE` (telefon, phone, tel, mobiil, mobile), `CODE_CLUE` (isikukood, personal code, id code, national id, kood, pin, otp, kinnituskood, turvakood, code, verification), `NUMBER_CLUE`; else text. `boxState` reports every `<input>` with `single: true` and its `fieldKind` (a search box stays kind `search` with fieldKind text); a textarea or a contenteditable has neither, so a composer is unchanged. `label` now falls back to the `<label for>` text. The model's box line says `single=true fieldKind=code label="Isikukood"` (22.3).

**`single`: no preview, wait-first, replaced whole.** `inpagePreview` returns null for a single box, so no half-heard word is ever typed into a login. In the engine dictation into an armed single field is wait-first (25.2): the model is asked before anything is typed, its `dictate` carries the words as he said them (the prompt's "Form fields" paragraph: "kolm üheksa null kaks", never pre-converted, never tidied into a sentence; spoken number words that are a value for the field are dictation, not a label number), and `applyIntent` converts them for the field. On the page `setText` on an `<input>` always selects and replaces the whole value with the text the core sent, never types at the end of it, because nothing was previewed.

**The join and the kind.** `act`'s `dictate` writes `joinField(box.text, words, kind)` with `kind = action.spell ?? session.spell ?? box.fieldKind ?? 'text'`: text keeps the sentence rules of 21.1; email, tel, code, number and password are appended as converted, with no space, no capital and no full stop, so a code said in two breaths joins up. The old text goes onto `undo` as for any dictation.

**The read-back line.** For a single box the line is `inpage.typedInto` with the field as it now reads: "Kirjutasin: 39002100001 (ütle „edasi“ või „valmis“)", both from `act` (the text it sent) and from `inpageResult` (the box the page read back); a password field is read back as one dot per character (`readBack`). Everywhere else the line stays "Kirjutasin." / `browserDoing`.

**The modes.** `session.spell` (`InpageSession`, null at the start): "numbritena", "numbrid", "numbritega", "kirjuta numbritena", "kirjuta numbrid", "kirjuta numbritega" / "as digits", "in digits", "digits", "write as digits", "write digits", "write in digits" set it to code (number words become digits, no spaces, whatever field is in front; the line "Kirjutan numbritena."); "tavaliselt", "tähtedena", "sõnadena", "kirjuta tavaliselt", "kirjuta tähtedena", "kirjuta sõnadena" / "normally", "as words", "in words", "write normally", "write as words", "write in words" clear it ("Kirjutan tavaliselt."). Instant, in the one-letter vocabulary, no command, the box and the labels untouched; it holds until he says otherwise, across pages. The live preview uses the same kind, so a text box in digits mode shows digits as he speaks.

**"kirjuta kood X".** `SPELLED`, over the raw utterance: kirjuta, sisesta, trüki / type, write, enter, then a kind word, then X: number, numbrid, numbritena, numbrina, summa (number); kood, koodi, koodina, code, pin (code); e-post, eposti, meil, meili, e-mail, email (email); telefon, telefoni, telefoninumber, tel, phone, phone number (tel); parool, parooli, password (password). X is converted for that kind, this utterance only, and appended as above. It is a command in its own right: `ask` is not set, so it is never sent to the model, is typed by the rules at once even in a single field (the one way to put a value into a one-line field without the model), is not instant (the sentence may still grow), and is never previewed (the pending set holds every "kirjuta kood", "sisesta e-post" start). It needs an armed box like dictation. "sisesta kell viis" has no kind word and stays typing at the caret (21.1).

**The form keys.** `FORM_KEYS`, checked in `inpageStep` before every other rule when the box is present, armed and single and Ütle is awake: valmis, olen valmis, edasi, järgmine väli / done, next, next field are `pressKey{Tab}`; kinnita, sisesta, enter, logi sisse, saada vorm, esita vorm / confirm, submit, log in, login, sign in, submit the form, send the form are `pressKey{Enter}`. They act whatever the box holds (the soft-word rule of 22 does not apply in a form field: a PIN is not a message); outside a single field "edasi" stays history forward and "kinnita", "enter", "sisesta" stay the soft Enter. Tab arms the field it lands in (21.1), so "valmis" then the next value needs no click.

**Implicit submission.** `pressKey{Enter}` on an `<input>` inside a form, when no handler cancelled the key, submits the form as a real Enter does (`implicitSubmit` in `page.ts`): `requestSubmit` with the form's first submit button (a `button` without a type, `button[type=submit]`, `input[type=submit]`, `input[type=image]`), or with none only when the form has exactly one text input; a disabled or detached button submits nothing, as a real Enter would do nothing. So "kinnita" on a Smart-ID-like page presses "Logi sisse".

**Passwords.** The strip reads a password field back as dots, and the server's user turn prints its text as dots; the server never logs document text in any case (the rule in `CLAUDE.md`).

Contract: `FieldKind` and `BoxState.fieldKind`, `BoxState.single` in `src/browser/protocol.ts`; `InpageSession.spell`; the prompt's "Form fields" paragraph and the box line in `server/intentPrompt.ts`. Strings (`inpage`): `spellDigits`, `spellWords`, `typedInto`. Tests: `src/core/spelling.test.ts` (99 cases), `src/core/inpage.test.ts` (the modes, "kirjuta kood", the form keys, the single read-back, no preview), `extension/test/run.ts` on `fixtures/login.html` (a Smart-ID-like form: Isikukood with `inputmode=numeric` and a label is code, Telefon `type=tel` is tel, E-post `type=email` is email, Summa `inputmode=decimal` is number, PIN1 `type=password` is password, Märkused is a textarea with neither; the converted values typed and read back, a one-line field replaced whole, Tab lands in and arms the next field, Enter counts one submit) and the Gmail stand-in's To field (single, fieldKind text, label from `<label for>`). Not verified without a person: the real Smart-ID page and real bank forms (their field markup, whether their scripts take a synthetic Enter), and how the recogniser writes "ät", "punkt" and a string of digits in his voice.

### 25.2 Care for the model, never stuck, single fields first (BRAIN lane)

The owner's report after the demo with the real user, items two and three: "for long prompts it should take some time to think about what is really wanted; with a very long message it hurried to act too fast, but it can't come at the cost of executing short commands efficiently", and "it got stuck thinking at one point and became unusable for a few minutes". Three parts: how hard the model thinks, bounded by what he said; nothing in the engine can wait forever; and a one-line form field is verified before anything is typed.

**Care.** `IntentRequest.care` is `'quick'` or `'careful'`; the engine decides per ask (`careOf` in `extension/src/engine.ts`) and the server maps it. An ask is **careful** when any of these holds: the utterance has `CAREFUL_WORDS` (8) words or more; it holds a connective anywhere after its first word (`hasConnective` in `src/core/chain.ts`: ja, siis, ja siis, pärast seda, seejärel, ning, then, and then, after that; this covers `endsWithConnective`); or the job has a chain (`job.chain !== null`, so every ask of a chain after the first, and every continued utterance). Everything else is **quick**, so "keri alla", "ava youtube", "saada" keep their speed. On the server (`server/intent.ts`, `careSettings`): quick is `output_config.effort: 'low'`, `max_tokens 400`, SDK timeout `INTENT_TIMEOUT_MS` 7 s, as before; careful is `effort: 'high'`, `max_tokens 800`, `INTENT_TIMEOUT_CAREFUL_MS` 12 s, and the system prompt gains `CAREFUL_PROMPT` ("Read the whole utterance before acting. List every goal in `plan` in order, in his words. Choose the first action only after the plan is complete. Prefer one safe action over a fast guess.") as a *second* system text block, sent only then, so the cached first block is byte-identical on every call. The engine waits `ASK_TIMEOUT_MS` 9 s for a quick ask and `ASK_TIMEOUT_CAREFUL_MS` 14 s for a careful one (`askTimeoutMs(care)`; `offscreenMain.askIntent` ends the fetch one second after that). While a careful ask runs in the wait-first path the strip line is `inpage.thinkingLong` ("Mõtlen pikemalt…") instead of "Mõtlen…". The log line is `[intent] kind=… done=… plan=… care=<quick|careful> ms=…`. The eval (`scripts/intent-eval.ts`) sends care the way the engine chooses it (careful for every ask of a chain case) and prints it per ask. **Expected latency, not measured here:** round 3 measured Sonnet 5.5 at low effort at p50 about 1 s per ask on the eval; a careful ask spends more output tokens on thinking and planning and should land a few seconds later, inside the 12 s server cap; a short command is unchanged. Whoever runs the eval with a key should read the p50 per care from its output.

**Never stuck.** Five guards, all in the engine:
- *Watchdog.* `JOB_WATCHDOG_MS` 25 s per job, started when the job begins working (its turn in the queue, or its verification) and restarted at every goal of a chain, so a chain that moves is never given up as a whole while `MAX_CHAIN_MS` (90 s) still bounds it. When it fires the job is given up as a barge-in would give it up: the question in flight is aborted, no further step or goal is asked for, the page command in hand finishes but its late result line is not shown, the chain line clears, `thinking` is reset to 0, `busySeconds` to 0, and the line says `inpage.tookTooLong` ("Võttis liiga kaua, katkestasin."). The words of a type-first dictation whose verification is given up stay.
- *Busy seconds.* `StripState.busySeconds`: while any job works, the engine publishes the elapsed seconds of the longest-running one every second from `BUSY_FROM_S` (3) on, and 0 once none works (published on change only). The strip renders it next to the thinking dots ("Mõtlen… 7 s"), inside `render`.
- *The voice escape.* The core rule (`isCancelAll` in `src/core/inpage.ts`, before every other rule, asleep or not): "katkesta", "tühista kõik", "lõpeta kõik", "stopp kõik", "cancel", "cancel everything" give `InpageStep { cancel: true, commands: [], line: inpage.cancelled }` ("Katkestatud."); instant (`inpageInstant` true), never previewed, never a soft word, never reached by a correction, and "katkesta sõnum" stays the clear. The engine recognises it in `onUtterance` through the rules' probe, before any queueing: every job is given up and marked dropped (the queued ones do nothing at all, not even the rules' step; a running one shows no further line), every question in flight is aborted, the live preview is taken back, the chain line, the dots and the seconds are cleared, and the model is never asked about the utterance.
- *Thinking cannot drift.* The counter is clamped at 0 and reset by the cancel and the watchdog; the jobs' own decrements then clamp.
- *A page command cannot hang the engine.* `runSafe` races every command against `COMMAND_TIMEOUT_MS` 20 s and answers `failed` with the message `timed_out` (the bridge's `BRIDGE_COMMAND_TIMEOUT_MS` is 20 s too, and background's `utle-run` has no timer of its own, so a page script that never answers was the one remaining way to wait forever). The worst a single goal can now take is a careful ask (14 s) plus a command (20 s), and the watchdog cuts that at 25 s.

**Single fields are verified first.** With `box.single === true` (a one-line field: name, email, phone, code, round 5's FIELDS lane sets it) dictation is wait-first as for an unarmed box: nothing is typed until the model answers; its `dictate` is typed through `applyIntent` (the core converts the words for the field's kind); no answer, a timeout or a barge-in types nothing and the line says `inpage.fieldUnverified` ("Abiline ei vastanud, välja ei kirjutanud."). With no model at all (`no_model`) the rules' typing stands, as everywhere. Everything else keeps type-first (22.2). The review's M7 guard applies in `verify`: for an utterance of `LONG_COMMAND_WORDS` (14) words or more typed first, a verdict that is one plain `command` with `done` true and no `plan` does not take the words back and runs nothing; the line says `inpage.keptWords` ("Pikk lause jäi kasti, käsku ei täitnud."). A verdict with a plan or `done: false` (a chain) still runs.

**Review M8.** `src/speech/assembler.ts` measures the continuation window from the first speech activity after a delivery (`firstActivityAt`, set by `activity()` while nothing is held and cleared on every delivery), not from the final: "siis ava Karini viimane sõnum ja kustuta see kõigi jaoks" takes four seconds to say and still continues when its first word came within `CONTINUE_WINDOW_MS`. A quick reply released from a partial (`local.ts` `releaseInstant`) calls `assembler.noteDelivered(text)`, so "keri alla" settled early then "siis ava esimene" is a continuation too.

Constants: `CAREFUL_WORDS` 8, `ASK_TIMEOUT_CAREFUL_MS` 14 000, `INTENT_TIMEOUT_CAREFUL_MS` 12 000, `MAX_TOKENS_CAREFUL` 800, `JOB_WATCHDOG_MS` 25 000, `COMMAND_TIMEOUT_MS` 20 000, `BUSY_FROM_S` 3, `LONG_COMMAND_WORDS` 14. Strings (`inpage`): `thinkingLong`, `tookTooLong`, `cancelled`, `keptWords`, `fieldUnverified`. Tests: `extension/src/engine.test.ts` ("round 5, BRAIN lane", 17 cases: care per utterance and chain, the two timeouts, busy seconds, the watchdog and its per-goal restart, "katkesta" on a chain, on a verification with a live preview, and with words in the box, the single field in three cases, the long-sentence guard both ways, the command timeout); `server/intent.test.ts` ("care", effort, tokens, timeout, the second block, the log); `src/core/inpage.test.ts` (the cancel rule); `src/core/chain.test.ts` (`hasConnective`); `src/speech/assembler.test.ts` and `local.test.ts` (M8). Not verified without a person: the latency of a careful ask on the real model, and whether the recogniser hears "katkesta" as one word.

### 25.3 The page's size (ZOOM lane)

The owner's fifth report: he could not zoom or enlarge the text. Fixed phrases, no model, Chrome's own tab zoom so that text and layout grow together and the level sticks per site.

| Phrase (Estonian / English) | Command |
|---|---|
| suurenda, suurenda lehte, suumi sisse, tee suuremaks, suurem tekst, suurem kiri, tee tekst suuremaks / zoom in, bigger, make it bigger, larger text | `zoom{direction: 'in'}` |
| vähenda, vähenda lehte, suumi välja, tee väiksemaks, väiksem tekst, väiksem kiri / zoom out, smaller, make it smaller | `zoom{direction: 'out'}` |
| tavaline suurus, algne suurus, suumi tagasi / reset zoom, normal size | `zoom{direction: 'reset'}` |

The phrases live in `src/core/browserIntent.ts` (`FIXED`, Estonian first, English second): instant, in the one-letter vocabulary of 21.3 and in the preview's pending set, so "suur..." is never typed. The service worker (`background.ts`) reads `chrome.tabs.getZoom` for the target tab and steps it along 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300 %: `in` is the next step above the current level (300 at the top), `out` the next below (50 at the bottom), `reset` 100 %, then `chrome.tabs.setZoom`. Chrome keeps the level per site, as it does for its own Ctrl-plus. The lines are "Suurendan.", "Vähendan.", "Tavaline suurus." `zoom` changes nothing on the page, so `afterCommands` keeps the labels and the undo texts (22). The strip is drawn in the page's CSS pixels, so it scales with the page: at 200 % the bar is twice as big too, which is intended for a person who asked for larger text. The prompt lets the model answer `zoom` for a phrasing the rules do not hold. Tests: `extension/test/run.ts` steps 100 to 110, 125, 150 and back through `chrome.tabs.getZoom` and checks the strip still measures its CSS size at 150 %; `src/core/browserIntent.test.ts` and `inpage.test.ts` for the phrases. Not tried on a real site or with a real voice.
