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
| kustuta täht, kustuta üks täht, kustuta tagant, kustuta valitud / delete a letter, delete one letter, delete the letter, delete the selection, delete selection, backspace; kustuta N tähte / delete N letters | `pressKey{Backspace}`, N times | a box |
| kustuta see / delete this (round 7, review R3 M6) | after a step whose last command was a `select` (the session's `lastWasSelect`, set by `inpageResult`): `pressKey{Backspace}` on the selection, pushing the old text for "võta tagasi"; otherwise the box undo of the last utterance, as "võta tagasi" (says "Pole midagi tagasi võtta." when there is nothing, never one letter) | a box (armed for the undo) |
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

**Barge-in.** A new utterance interrupts every earlier job at its next safe point (`interrupt`): the page command in hand finishes, no further step of a multi-step loop is asked for (`interrupted`), and the question in flight is given up (`cancelled`: the `AbortController` passed through `deps.ask(request, signal)` is aborted; `askIntent` in `offscreenMain.ts` ends the fetch with it, and `askOnce` answers null). The interrupted utterance's strip line stays what its last step said. Round 7 (review R3 M3): only a job that has begun is cancelled (its turn came: `started`, a question in flight `controller`, the loop `looping`, or a verification `verifying`; `askOnce` sets the controller before it reads the page, so a barge-in during that read counts). A job still waiting its turn when a later utterance arrived is only interrupted: when its turn comes it runs the rules and, unless it waited longer than `STALE_MS`, is asked like any other, with no further step after the first. The exception is a plain send ("saada"): it does not touch a verification that is still judging (nothing is sent while the box is being judged, so it waits for it instead), it marks every other job interrupted, and it cancels only a job that is already in its loop (`looping`, past its first step); a verification that has already found a command and is acting on it is interrupted like any other. A verification given up leaves the typed words in place. Round 4 adds two exceptions (24.1): a plain send waits behind a job that is working through a chain of goals instead of interrupting it, and a continued utterance ("siis ava Karin") interrupts nothing.

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

**Lag** (round 7, review R3 M4). A frame for Soniox is dropped, never queued, when the upstream
socket's `bufferedAmount` exceeds `SONIOX_MAX_BUFFERED_BYTES` (64 000 bytes, 2 s of 16 kHz 16-bit
PCM: the network is not taking the audio), and the browser gets `lag` with the queue's length in
ms; the next frame that goes is preceded by `lag` 0, as `src/speech/local.ts` does on its side.

**Logged.** `[soniox] connecting`, `session open`, `browser closed, code N`, `error N: message`
(the message clipped to 200 characters, and left out for 401 and 403, whose message can echo the
key), `closed by Soniox, code N`. Never audio, never text.

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

### 24.2 The owner's voice (VOICE lane, round 4; SPEECH lane, round 7)

The owner's words after the demo: "the microphone keeps picking up background conversations, so it needs a totally quiet environment." Push-to-talk by gaze (23.3) is one half of the answer: the microphone is open only while he looks. This is the other half: the server knows his voice, and with **Kuula ainult mind** on, only his voice is obeyed. Nothing changes for anyone who never teaches it: no profile, no `speaker` on any final, the client delivers everything.

Round 7 rebuilt it after his report of 2026-10-20: "I had my voice learnt, then had my friend talk next to me, his voice was picked up fully. Mine was too, the background noise was as well. It didn't make a difference." Three causes, all fixed here: (1) a band between two thresholds (0.35 to 0.55) was `unknown` and obeyed, and nothing had been measured, so a friend at 0.4 passed; (2) judge embedded the whole utterance with its silences while enrolment embedded speech only, so his own recording scored 0.34 against itself on the round 4 model (0.388 in the HOST lane's run); (3) that model (WeSpeaker CAM++) does not separate voices on short Estonian utterances at all (below). Noise typed as words was a fourth: the decoder saw every frame.

**The speech detector** (`server/vad.ts`). Silero VAD v5 (`silero_vad_v5.onnx`, 2 313 101 bytes, sherpa-onnx's `asr-models` release; MIT) runs in front of the decoder, one detector per stream (about 70 ms to make, 0.6 ms per 100 ms frame). While it detects speech each frame goes to the recogniser as heard. While it does not, the frame goes at once as a faint fixed hiss of the same length (uniform noise of amplitude `QUIET_AMPLITUDE`, 1e-4, about -85 dBFS, the same sequence every run), so the recogniser's endpoint rules still count trailing silence and finals come no later than before; the newest `PRE_ROLL_MS` (400 ms) of such frames are remembered and, when speech starts, go to the recogniser again as audio, before the first detected frame: Silero says "speech" 0.1 to 0.2 s after a word begins, and the pre-roll keeps that onset. Only speech frames are kept for the speaker gate, for enrolment and for capture. Settings: threshold 0.5, minimum speech 0.05 s, minimum silence 0.5 s. v5 and not v4 (`silero_vad.onnx`, 644 kB): through Chrome's microphone path v4 missed the quiet one-word "üks" at every threshold above 0.2; v5 finds it at 0.5, and neither finds anything in 20 s of pink noise at -30 dBFS. Without the file the server decodes every frame as before round 7 and logs `[asr] no vad model`; with it, `[asr] vad model loaded`. `npm run model` fetches it as a third, optional file. An endpoint in the middle of a burst (the remembered frames end an utterance) leaves the rest of the burst for the next frame; none is lost.

Why a hiss and 0.05 s (SPEECH lane defect round, 2026-10-21): with digital zeros and 0.1 s the recorded-speech suite (`extension/test/voice.ts`) lost short one-word utterances two ways, found by timestamping every server message against the extension's strip states and then replaying the audio a live socket received through the decoder with and without the detector and the hotwords. (1) Silero missed "üks" outright at some phases of its 32 ms windows: the word is above the threshold for barely 0.1 s; at 16 phases times 3 gains of `et-numbers-one`, 0.1 s missed it 3 times in 96 and 0.05 s never (no word of the other fixtures missed either way; 20 s of pink noise at -30 and -20 dBFS: no speech at either). That was case 6's failure: "üks" never reached the recogniser. (2) On exact zeros after a short last word the recogniser's best hypothesis could turn empty, and the stream then ended by the 2.4 s rule with no words: "Saada" then nothing (`scripts/fixtures/live-vad-saada-16k.wav`, a live session's audio; 4 of 21 recorded live sessions on replay; with the hiss all 21 finalise "Saada"). The hotwords were not involved (the same with them off). The hiss plus 0.05 s made a lone "." of the sentence fixture's tail, so the session now sends no partial and no final whose text has no letter or digit. With both, the suite passed 3 of 3 full runs.

**The model** (`server/speaker.ts`, `server/speakerModel.ts`). NVIDIA NeMo TitaNet small (`nemo_en_titanet_small.onnx`, 40 257 283 bytes, sherpa-onnx's speaker-recognition release; the NeMo Toolkit's licence, Apache-2.0; 192-dimensional embeddings), about 20 ms per utterance on one thread. Round 4's CAM++ (512-dimensional, not 192 as round 4's comment said) was measured on the calibration set below: after the fix to judge, other voices still scored up to 0.85 and the best single threshold dropped 7 of 9 owner clips; its embedding of the first 2 s of a sentence scored 0.29 against the first 3 s of the same sentence. TitaNet, ERes2Net and ResNet34 were steady on that test (0.89 to 0.97); TitaNet separated the set best and was the fastest. `npm run model` downloads it as the second, optional step. A profile made with another model (every round 4 profile) is judged by loudness only until he teaches his voice again.

**The profile.** `models/speaker/owner.json`: `{ version: 1, model, embedding: number[], rms, seconds, phrases }`. The embedding is unit length; `rms` is the mean RMS of the speech frames; `phrases` is how many read phrases it is the mean of (0 for the free-speech enrolment). Never audio. Loaded once when the gate is made (in the decode worker, or on the server thread), replaced at the next enrolment.

**The verdict** (`createSpeakerGate(extractor, { profilePath })`). Enrolment, a read phrase and judge embed the same samples: the frames at or above `SILENCE_RMS` (`speechOnly`, `embeddedSamples`), so his own recording judged against his own profile scores 1.000 (it scored 0.34 before on CAM++, 0.89 on TitaNet). `judge(frames)` is `owner` at or above `OWNER_THRESHOLD` and `other` below it: one threshold, no band. 0.54 is `scripts/speaker-calibrate.ts`'s pick on `scripts/fixtures/speaker-set` (`scores.json` there): the closest other voice scored 0.499, the stand-in owner's utterances with 0.6 s of speech or more 0.622 to 0.760. `unknown` remains for an utterance with less than `MIN_JUDGE_SECONDS` (0.5 s) of speech, and for an extractor that throws or a score that is not a number. Without a profile, and (round 7) without a model to compare with when the speech is loud enough (the energy gate's pass), `judge` answers null and the final carries no speaker; null is obeyed even in strict mode, so a missing model never locks him out. The energy gate still calls speech fainter than `ENERGY_OTHER_RATIO` (40 %) of the enrolled RMS `other`.

What one threshold costs: the stand-in owner's one-word utterances ("jah", "saada", "üks": 0.4 to 0.5 s of speech) scored 0.14 to 0.27, below every threshold that drops the other voices. Half a second of voice is too little for this model; there is no threshold that keeps them and drops a friend's.

**Continuity** (round 7, SPEECH lane defect round; `continued` in `server/speaker.ts`, applied in `server/asrSession.ts`). So the one-word commands are judged by who spoke last instead: an utterance with under `SHORT_UTTERANCE_SECONDS` (1.0 s) of speech is `owner` when this session delivered an owner final judged on its score at most `CONTINUITY_MS` (10 000 ms) before it, whatever it scored; otherwise it is judged as above (and `unknown` under `MIN_JUDGE_SECONDS`). The numbers that justify it: the stand-in owner's one-word clips have 0.4 to 0.5 s of speech and score 0.14 to 0.27, below every other voice's best (0.499); his utterances of 0.6 s of speech or more score 0.62 to 0.76, so the sentence before a "saada" or the "keri alla" before a "veel" is judged on its own and opens the window. Only a final the score judged owner opens or extends the window, whatever its length (a short one the score already calls `owner` keeps the score as its reason and is never relabelled); a word continuity let through does not extend it, and an `other` final closes it, so a friend's short words pass only within ten seconds of the owner speaking and never after the friend says something long. An utterance of 1.0 s of speech or more is never covered. `judge` now returns `seconds` (speech seconds, `speechOnly`) with every verdict, which the rule needs; a verdict without it is never changed. The server log line names the reason and never the text: `[asr] final judged owner 0.168 continuity (only owner on)` (`judgedLine` in `server/asr.ts`). The wire format is unchanged: the final carries `speaker: 'owner'`.

**The calibration set and harness.** `scripts/speaker-set.ts` builds `scripts/fixtures/speaker-set/`: `owner-*.wav` are the five recogniser fixtures cut into nine utterances by the speech detector (0.25 s before, 0.5 s after, as the live path keeps them); they are TartuNLP's synthetic voice "mari", the stand-in owner, because there is no recording of the owner on disk. `other-*.wav` are three utterances from each of six other TartuNLP Estonian voices (albert, kalev, meelis, kylli, vesta, liivika) and the two longest owner utterances played 1.2 times as fast (pitch and tempo up 20 %), the hard negative. Every clip has a noise floor of about -66 dBFS: a microphone never gives digital silence. `npx tsx scripts/speaker-calibrate.ts <dir>` (or `--owner <dir> --other <dir>` for capture folders) enrols the owner clips through the real gate into a temporary profile (one phrase per clip, the mean), scores each owner clip against the mean of the others (leave one out) and each other clip against all of them, prints every score with the gate's verdict, the owner minimum, the other maximum and the threshold with the fewest errors (ties toward dropping others, then the middle of the gap), and writes `<dir>/scores.json`. `--model <file>` measures another model in `models/speaker/`; `--profile <owner.json>` also scores every clip against a stored profile with the model that made it (the real round 4 profile, on CAM++'s scale: every synthetic clip at most 0.346).

**Scripted enrolment.** `src/core/enrolPhrases.ts` holds twelve Estonian sentences that together contain õ, ä, ö, ü, the three vowel lengths (sada, kooli, saada) and the command words of `browserIntent.ts`'s tables and the engine's own (ava, keri, saada, kustuta, tagasi, valmis, katkesta, uus leht and the rest; the test lists them). The settings page's **Õpeta mu hääl lausetega** shows them one at a time with "1 / 12" and sends `utle-enrol-script {phrases: 12}`; the offscreen document starts the engine's enrolment (listening on, what he reads neither typed nor run) and the recogniser sends `{"type":"enrolScript","phrases":12}` (1 to `MAX_ENROL_PHRASES`, 30). From then each utterance that ends with words (an endpoint, or a flush) is one phrase: the decoder embeds its speech at once (`gate.phrase`, at least `MIN_PHRASE_SECONDS`, 0.8 s, of speech; the audio is not kept) and answers `{"type":"enrolPhrase","count":n}`; the offscreen document publishes `enrolPhrases: n` in the strip's state and the settings page shows phrase n + 1. At the twelfth, or at `{"type":"enrolFinish"}` (the page's **Valmis**), the profile is the mean of the phrase embeddings at unit length (`gate.enrolPhrases`, at least `MIN_ENROL_SECONDS` of speech in all) and the server answers `{"type":"enrolled","ok":true,"seconds":s,"phrases":n}`. The bar says "Hääl on õpitud n lausest.", or, under `ENOUGH_PHRASES` (6), that the profile is thin; it is kept either way. **Õpeta vabalt rääkides** is round 4's eight seconds of free speech, kept as a fallback.

**Strict mode, in the client** (`src/speech/local.ts`). With `onlyOwner` on, a final whose speaker is `other` or `unknown` is dropped (`dropsFinal`); `owner` and a final without a speaker are delivered. Each drop calls `handlers.onForeign(streak)`, streak being the drops in a row (an obeyed final resets it). The offscreen document shows "Keegi teine rääkis, jätsin vahele." for every drop and, at the third in a row only (`retrainDue`, `RETRAIN_AFTER_DROPS` 3), also "Kui see olid sina, õpeta hääl uuesti seadetes." on the bar's line (`foreignNotice`). The engine takes back the dropped utterance's preview as in round 4. The server's close line counts `other` and `unknown` finals as dropped while the mode is on.

**In the session** (`server/asrSession.ts`, `server/asrWorker.ts`). As round 4: the decoder keeps the frames of the utterance in progress (now speech only, the newest `MAX_KEPT_MS`, 8 s), judges before it sends a final, at an endpoint and at a flush, and the final carries `speaker` in the same frame. A judge that throws loses the verdict, not the words. `{"type":"enrol","seconds":N}` is the free-speech enrolment, as before. The worker carries `enrolScript`, `enrolFinish` and `capture` messages and answers `enrolPhrase` and `scripted`.

**Capture for calibration** (`server/capture.ts`). With `UTLE_CAPTURE=<dir>` the server writes each final's judged speech frames as `<dir>/<timestamp>-<speaker>-<score>.wav` (16-bit, 16 kHz; speaker `none` without a profile) and appends `<file>\t<score>\t<speaker>\t<heard text>` to `<dir>/log.tsv`. It is for calibration on the owner's own machine only: the folder holds his voice and his words. Without the variable nothing is written and no text goes anywhere; the console never gets text either way (`[asr] final judged other 0.312 (only owner on)` is numbers only).

| Setting | Values (default first) | What |
|---|---|---|
| `onlyOwner` | `false`, `true` | Strict mode: only the owner's voice is obeyed. Needs the learnt voice and the speaker model; without the model only much fainter speech is dropped. |

Tests: `server/speaker.test.ts` (one threshold, the self-score of a recording with silences, scripted enrolment's mean and count, the threshold picker, the energy gate's null, "continuity": the seconds on a verdict and `continued`), `server/asrSession.test.ts` ("continuity": a short word after an owner final passes, after 10 s or after an `other` final it is judged, a long utterance never passes; the speech detector with a fake: 20 s of noise gives no partial and no final, the pre-roll, the burst after an endpoint, speech only for the gate; strict counting; scripted enrolment; capture), `server/asr.test.ts` (the new frames, the VAD log line), `src/speech/local.test.ts` (strict mode on and off, the streak and the third-drop line, scripted enrolment's messages), `extension/src/offscreenMain.test.ts` (the strip's lines), `src/core/enrolPhrases.test.ts`, and the browser suite's settings case (`extension/test/out/enrol.png`). Not verified: a real voice through any of it (HANDOFF 1g).

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

**Care.** `IntentRequest.care` is `'quick'` or `'careful'`; the engine decides per ask (`careOf` in `extension/src/engine.ts`) and the server maps it. An ask is **careful** when any of these holds: the utterance has `CAREFUL_WORDS` (8) words or more; it holds a connective anywhere after its first word (`hasConnective` in `src/core/chain.ts`: ja, siis, ja siis, pärast seda, seejärel, ning, then, and then, after that; this covers `endsWithConnective`); or the job has a chain (`job.chain !== null`, so every ask of a chain after the first, and every continued utterance). Everything else is **quick**, so "keri alla", "ava youtube", "saada" keep their speed. On the server (`server/intent.ts`, `careSettings`): quick is `output_config.effort: 'low'`, `max_tokens 400`, SDK timeout `INTENT_TIMEOUT_MS` 7 s, as before; careful is `effort: 'high'`, `max_tokens 2000`, `INTENT_TIMEOUT_CAREFUL_MS` 12 s, and the system prompt gains `CAREFUL_PROMPT` ("Read the whole utterance before acting. List every goal in `plan` in order, in his words. Choose the first action only after the plan is complete. Prefer one safe action over a fast guess.") as a *second* system text block, sent only then, so the cached first block is byte-identical on every call. The engine waits `ASK_TIMEOUT_MS` 9 s for a quick ask and `ASK_TIMEOUT_CAREFUL_MS` 14 s for a careful one (`askTimeoutMs(care)`; `offscreenMain.askIntent` ends the fetch one second after that). While a careful ask runs in the wait-first path the strip line is `inpage.thinkingLong` ("Mõtlen pikemalt…") instead of "Mõtlen…". The log line is `[intent] kind=… done=… plan=… care=<quick|careful> ms=…`. The eval (`scripts/intent-eval.ts`) sends care the way the engine chooses it (careful for every ask of a chain case) and prints it per ask. **Expected latency, not measured here:** round 3 measured Sonnet 5.5 at low effort at p50 about 1 s per ask on the eval; a careful ask spends more output tokens on thinking and planning and should land a few seconds later, inside the 12 s server cap; a short command is unchanged. Whoever runs the eval with a key should read the p50 per care from its output.

**Never stuck.** Five guards, all in the engine:
- *Watchdog.* `JOB_WATCHDOG_MS` 25 s per job, started when the job begins working (its turn in the queue, or its verification) and restarted at every goal of a chain, so a chain that moves is never given up as a whole while `MAX_CHAIN_MS` (90 s) still bounds it. When it fires the job is given up as a barge-in would give it up: the question in flight is aborted, no further step or goal is asked for, the page command in hand finishes but its late result line is not shown, the chain line clears, `thinking` is reset to 0, `busySeconds` to 0, and the line says `inpage.tookTooLong` ("Võttis liiga kaua, katkestasin."). The words of a type-first dictation whose verification is given up stay.
- *Busy seconds.* `StripState.busySeconds`: while any job works, the engine publishes the elapsed seconds of the longest-running one every second from `BUSY_FROM_S` (3) on, and 0 once none works (published on change only). The strip renders it next to the thinking dots ("Mõtlen… 7 s"), inside `render`.
- *The voice escape.* The core rule (`isCancelAll` in `src/core/inpage.ts`, before every other rule, asleep or not): "katkesta", "tühista kõik", "lõpeta kõik", "stopp kõik", "cancel", "cancel everything", and (review of round 5) an utterance ending in one of them after a connective ("tulen homme ja katkesta": the assembler held the words before the connective and joined "katkesta" to them, so the cancel arrives at the end of the 2.5 s hold, with the held words dropped) give `InpageStep { cancel: true, commands: [], line: inpage.cancelled }` ("Katkestatud."); instant (`inpageInstant` true), never previewed, never a soft word, never reached by a correction, and "katkesta sõnum" stays the clear. The engine recognises it in `onUtterance` through the rules' probe, before any queueing: every job is given up and marked dropped (the queued ones do nothing at all, not even the rules' step; a running one shows no further line), every question in flight is aborted, the live preview is taken back, the chain line, the dots and the seconds are cleared, and the model is never asked about the utterance.
- *Thinking cannot drift.* The counter is clamped at 0 and reset by the cancel and the watchdog; the jobs' own decrements then clamp.
- *A page command cannot hang the engine.* `runSafe` races every command against `COMMAND_TIMEOUT_MS` 20 s and answers `failed` with the message `timed_out` (the bridge's `BRIDGE_COMMAND_TIMEOUT_MS` is 20 s too, and background's `utle-run` has no timer of its own, so a page script that never answers was the one remaining way to wait forever). The worst a single goal can now take is a careful ask (14 s) plus a command (20 s), and the watchdog cuts that at 25 s.

**Single fields are verified first.** With `box.single === true` (a one-line field: name, email, phone, code, round 5's FIELDS lane sets it) dictation is wait-first as for an unarmed box: nothing is typed until the model answers; its `dictate` is typed through `applyIntent` (the core converts the words for the field's kind); no answer, a timeout or a barge-in types nothing and the line says `inpage.fieldUnverified` ("Abiline ei vastanud, välja ei kirjutanud."). With no model at all (`no_model`) the rules' typing stands, as everywhere. Review of round 5 (`docs/REVIEW-R5.md`): two kinds of dictation into an armed single field are typed by the rules at once, with no ask at all (`directValue` in `src/core/inpage.ts`, so `InpageStep.ask` is unset): anything into a `password` field (a secret never reaches the model), and an utterance that is nothing but a value (`spokenValueOnly` in `src/core/spelling.ts`: number words, digits and symbol words with at least one number, "kolm üheksa null kaks", "pluss kolm seitse kaks") into a `code`, `tel` or `number` field, or into any single field while "numbritena" is on; such words are never a command, and asking would have cost a careful ask (eleven digits are eleven words) and risked a `switchTab` verdict. And when the model answers `unclear` with no plan for an armed single field, the rules' typing runs (he armed the field himself; "võta tagasi" undoes it), as type-first does elsewhere; an unarmed field still gets nothing. Everything else keeps type-first (22.2). The review's M7 guard applies in `verify`: for an utterance of `LONG_COMMAND_WORDS` (14) words or more typed first, a verdict that is one plain `command` with `done` true and no `plan` does not take the words back and runs nothing; the line says `inpage.keptWords` ("Pikk lause jäi kasti, käsku ei täitnud."). A verdict with a plan or `done: false` (a chain) still runs.

**Review M8.** `src/speech/assembler.ts` measures the continuation window from the first speech activity after a delivery (`firstActivityAt`, set by `activity()` while nothing is held and cleared on every delivery), not from the final: "siis ava Karini viimane sõnum ja kustuta see kõigi jaoks" takes four seconds to say and still continues when its first word came within `CONTINUE_WINDOW_MS`. A quick reply released from a partial (`local.ts` `releaseInstant`) calls `assembler.noteDelivered(text)`, so "keri alla" settled early then "siis ava esimene" is a continuation too.

Constants: `CAREFUL_WORDS` 8, `ASK_TIMEOUT_CAREFUL_MS` 14 000, `INTENT_TIMEOUT_CAREFUL_MS` 12 000, `MAX_TOKENS_CAREFUL` 2000, `JOB_WATCHDOG_MS` 25 000, `COMMAND_TIMEOUT_MS` 20 000, `BUSY_FROM_S` 3, `LONG_COMMAND_WORDS` 14. Strings (`inpage`): `thinkingLong`, `tookTooLong`, `cancelled`, `keptWords`, `fieldUnverified`. Tests: `extension/src/engine.test.ts` ("round 5, BRAIN lane", 17 cases: care per utterance and chain, the two timeouts, busy seconds, the watchdog and its per-goal restart, "katkesta" on a chain, on a verification with a live preview, and with words in the box, the single field in three cases, the long-sentence guard both ways, the command timeout); `server/intent.test.ts` ("care", effort, tokens, timeout, the second block, the log); `src/core/inpage.test.ts` (the cancel rule); `src/core/chain.test.ts` (`hasConnective`); `src/speech/assembler.test.ts` and `local.test.ts` (M8). Not verified without a person: the latency of a careful ask on the real model, and whether the recogniser hears "katkesta" as one word.

### 25.3 The page's size (ZOOM lane)

The owner's fifth report: he could not zoom or enlarge the text. Fixed phrases, no model, Chrome's own tab zoom so that text and layout grow together and the level sticks per site.

| Phrase (Estonian / English) | Command |
|---|---|
| suurenda, suurenda lehte, suumi sisse, tee suuremaks, suurem tekst, suurem kiri, tee tekst suuremaks / zoom in, bigger, make it bigger, larger text | `zoom{direction: 'in'}` |
| vähenda, vähenda lehte, suumi välja, tee väiksemaks, väiksem tekst, väiksem kiri / zoom out, smaller, make it smaller | `zoom{direction: 'out'}` |
| tavaline suurus, algne suurus, suumi tagasi / reset zoom, normal size | `zoom{direction: 'reset'}` |

The phrases live in `src/core/browserIntent.ts` (`FIXED`, Estonian first, English second): instant, in the one-letter vocabulary of 21.3 and in the preview's pending set, so "suur..." is never typed. The service worker (`background.ts`) reads `chrome.tabs.getZoom` for the target tab and steps it along 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300 %: `in` is the next step above the current level (300 at the top), `out` the next below (50 at the bottom), `reset` 100 %, then `chrome.tabs.setZoom`. Chrome keeps the level per site, as it does for its own Ctrl-plus. The lines are "Suurendan.", "Vähendan.", "Tavaline suurus." `zoom` changes nothing on the page, so `afterCommands` keeps the labels and the undo texts (22). The strip is drawn in the page's CSS pixels, so it scales with the page: at 200 % the bar is twice as big too, which is intended for a person who asked for larger text. The prompt lets the model answer `zoom` for a phrasing the rules do not hold. Tests: `extension/test/run.ts` steps 100 to 110, 125, 150 and back through `chrome.tabs.getZoom` and checks the strip still measures its CSS size at 150 %; `src/core/browserIntent.test.ts` and `inpage.test.ts` for the phrases. Not tried on a real site or with a real voice.

## 26. Round 6: Minu andmed, saved values put in by voice (2026-10-06, evening)

The owner, after round 5: "Inserting an e-mail, a phone number or an ID code is very hard." Round 5 made spelling possible (25.1); this section makes it unnecessary after the first time. He, or Tom (his carer, who has hands), saves an e-mail address, a phone number or an ID code once; afterwards "pane mu email sinna" puts it into any field, with no fixed phrasing. One lane (SAVED) on branch `r6-saved`. Nothing here has met a real voice or a real site; what is proven is in the unit tests, the browser suite and the eval.

### 26.1 Storage: the values never leave the machine

`chrome.storage.local` key `savedValues`: an array of `SavedItem { id, name, value, kind, aliases? }` (`src/core/saved.ts`), `kind` one of `email`, `tel`, `code`, `number`, `text`, never `password` (a secret is not stored). `savedFrom(stored)` cleans what storage holds: an entry without a string id, name and value or with another kind is dropped; names are cut to `SAVED_NAME_CHARS` (60) and values to `SAVED_VALUE_CHARS` (200); at most `MAX_SAVED` (50) entries.

The offscreen engine cannot read `chrome.storage` (an offscreen document has `chrome.runtime` only), so the service worker hands the list over: the offscreen document asks once at start (`utle-saved`, answered `{ items }`), and the worker sends `{ target: 'offscreen', type: 'saved', items }` on every change of the key (only when the document exists; it is never created for this). The engine keeps the list on the session (`InpageSession.saved`), where the rules and `applyIntent` find it. The model is told the NAMES only: the engine's `readPage` adds `page.saved = savedNames(items)` (at most `MAX_SAVED_NAMES` 20 names, each at most 60 characters; `PageContext.saved?: string[]`, `IntentRequestSchema` takes the same limits), and the server prints them on one line of the user turn, `saved: "minu e-post" | "töö telefon"` (or `saved: none`). A value is never in a request, never in a log line (the server logs nothing of the page in any case), and never in the strip's state except as the read-back line after it was typed, which is what is in the field anyway.

### 26.2 Inserting by the rules: no model, instant

`savedMatch(utterance, items, single)` in `src/core/saved.ts`, pure. The utterance is normalised (`normalise`: lower case, no punctuation, so "e-post" is "epost"); up to two leading verbs are taken off (kirjuta, sisesta, pane, trüki, lisa, täida, kleebi / type, enter, put, insert, write, fill, add, paste), then every determiner (minu, mu, mina, oma / my) and place word (siia, sinna, see, sellesse, välja, väljale, kasti, palun, id / here, there, it, in, into, this, field, please) anywhere. What is left (one to four words) is compared with each item's name and aliases treated the same way, after each word is folded into its family:

| Family | Words |
|---|---|
| email | meil, meili, mail, maili, email, emaili, epost, eposti, emailiaadress, meiliaadress, epostiaadress |
| tel | number, numbri, numbrit, telefon, telefoni, telefoninumber, telefoninr, tel, phone, mobiil, mobiili, mobla |
| code | isikukood, isikukoodi, kood, koodi, idkood, idkoodi, code |

So "pane mu email sinna", "minu meil", "kirjuta mu e-post" and "my email" all leave `[email]`, which is the name "minu e-post" folded. A word that is not a family word must equal the item's word, or sound like it (`soundsLike` of `phonetic.ts`, three letters or more): "töö meil" finds "töö e-post". The result:

- an item whose folded name or alias equals what is left: that item (two or more such items: the question below);
- else, when what is left is one family word: the items of that family (an item's family is the family word in its name, else its kind's: email, tel, code; a `number` or `text` item without one has no family). One is that item ("pane mu email sinna" with one e-mail saved); two or more are the question;
- else nothing, and the utterance goes on through the other rules unchanged.

The utterance must carry a verb or a determiner, or the field must be a single field (`box.single`), so that one word of a chat message ("telefon") is never taken for the saved number. It is tried in `classifyExact` after sleep, wake, the labels, send, undo and back, and before the fixed edits, the spelled dictation of 25.1 and "sisesta X" (which would otherwise type "minu telefon" at the caret). It needs an armed box (present and armed, M7): with no armed box the rules do not resolve it: the utterance is dictation (never corrected into a command by the one-letter rule, so "minu meil" is not "mine meil", Gmail) and the engine asks the model, which may pick the field first (26.3); without a model the line is the refusal of 22.

**What it does.** Action `insertSaved { item }`, through `act`: in a single field one `setText` with the value as it is (the page replaces a one-line field whole, 25.1); in a composer the value is appended after one space (no capital, no full stop). The old text goes onto undo, so "võta tagasi" takes it out. The value is never converted by `typedFromSpoken`: it was saved as it should be typed. Not asked (`ask` unset), instant (`inpageInstant` true), never previewed. The line is `inpage.insertedSaved(readBack, name)`: "Kirjutasin: ralf.tamm@gmail.com (minu e-post). Ütle „valmis“ või „edasi“." `inpageResult` keeps that line (with the field as the page read it back) when the `setText` it ran wrote a saved value.

**Which one.** With two or more candidates and an armed box, nothing is typed: `session.choosing` holds their ids and the line asks, `inpage.whichSaved(names)`: "Kumb: minu e-post või töö e-post?" (three or more: "Milline: a, b või c?"). The next utterance answers when it names one of them: its folded words equal one candidate's, or are all words of exactly one candidate ("töö"), or it is an ordinal (esimene, teine, kolmas, neljas / first, second, third, fourth) in the order asked. Any other utterance clears `choosing` and is handled as if there had been no question.

**The hint.** When a step leaves an armed single field whose `fieldKind` is email, tel or code and an item of that kind is saved, `inpageResult` adds `inpage.savedHint(names)` to its line: "Kast on valitud. Räägi. Või ütle „minu e-post“." (`savedHint(items, box, lang)`, at most two names).

### 26.3 Inserting by the model: free phrasing

`PageIntent` gains `{ kind: 'insertSaved', name }`. `pageIntentFrom` accepts it only when `name` equals (ignoring case and surrounding space) one of `request.page.saved`; anything else is null and the answer is `unclear`. `applyIntent` finds the item by that name on `session.saved` and runs the same `insertSaved` action; a name no longer saved gives `inpage.savedMissing` and no command. The answer tool has the kind (`name`: one of the saved names, exactly as listed). The prompt's paragraph "Saved values": the user turn's `saved:` line lists what he has saved; "pane mu email sinna", "täida see mu numbriga", "sisesta see gmaili aadress", "kirjuta mu isikukood siia" are `insertSaved` with the matching name when the box is armed; when no box is armed and a field whose label matches is among the items, focus that field first with done:false, then `insertSaved`; never dictate a saved value's name as words, and never answer `insertSaved` with a name that is not listed. The engine reports the step as "insertSaved".

### 26.4 Opening the settings by voice

`BrowserCommand` gains `{ kind: 'openSettings', section?: 'andmed', add?: 'email' | 'tel' | 'code' | 'number' | 'text' }`. The service worker opens the options page (or brings its tab to the front) at `options.html#andmed`, or `#andmed:<kind>` when `add` is given, which starts the entry flow with that kind. Rules (`src/core/browserIntent.ts`, fixed phrases, instant):

| Phrase | Command |
|---|---|
| ava seaded, seaded, ava sätted / open settings, settings | `openSettings` |
| ava minu andmed, minu andmed, mu andmed, ava mu andmed / my details, open my details | `openSettings { section: 'andmed' }` |
| lisa uus e-post, salvesta mu e-post, salvesta minu e-post, salvesta e-post (and meil, email for e-post) / add an email, add a new email, save my email | `openSettings { section: 'andmed', add: 'email' }` |
| lisa uus telefon, lisa uus number, salvesta mu telefon, salvesta minu telefon, salvesta mu number / add a phone number, save my phone, save my phone number | `openSettings { section: 'andmed', add: 'tel' }` |
| lisa uus isikukood, salvesta mu isikukood, salvesta minu isikukood / save my id code | `openSettings { section: 'andmed', add: 'code' }` |

"lisa e-post" without "uus" is left out on purpose: in an armed e-mail field it is the saved e-mail (26.2). "seaded" and "settings" are soft words (22): with words in the armed box they are dictation. The lines: "Avan seaded." / "Avan minu andmed." It keeps the labels and the undo texts as `bar` does (it changes nothing on the page in front).

### 26.5 The entry flow: saving by voice

A pure state machine, `src/core/savedEntry.ts`: `startEntry(kind, existing, lang)` and `entryStep(state, utterance, existing, lang)` answer `{ state, line, save? }` (`state` null when the flow is over). `EntryState { step: 'kind' | 'name' | 'value', kind, name, value, suffix }`.

- **kind** (only when started without one): "e-post", "meil" is email; "telefon", "number" is tel; "isikukood", "kood" is code; "muu", "tekst" is text.
- **name**: skipped when nothing of that kind is saved yet; the name is then the default, `minu e-post`, `minu telefon`, `minu isikukood`, `minu number`, `minu tekst` (never "minu andmed", which opens the page). Otherwise the utterance is the name as he said it (cut to 60), and a name already in use is refused with a line.
- **value**: every utterance is converted by `typedFromSpoken(…, kind)` and appended (text: with a space), so "r", "a", "l", "f", "punkt", "emm" make "ralf.m". The words of the flow, whole utterance: "kustuta" / "delete" removes the last character (or, with no value, the suffix); "kustuta kõik" / "delete everything" clears the value and the suffix; "loe ette" / "read it back" reads it letter by letter ("r a l f punkt t a m m", digits as digits, @ as ät, then the suffix); for an e-mail, "gmail", "hotmail", "outlook", "icloud", "yahoo", "mail punkt ee" / "mail.ee" set the suffix (`@gmail.com`, `@hotmail.com`, `@outlook.com`, `@icloud.com`, `@yahoo.com`, `@mail.ee`), "oma lõpp" / "own ending" clears it; "valmis" / "salvesta" / "done" / "save" saves value plus suffix (an e-mail must then hold one @ and a dot after it, a phone number a digit, else a line says what is missing and the flow stays); "katkesta" / "cancel", at any step, abandons and nothing is saved.

The step line for the value: "Ütle tähthaaval; „punkt“ on ., „ät“ on @; „valmis“ salvestab." plus, for an e-mail, "Lõpu jaoks ütle „gmail“, „hotmail“ või „mail punkt ee“."

**Routing.** The options page holds the flow. While it runs, the page sends `utle-entry { on: true }` (again whenever it becomes visible) and `{ on: false }` when the flow ends or the page is hidden or closed; the worker forwards it to the engine (`{ target: 'offscreen', type: 'entry', on }`, `engine.setEntry(on)`). In entry mode the engine sends every final utterance, "katkesta" included, to the page in front as `BrowserCommand { kind: 'savedEntry', utterance }` instead of the rules and the model; partials are shown on the strip but never typed; every utterance is instant (a spelled letter must not wait for the hold). The worker runs `savedEntry` only on its own options page (else `not_found`); the page answers it with `entryStep`, renders, saves to `savedValues` on `save`, and posts the line to the strip (`utle-state`). A failed `savedEntry` (the page is not in front) ends entry mode and the line says `inpage.entryGone` ("Minu andmete leht pole ees. Ütle „minu andmed“.").

### 26.6 The settings page: "Minu andmed"

A section `#andmed` on `options.html`, above the other groups. For each item: its name, its value (shown in full: it is his own data on his own machine), the line "Ütle: minu e-post, mu meil" (`savedPhrases`: the name, then one shorter form with "mu" and the family's everyday word), and two dwellable buttons, Muuda (fills the keyboard form; saving replaces the item) and Unusta (removes it). Under the list, dwellable buttons start the voice flow: "Lisa e-post", "Lisa telefon", "Lisa isikukood", "Lisa muu". While the flow runs, a panel shows the step line, the value as one chip per character, and the suffix as a dashed chip. Below, the keyboard form for Tom: name, kind (a select), value, and a dwellable Salvesta. The page's help line says what to say: "Ütle „lisa uus e-post“ või vaata nupule. Pärast ütle vormi väljal „minu e-post“."

### 26.7 Guidance

The hint of 26.2 on the bar; the "Ütle:" lines on the settings page; `extension/README.md` "Minu andmed" (what to say, where it is stored, what the model sees); `HANDOFF.md` 1e. Strings: `inpage.insertedSaved`, `whichSaved`, `savedMissing`, `savedHint`, `entryGone`; a `saved` group for the page and the flow (Estonian and English). Constants: `MAX_SAVED` 50, `MAX_SAVED_NAMES` 20, `SAVED_NAME_CHARS` 60, `SAVED_VALUE_CHARS` 200. Tests: `src/core/saved.test.ts` (matching, families, the question, the hint, `savedFrom`), `src/core/savedEntry.test.ts` (the walk to ralf.tamm@gmail.com, katkesta at every step), `src/core/inpage.test.ts` (insert, which, choosing, the phrases of 26.4), `src/core/pageIntent.test.ts` (`insertSaved` validated), `extension/src/engine.test.ts` (names only in the request, the model's `insertSaved` resolved locally, entry mode), `extension/test/run.ts` (`openSettings` both ways, `savedEntry`, the screenshots `extension/test/out/andmed.png` and `andmed-saved.png`), `scripts/intent-eval.ts` (four saved-value cases on the form page). Not verified without a person: a real voice spelling letter by letter (how the recogniser writes "r", "emm", "ät"), real forms, and Tom using the keyboard form.
## 27. A hosted server (HOST lane, round 6, 2026-10-06)

The real user's work laptop allows nothing to be installed: no Node, no `npm run dev`, no developer mode in Chrome. Until now the speech model (TalTech's zipformer, 149 MB, through the `sherpa-onnx-node` native addon) and the Claude calls ran in the local Vite dev server. This section moves that server onto a hosted machine (Railway, from a Docker image) behind a token, lets the extension be told its address and the token on the settings page, and packs the extension into a Chrome Web Store zip, so the laptop needs nothing but the extension from the store (unlisted). **The audio then leaves the machine**: the microphone's samples go over the network to the hosted server, and the page summary and the utterances go from there to Anthropic, as they already did from the dev server. `docs/PRIVACY.md` says so in plain words.

### 27.1 One API, two hosts

`server/app.ts` exports `attachUtleApi(httpServer, use, options)`: it mounts the http routes through `use(path, handler)` (connect's signature, which both Vite's `server.middlewares.use` and the production server provide) and calls `attachAsr(httpServer, root)` for the websocket. The routes are the ones the Vite plugin served: `GET /api/status`, `POST /api/intent`, `POST /api/interpret`, `WS /api/asr` (the owner's voice, round 4, rides on the websocket; there is no separate http route for it). `server/vitePlugin.ts` keeps its name and behaviour and calls `attachUtleApi` from `configureServer`; `npm run dev` is unchanged apart from `"auth"` in the status.

`npm run serve` is `tsx server/serve.ts`: a plain `node:http` server on `process.env.PORT` (default 8787), no Vite. It answers `GET /` with one line of text (`Ütle server`) and `GET /healthz` with 200 `ok`; everything under `/api/` goes to the same handlers as in development; anything else is 404. The model loads on the decode worker when the server starts listening (20.1), as before.

### 27.2 The token

`UTLE_TOKEN` in the server's environment. Unset: the API is open, as on the dev server, and `/api/status` says `"auth":"off"`. Set: every `/api/*` request must carry `Authorization: Bearer <token>`, else 401 `{"error":{"code":"unauthorized"}}`; the websocket upgrade at `/api/asr` must carry `?token=<token>` in its address (a browser cannot set headers on a WebSocket), else the upgrade is answered `HTTP/1.1 401` and the socket destroyed; `/api/status` says `"auth":"on"`. The comparison is constant-time (`timingSafeEqual` on SHA-256 digests, so the lengths never leak). `/` and `/healthz` never need it (Railway's health check has no token). CORS preflights (`OPTIONS`) are answered without the token and allow the `Authorization` header. The token is never logged. The check is `server/auth.ts`: `tokenFromRequest(req)`, `authorized(req, token)`, pure over the request's headers and URL.

### 27.3 The extension

Two settings in `chrome.storage.local`: `asrUrl` (the websocket address, already read by the service worker; now a real setting) and `serverToken`. `extension/src/connection.ts` holds what both the offscreen page and the settings page use: `connectionFrom(stored)` (the two settings with defaults: empty address means `ws://localhost:5173/api/asr`, empty token means none), `serverUrl(asrAddress, path)` (ws → http, wss → https, the path replaced, the query dropped so the token never reaches an http address), `socketAddress(address, token)` (`?token=` added), `authHeaders(token)`, and `serverStatus(statusUrl, token)` (`live`, `no_key`, `bad_token` for a 401, `unreachable`). The service worker passes the token to the offscreen document in its address (`&token=`; an offscreen document can only use `chrome.runtime`, so it cannot read the storage itself); a changed address or token makes a new offscreen document on the next start, like a changed engine. The offscreen page sends the token on the websocket and as `Authorization` on every fetch.

The settings page has a section **Server** at the end of the groups: the address field (placeholder `ws://localhost:5173/api/asr`, help line "Jäta tühjaks, kui server jookseb samas arvutis"), the token field (a password field), and the button **Proovi ühendust**, which saves both and calls `/api/status` through `serverStatus` and shows the result in the section: "Ühendus töötab: …" with what the server has (TalTech's model, Soniox, understanding on or off), "Ei saa ühendust", or "Vale võti" for a 401. The address field moved out of "Täpsemalt" into this section; the page address (`utleUrl`) stays there. The fields take a dwell (focus) and the keyboard: the carer, who has hands, fills them in. The strip: when `/api/status` answers 401 the engine shows "Serveri võti on vale" in the standing model line and treats understanding as off; the recogniser's socket fails its upgrade and the strip shows that line too instead of "the model is unreachable".

### 27.4 The image and Railway

`Dockerfile`: `node:22.20-bookworm-slim` (22.18 or later strips TypeScript types in the decode worker, 20.1), `npm ci` (the native addon's prebuilt linux-x64 package comes with it), `npm run model` at build time so the image holds the recogniser and the speaker model, `EXPOSE 8787`, `CMD ["npm","run","serve"]`. `.dockerignore` keeps out `node_modules`, `models`, `extension/dist`, `extension/out`, test output and `.git`. `railway.json` builds the Dockerfile and checks `/healthz`.

The service's environment: `ANTHROPIC_API_KEY` (understanding), `UTLE_TOKEN` (a long random string, the same one goes on the settings page), optionally `SONIOX_API_KEY` (the second recogniser), `UTLE_MODEL` (the Claude model), and `PORT` (Railway sets it). Memory: measured in 27.7. The voice profiles live under `UTLE_DATA_DIR` (27.6), where Railway's volume mounts (`/data`), so a redeploy keeps them; without the variable they are on the container's disk and lost on every redeploy. The deploy itself is `docs/DEPLOY.md`.

### 27.5 The store zip

`npm run ext:pack` (`scripts/pack.ts`) builds the extension and writes `extension/out/utle-<version>.zip` with `manifest.json`, the html pages, `dist/`, `relay.js` and `icons/`, nothing else (the zip is written by the script with `zlib`, no external tool). The icons (16, 48, 128 px: a green rounded square with a white dot, like the microphone square) are drawn by `scripts/icons.ts` with a small PNG encoder over `zlib`, and the manifest names them under `icons` and `action.default_icon`. The version is 0.3.0. What the store listing needs that the repository cannot hold: a privacy policy URL (`docs/PRIVACY.md` is its text), screenshots, the single-purpose statement and the justification of the host permission (`extension/README.md` drafts them).

Tests: `server/auth.test.ts` (the header, the query on the upgrade, wrong and missing tokens, open when unset, the status flag), `extension/src/offscreenMain.test.ts` (`serverUrl` for ws and wss, the token on the socket and as a header, `connectionFrom`, `serverStatus` for 401), `extension/src/engine.test.ts` (a 401 status shows the token line), `extension/test/run.ts` (the settings page against a running `npm run serve`). Not verified here: the Docker build (Docker is not installed on the machine that wrote this), a Railway deploy, a store upload, and a real voice over the network.

### 27.6 Profiles per token (HOST lane, round 7)

One hosted server serves several people, each with their own voice profile. `UTLE_TOKEN` is a comma-separated list; each entry is `name:token` or a bare token (split at the first colon, both trimmed, empty entries and repeated tokens skipped). Each token is a user (`server/auth.ts` `tokenUsers`): its `name` (a bare token is named by the first six hex digits of its id), and its `id`, the first 16 hex digits of the token's SHA-256 (`profileId`), which names the profile file and never reveals the token. `httpUser(req, users)` and `upgradeUser(req, users)` return the caller (the header on http, `?token=` or the header on the socket; every token is compared in constant time, so the time does not say which one matched), null for a wrong or missing token, and `LOCAL_USER` (name `omanik`, id `''`) when no token is set. `httpAuthorized` and `upgradeAuthorized` keep their meaning over the list.

The profile file (`server/speaker.ts` `profilePath(root, env, id)`): the base is `UTLE_DATA_DIR` or `models/speaker`; the local user keeps `owner.json` there, so the dev server is unchanged; a token's user has `profiles/<id>.json`. `speakerGates(extractor)` makes one gate per profile file on first use and keeps it, over the one embedding model, so each user is judged against their own profile and enrolment writes only the caller's file. The decode worker gets the path with each stream (`{ type: 'open', id, profile }`); `DecoderHost.open(profile?)` and `attachAsr`'s `profileFor(req)` carry it from the upgrade; nothing in the session or the judging changed.

`GET /api/status` with a token answers `profile: { name, enrolled, seconds? }` for the caller (`profileSummary`: whether the file holds a valid profile, and the seconds of speech it was made from; never the embedding). The settings page's **Proovi ühendust** appends "Profiil: <name>, hääl õpetatud" or "õpetamata" to "Ühendus töötab: …" (`serverCheck` reads `profile`; a server without it shows the old line).

Tests: `server/auth.test.ts` (the list, names, ids, the caller of each token, the local user), `server/speaker.test.ts` ("profiles per token": two tokens enrol two profiles and each is judged against its own; the paths; the summary), `server/app.test.ts` (the status names each token's profile and whether it is learnt; each socket opens on its own token's profile file), `extension/src/offscreenMain.test.ts` (the profile in the status, the line), `extension/test/run.ts` (the settings page shows "Profiil: ralf, hääl õpetamata."). Run by hand against `npm run serve` with two tokens and the real models: `--enrol 2` over one token wrote `profiles/76592b9de6d38238.json` (the SHA-256 prefix of that token), its status then said `enrolled: true`, its finals carried a verdict, and the other token's status said `enrolled: false` and its finals carried none.

### 27.7 The image, built and run (HOST lane, round 7, 2026-10-21)

Built with Docker 29.9.1 (Docker Desktop on Windows, linux/amd64): `docker build -t utle-server .` exits 0 in about two minutes from a cold cache, with `npm ci` (88 packages, `sherpa-onnx-linux-x64` from the lock) and `npm run model` inside the build (encoder 155 MB, decoder, joiner, tokens, the speaker model 29 MB). The Dockerfile needed no change: the addon's Linux libraries load with the `LD_LIBRARY_PATH=/app/node_modules/sherpa-onnx-linux-x64` it already set. The image is **1.19 GB on disk** (1 185 338 768 bytes), **393 MB compressed**.

`docker run -p 8787:8787 -e UTLE_TOKEN=test-token -e ANTHROPIC_API_KEY=dummy utle-server` logs `[asr] model loaded on a worker thread in 4281 ms` and `[asr] speaker model loaded`; `/healthz` 200 without a token, `/api/status` 401 without and 200 with it.

Recorded speech, `scripts/asr-client.ts` (streams 100 ms float32 frames in real time as `src/speech/local.ts` does, then 1.5 s of silence and a flush) with `scripts/fixtures/et-dictate-send-16k.wav`: the same finals, `"Tere Mari ma jõuan homme kell kolm."` and `"Saada."`, from all three hosts. Last speech frame sent to last final (includes the recogniser's 1000 ms endpoint silence): container **1691 ms**, dev server on the Windows host 1727 ms, `npm run serve` on the host 1745 ms. On the same machine the container path costs nothing; what the internet adds to a hosted server is not measured.

Memory, from the container's cgroup: `memory.peak` **398 MB** after the model load and one decode, **407 MB** after two sockets decoding at once with one enrolment; `docker stats` 355 to 377 MiB at rest. The service needs about 0.5 GB, not the 1 GB guessed in 27.4. Railway's Hobby plan allows 48 GB per service (https://docs.railway.com/reference/pricing/plans), and memory costs $10 per GB per month there, so about $4 to $5 a month if it runs all the time.

Profiles on a volume: with `-v utle-test-data:/data -e UTLE_DATA_DIR=/data -e UTLE_TOKEN=ralf:…,mari:…`, `--enrol 2` over ralf's token wrote `/data/profiles/4c5dc9b7708905f7.json`; a new container on the same volume answered ralf `enrolled: true, seconds: 2` and mari `enrolled: false`.

**Rebuilt with round 7's speech models (SPEECH lane, 2026-10-21).** `npm run model` inside the build now fetches three models (the Dockerfile names them): the recogniser (156 221 502 bytes; `encoder.int8.onnx` 154 895 904), TitaNet small (`nemo_en_titanet_small.onnx`, 40 257 283, replacing CAM++'s 29 MB) and Silero VAD v5 (`silero_vad_v5.onnx`, 2 313 101); `models/` in the image is 198 826 411 bytes. `docker build` exits 0. The image is **1.22 GB** (1 215 520 640 bytes, up from 1 185 338 768). The container logs `[asr] model loaded on a worker thread in 3972 ms`, `[asr] speaker model loaded; 1 profile, 0 enrolled` and `[asr] vad model loaded`. `scripts/asr-client.ts` with `et-dictate-send-16k.wav` gives `final text: "Tere, Mari. Ma jõuan homme kell kolm. Saada"` from the container and the same from the dev server (2 runs): the same words as before the detector, with other punctuation (the detector's pre-roll and hiss change what the recogniser hears around the words). Last speech frame to last final: 2225 to 2268 ms (was 1691 ms); that last final is the "Saada" after a sentence, which the detector delays, while it brings other finals earlier (table below). Memory: cgroup `memory.peak` **579 MB** after the model load and three decodes (was 398 to 407 MB), so the service needs about 0.6 GB.

When each final comes, with and without the detector: `npx tsx scripts/asr-file.ts <wav>` and the same with `--no-vad`, the final's time in seconds of audio (the file plus 2 s of silence; same machine, same model and hotwords).

| Fixture | Utterance | With the detector | Without | Difference |
|---|---|---|---|---|
| `et-dictate-send` | the sentence | 6.1 | 5.9 | +0.2 |
| `et-dictate-send` | "Saada" | 10.8 | 10.3 | +0.5 |
| `et-jah` | "Jah" | 2.9 | 3.3 | -0.4 |
| `et-numbers-one` | "näita numbreid" | 8.0 | 8.4 | -0.4 |
| `et-numbers-one` | "Üks" | 12.7 | 12.9 | -0.2 |
| `et-scroll-tab` | "keri alla" | 4.8 | 4.6 | +0.2 |
| `et-scroll-tab` | "järgmine vaheleht" | 10.2 | 9.7 | +0.5 |
| `et-sentence` | the sentence | 7.1 | 7.1 | 0 |

So it is not a fixed delay: some finals come up to 0.5 s later with the detector, others up to 0.4 s earlier. The cause is not found. (With the detector the decoder also ends `et-sentence` with a lone "." at 9.0 s; the session sends no final for it. Without the detector `et-dictate-send` gives "Tere Mari ma jõuan homme kell kolm." and "Saada.", the punctuation of the HOST lane's run.)

Not measured: a Railway deploy, a real voice over the internet, the latency over a real network.

## 28. Round 7, ROBUST lane (2026-10-21)

The faults the round 3 review left open (`docs/REVIEW-R3.md` M3, M4, M6; their spec sentences are
in 23.2, 21.1 and 23.6), the test that failed under load, and hotword biasing.

### 28.1 Hotwords: the recogniser leans toward the command words

sherpa-onnx's contextual biasing (https://k2-fsa.github.io/sherpa/onnx/hotwords/index.html; it needs
`modified_beam_search`, which 20.1 already uses) boosts each token of a listed phrase while the beam
search follows it. TalTech's model ships `tokens.txt` and no `bpe.model`, and with the default
`modelingUnit` (`cjkchar`) sherpa splits a line on its own rules and cannot find the model's word
pieces ("▁keri" is looked up as "▁" and "keri", both missing). So the recogniser is given
`modelingUnit: 'bpe'` and a vocabulary built from `tokens.txt` (`bpeVocabFromTokens` in
`src/core/hotwords.ts`: "piece<TAB>-ln(id)", the pieces in the tokeniser's own rank order, the
blank, `<...>` and `#n` left out), and the phrases as plain lowercase words, one per line, as the
docs require for that mode.

**The list** (`hotwordPhrases`): every fixed command phrase of the core (`COMMAND_PHRASES` in
`src/core/inpage.ts`: `BROWSER_PHRASES` and the rest of the rules' phrase list), the one-word
commands that are no phrase of their own (`COMMAND_WORDS`: saada, otsi, katkesta, ava, mine, …),
and the site names as written (the `SITES` keys found in their own address: youtube, whatsapp,
delfi; never the sound-alike spellings "juutuba", "vatsap"). A phrase made only of words the English
phrases use is left out (`isEnglishPhrase`). About 265 lines.

**The files.** `scripts/hotwords.ts` writes `models/hotwords.txt` and `models/hotwords.vocab`
(`writeHotwords` in `server/hotwords.ts`); `npm run model` runs it every time, and `loadModel`
(`hotwordsConfig`) writes them when either is missing. When they cannot be written the recogniser
loads without hotwords. `HOTWORDS_SCORE` 0 passes nothing.

**The score** (`HOTWORDS_SCORE` = 1.0), measured with `npx tsx scripts/asr-hotwords-eval.ts 1 1.5 2 3`
on the five fixtures in `scripts/fixtures/` (TartuNLP speech, 29 words): off 1 word error
("näita numbreid ja" for "näita numbreid"); 1.0, 1.5 and 2.0 none; 3.0 four (command words that were
not said: "keri alla numbrid", "saada numbri"). From 1.5 the dictated sentence changes too ("Tere! Ava
uus vaheleht" became "Tere, ava uus vaheleht"); at 1.0 every dictated word, capital and mark is as
without hotwords. The only other change at 1.0 is a capital: "Järgmine vaheleht" is "järgmine
vaheleht". Not measured: a real voice, a noisy room, and how often a dictated sentence is pulled
toward a command phrase at 1.0 over hours of use.

### 28.2 The test that failed under load

"chains of goals (round 4) > stops at MAX_CHAIN_STEPS page steps in all" ran on real timers: the
engine waits `SETTLE_MS` (300 ms) between steps, and 16 steps made 15 real waits, about 4.8 s of wall
time against vitest's 5 s limit. It now runs on fake timers and takes milliseconds.


## 29. Round 8 (2026-10-22 night)

Ralf's list of 2026-10-22, triaged in `docs/plans/2026-10-22-round-8-plan.md`. One subsection per
lane; a lane writes only its own. Sections 29.5 and 29.6 are scoping lanes and end in a measurement.

### 29.1 Seek by amount (MEDIA lane)

`media` with action `forward` or `back` carries an optional `seconds`: an integer from 1 to 3600.
Absent means 10 s, exactly as before. `CommandSchema` (`src/core/pageIntent.ts`) rejects 0, a
negative, a fraction, anything above 3600, and `seconds` on any other media action; the model's
tool schema (`server/intentPrompt.ts`, `kind('media', …)`) has the same field as integer-or-null
with `minimum` 1 and `maximum` 3600 (the tool is not strict, so the bounds are sent), and one
rules line: "keri edasi üks minut" forward 60, "poolteist minutit" 90, "keri kaks minutit tagasi"
back 120, bare "keri edasi" no seconds.

**Grammar** (`seekCommand` in `src/core/browserIntent.ts`, whole utterances after
`cleanForBrowser`, so case and punctuation do not matter; tried after the fixed table, so "keri
edasi" and "keri tagasi" alone are still the 10 s rows):

- Estonian: `keri <edasi|tagasi> <amount>` or `keri <amount> <edasi|tagasi>`.
- English: `[skip|go|jump] <forward|ahead|back|backward|backwards> <amount>`,
  `<skip|go|jump> <amount> <forward|ahead|back|backward|backwards>`, `rewind <amount>` (back).
- `<amount>` is `[count] <unit> [and a half]`. Units: `sekund`, `sekundi`, `sekundit`, `sek`,
  `second(s)`, `sec(s)` (1 s); `minut`, `minuti`, `minutit`, `min`, `minute(s)`, `mins` (60 s).
- `count`: absent, `a`, `an` (1; "keri edasi minut" is 60); `pool`, `half`, `half a` (0.5);
  `poolteist` (1.5); `<n> ja pool`, `<n> and a half` (n + 0.5); else `<n>`. `n` is digits (up to
  four) or a number word through `spokenNumber` (`quickReply.ts`: "üks" to "kolmkümmend üheksa",
  "one" to "thirty nine").
- The product, rounded to whole seconds, must be 1 to 3600; otherwise the utterance is not a seek
  and goes on (to the model). A scroll phrase ("keri alla kolm korda") has no `edasi`/`tagasi`
  and is never a seek.

**Page side** (`media()` in `extension/src/page.ts`). Without `seconds`: unchanged (YouTube's own
`l`/`j` shortcut, else `currentTime` ± 10). With `seconds` on a plain `<video>`/`<audio>`:
`currentTime` moves by that amount, clamped to [0, duration]. On YouTube (`#movie_player`), whose
shortcuts move a fixed 5 or 10 s, the explicit amount sets `currentTime` on the element directly;
when `currentTime` has not moved within `SHORTCUT_MS` (a player that ignores or resets the write),
it falls back to pressing `l` or `j` (10 s each) `round(seconds / 10)` times, at least once.
The line the bar shows and speaks names the amount (`browserDoing` in `src/core/strings.ts`:
"Edasi üks minut.", "Tagasi 90 sekundit.", "Back 30 seconds."); without seconds it is unchanged.

### 29.2 Document mode (DOCS lane)

Ralf's items 5 ("dokumente kirjutada ja muuta, vali see lõik ja pane kaldkirja") and 15 (thinking
pauses while writing a document). Three parts: formatting by voice in any editor, a document mode
that changes how dictation is joined and judged, and reading the last sentence back.

**Formatting is a command of its own.** `{ kind: 'format', style }` with `style` one of `bold`,
`italic`, `underline`, `heading`, `normal`, `list`, `paragraph` (`FormatStyle` in
`src/browser/protocol.ts`). Not new `PressableKey` values: the right keys depend on the editor
(Google Docs, a rich editor, a plain contenteditable, a textarea), and only the page knows which one
is in front; the core says what he wants and the page picks the chord and the fallback. Rules only:
the model's schema does not carry it (the server is another lane's), so "tee see lause paksuks"
goes to the model as any other utterance and comes back unclear or as dictation. Phrases (whole
utterance, `src/core/browserIntent.ts`, the "document mode (29.2)" block):

| Style | Estonian | English |
|---|---|---|
| bold | paksuks, tee paksuks, rasvaseks, tee rasvaseks | bold, make it bold |
| italic | kaldkirja, tee kaldkirja, kaldkirjas, kaldkirjaga | italic, italics, make it italic |
| underline | allajoonitud, jooni alla, tee allajoonituks | underline |
| heading | pealkirjaks, tee pealkirjaks | heading, make it a heading |
| normal | tavaline tekst, tavaliseks, tee tavaliseks | normal text |
| list | loendiks, tee loendiks, täpploendiks | bulleted list, make it a list |
| paragraph | uus lõik | new paragraph |

The key table per editor (`extension/src/page.ts`, `format`). A chord is a keydown/keyup pair with
the modifiers set, sent to the editor's keyboard target. "Fallback" runs when the chord's keydown
was not cancelled and the field's HTML did not change, which is what a plain contenteditable does
with a key event a script dispatched.

| Style | Google Docs (on `docsEditor()`) | Rich editor (contenteditable): chord, then fallback | Textarea |
|---|---|---|---|
| bold | Ctrl+B | Ctrl+B, then `execCommand('bold')` | refused: plain text has no bold |
| italic | Ctrl+I | Ctrl+I, then `execCommand('italic')` | refused |
| underline | Ctrl+U | Ctrl+U, then `execCommand('underline')` | refused |
| heading | Ctrl+Alt+1 | Ctrl+Alt+1, then `formatBlock h1` | refused |
| normal | Ctrl+Alt+0 | Ctrl+Alt+0, then out of a list (`insertUnorderedList`) or `formatBlock div` | refused |
| list | Ctrl+Shift+8 | Ctrl+Shift+8, then `insertUnorderedList` | refused |
| paragraph | Enter, Enter | at the end: `beforeinput insertParagraph`, else `execCommand('insertParagraph')` | `\n\n` at the end |

The Docs chords are Google's documented shortcuts (Windows); Ctrl+Alt+1, Ctrl+Alt+0 and
Ctrl+Shift+8 are also TipTap's, so one chord table serves the rich editors built on it. Bold,
italic and underline act on the selection; a selection that ends in spaces (as "vali see lause"
leaves it) is shrunk to its last letter or mark first, so exactly the sentence is styled.
**Unverified: real Google Docs.** The Docs path is tested on a stand-in only
(`extension/test/fixtures/docs.html`).

Outside document mode "uus lõik" is a new line (the box edit `newLine`, Shift+Enter in a composer,
never a send); in document mode it is the paragraph format and a dictation break.

**Selection.** "vali see lause" / "vali lause" (`sentence`), "vali kõik", "vali viimane lause" and
"vali sõna X" existed. Added: "vali lõik", "vali see lõik", "select the paragraph" (`paragraph`: the
line the caret is on, from one line break to the next) and "vali viimased kolm sõna", "select the
last three words" (`{ lastWords: n }`, n from `spokenNumber`, 1 to 50: the last n words with their
marks and the spaces before them). On Docs `paragraph` is Ctrl+ArrowUp then Ctrl+Shift+ArrowDown,
and `lastWords` is n times Ctrl+Shift+ArrowLeft (unverified: real Google Docs).

**The trigger.** `BoxState.document` is true when the box in front is a document
(`extension/src/box.ts`, `isDocument`):

- Google Docs (`docsBox`), always;
- otherwise never a site's composer (WhatsApp, Messenger, or any box with a send button beside it,
  which is what makes `kind: 'composer'`), never a one-line input, never a search field; and one of:
  a textarea or contenteditable whose text is over **500 characters** (`DOCUMENT_CHARS`); a
  contenteditable holding a heading or a list (`h1` to `h6`, `ul`, `ol`); a contenteditable
  `[role=textbox]` with `aria-multiline="true"` and block children (`div`, `p`, `h1` to `h6`, `li`).

The composer exclusion is deliberate: a chat box over 500 characters is still a chat box, and Gmail's
body (a multiline textbox) has its send button beside it. A document's text is reported with one
trailing line break when it ends in an empty paragraph (`documentText`), so a dictation after "uus
lõik" starts that paragraph with a capital and no space, and `setText` appends to it rather than
retyping the document.

**What document mode changes** (`src/core/inpage.ts` and `src/core/documentMode.ts`, the core;
`extension/src/engine.ts`, the window). Outside document mode nothing changes: the tests named
"document mode: outside it" run the same utterances against the same box without the flag and
assert the chat-box step.

1. **A silence does not close the sentence.** A dictated final is typed without a closing full stop;
   the next final continues the same sentence with a small first letter (the joining rules of 21.1:
   a capital only at a sentence start, or for a name or "I"). The window is
   **`DOCUMENT_PAUSE_MS` = 20 000 ms** from the previous final the engine handled: a final that
   arrives later first closes the open sentence with a full stop and starts a new one with a
   capital (`documentPaused` decides from the two times; the engine passes it as `session.paused`).
   The only spoken breaks are "punkt" (with the other marks, "küsimärk" and "hüüumärk") and
   "uus lõik".
2. **One-word ordinary words are dictation.** "välja", "sulge", "edasi", "tagasi", "enter", "paus",
   "veel" and the other soft words of section 22 are typed as words, also into an empty document.
   With the numbered labels showing they keep their meaning (he is navigating then).
3. **No verification that takes words back.** The round 5 type-first check never runs in a
   document: dictation goes straight in. The model is asked only about an utterance whose first
   word is a command verb: `COMMAND_WORDS` (28.1) plus "vali", "tee", "muuda", "loe", "kustuta"
   (`DOCUMENT_VERBS`). Such an utterance is asked before anything is typed (as a one-line field is
   in round 5): the model's dictation, or no answer, types it; its command runs.
4. **"saada" sends nothing.** "saada", "saada ära", "send it" type nothing, press nothing, and the
   strip says "Dokumendis ei saadeta." ("Nothing is sent from a document.").

**Reading back.** "loe viimane lause ette", "loe viimane lause", "read the last sentence" hand the
last sentence of the box (`lastSentenceOf`: after the last `.`, `!`, `?`, `…` or line break before
the final mark) to `speak`; "loe see ette", "loe ette", "read it back" hand the whole box. The step
carries the text as `speak`; the engine calls `EngineDeps.speak` (optional; the default is
`src/speech/synth.ts`'s `speak`) in the session's language (`et-EE`, `en-US`). It works in any box,
not only a document. Listening is not paused here: the microphone may hear the synthesised voice
until the READ lane's listening pause (29.5) lands. Unverified: Chrome's speech synthesis inside
the offscreen document.

**REVIEW-R3 M5 (Docs gluing after the 4 s reset).** Document mode does not supersede it: the 20 s
window needs the box to know whether the sentence is open, and on Docs the box is what Ütle typed
within `DOCS_TYPED_RESET_MS` (4 s). Fixed as the sketch says, in one rule: when the 4 s pass, the
memory keeps the last character typed instead of emptying (`docsTyped.slice(-1)`). The core joins
onto that character (a space after a letter or a mark, a capital after a mark, a small letter after
a letter), and `docsSetText` types only what follows it. `readPage` on Docs reports the same box as
`readBox` (the other half of M5). Browser test: the Docs stand-in (`fixtures/docs.html`, served as
`https://docs.google.com/document/d/stand-in/edit` by a route in the suite) records the keys Docs
would get; "Tere", "punkt", a 4.5 s wait, "uus lause on siin" must arrive as "Tere. Uus lause on
siin" (before the fix: "Tere.Uus lause on siin").

### 29.3 Mail by voice and addresses off the page (MAIL lane)

Ralf's items 10 and 12. Item 11, the real-voice read-backs, did not happen: section 2 step 3 of the
plan was not run, so there is no list of wrong read-backs, and the spelling tests of rounds 5 and 6
stand in for it (29.3.6). The rules live in `src/core/mail.ts`, the address finder in
`src/core/contacts.ts`, both pure; the page side is the `mail (29.3)` blocks of
`extension/src/page.ts`, `box.ts`, `sites.ts` and `background.ts`.

**29.3.1 Three commands.** `compose { to?, body? }`: on Gmail, a new message: the compose window in
front is used, else Compose ("Koosta") is clicked and the window waited for; `to` (a name, or an
address) is typed into To and confirmed (Enter when Gmail shows a suggestion row, else Tab); `body`
is typed into the message. The body is armed when To has something in it, else To is. Off Gmail,
`compose` opens Gmail's compose page (29.3.4) in a new tab first, then does the same there.
`composeTo { address, subject?, body? }`: opens the compose page in a new tab with the address in
To (and the subject and body when given), waits for the window and arms the body; only the model
answers it (29.3.3). `mailField { field: subject | cc, text? }` in the open compose window: subject
types the text into Subject (replacing it) and arms the body; cc opens the Cc row (its button
"Koopia" / "Cc") and arms the Cc field, typing the text when given. A page without a compose window
answers `not_found`. "saada" is the existing `pressSend`: inside a compose window it clicks the
window's Send ("Saada" / "Send") and never presses Enter (Enter is a new line in a mail body); sent
means the window closed or the body emptied.

**29.3.2 The rules** (`mailCommand`, tried in `inpage.ts` before the spelled values and the
conversation rules, so "kirjuta meil Marile" is never a chat with "Meil Mari" nor the address
"marile"; that hook, the compose-window hook for subject and Cc below, and one line keeping mail out of the
sound-alike corrections are the whole change to `inpage.ts`):

| Said | Command |
|---|---|
| `kirjuta meil Marile`, `kirjuta kiri Marile`, `saada meil Marile`, `koosta e-kiri Marile` | `compose { to: "Mari" }` (the allative ending taken off as for chats) |
| `kirjuta meil Marile, et tulen homme` | `compose { to: "Mari", body: "Tulen homme." }` |
| `uus meil`, `uus kiri`, `kirjuta meil`, `new email`, `compose an email` | `compose {}` |
| `write an email to Mari`, `send an email to Mari saying …` | `compose { to: "Mari" (, body) }` |
| `teema Koosolek`, `teemaks koosolek`, `subject: Meeting` (in a compose window only) | `mailField { subject, "Koosolek" }` (first letter capitalised) |
| `lisa koopia`, `lisa koopia Jaanile`, `add cc`, `add a cc to Jaan` (in a compose window only) | `mailField { cc (, "Jaani") }` |
| `saada`, `saada ära`, `send` | `pressSend` (unchanged) |
| `valmis`, `järgmine väli`, `next field` in To or Subject | `pressKey Tab` (round 5's form keys: both are one-line fields) |

A name must carry the allative ending (`…le`) in Estonian, so "kirjuta kirja lõppu" stays dictation.
"teema …" and "lisa koopia" are mail commands only while the box in front is a field of a compose
window (To, Cc, Subject or the body: the box reports `mail: true`, 29.3.5); `mailFieldCommand` is
tried in `inpageStep` right after the form keys, for that box only. Everywhere else, in a chat box, a
document or a form field, "Teema on huvitav, aga pikk" is dictation like any sentence. On Gmail with
no compose field armed the words go to the model, which may answer `mailField`. "kirjuta meil …" and
"uus meil" (`mailCommand`) work on any page.

**29.3.3 Addresses on the page.** `readPage` adds `contacts: { kind: email | tel; value; label }[]`
(absent when there are none): at most 20, the ones on screen first, each value once. Sources: the
text of the page (text nodes outside Ütle's strip, scripts and hidden elements) and the hrefs of
`a[href^="mailto:"]` and `a[href^="tel:"]` (label: the link's text, at most 40 characters; '' for
plain text). Values: an e-mail lower-cased; a phone compacted (spaces, dashes and brackets dropped).
The regexes (`src/core/contacts.ts`):

- e-mail: `(?<![\w.+%-])[a-z0-9](?:[\w.%+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?![\w-]|\.[a-z0-9])`, case-insensitive, no ".." in it.
- phone, international: `(?<![\w+])\+\d{1,3}(?:[ -]?\d){6,11}(?!\d)`; with +372 the rest is 7 or 8 digits.
- phone, Estonian without the prefix: `(?<![\w+.,/-])(?<!\d )[3-8]\d{2,3} ?\d{3,4}(?!\d|[ .,/-]\d)`, 7 or 8 digits in all; the international ones are blanked out first, so "+372 5123 4567" is not found again as "5123 4567".
- a `tel:` href is a phone only when its compacted value is one of those shapes; a `mailto:` href
  gives each address before the `?` that is an e-mail as a whole.

So a version (v2.10.3), an ID code (39001010000: eleven digits, never a 7-digit piece of it), a
price (19.99 €), a postal code or street number, and a date (10.03.2024) are not contacts.

The model gets them as one line of values only, `contacts: e-mail a@b.ee, tel +37251234567` (or
`none`), never the labels or the text around them. Its schema gains `compose`, `composeTo` and
`mailField`; `pageIntentFrom` takes `composeTo` only when `address` is an e-mail as a whole AND one
of the page's contacts' e-mail values (ignoring case), and `compose` with an `@` in `to` only on the
same terms: **the model can never invent a recipient.** The prompt's rules line says so, and says
that "võta see meiliaadress siit lehelt ja kirjuta talle, et …" is one goal: `composeTo` with the
address and the dictated words as the body (`plan` []). That utterance is ten words, so the ask is
careful (round 5's eight words); a tel contact is never an address ("helista talle" is a click on
the tel link, or unclear).

**29.3.4 The Gmail address.** `https://mail.google.com/mail/?view=cm&fs=1&to=<address>&su=<subject>`,
and `&body=<body>` only when he dictated the body in the same utterance; each value
`encodeURIComponent`. The base is the setting `mailHome` (chrome.storage.local, default
`https://mail.google.com/mail/`); a page is Gmail when its host is `mail.google.com` or its address
starts with `mailHome`. The browser suite sets `mailHome` to the stand-in `fixtures/gmail.html`,
which reads `to`, `su` and `body` from its query as Gmail does.

**29.3.5 The compose window as one field group.** In a compose window the box reports, for the
field under focus: To and Cc `single`, `fieldKind: email`; Subject `single`, `fieldKind: text`; the
body `kind: composer`; every one of them `mail: true`. So dictation into To is converted as an address ("ät", "punkt"), "valmis"
moves To, Cc, Subject, body in turn (Tab inside the window walks the fields of the group, past the
window's buttons), and "saada" from the body sends. The
selectors are in `sites.ts` `MAIL`, each marked; **all unverified on real Gmail**: Compose
`[gh="cm"]` or a button named Koosta / Compose; the window `[role="dialog"]` holding a subject
field; To `input[aria-label*="recipient" i]`, `input[name="to"]`, or a field labelled Saaja / To /
Kellele; Subject `input[name="subjectbox"]` or a field labelled Teema / Subject; body
`[aria-label="Message Body"]`, `[aria-label="Sõnumi sisu"]`, or the window's contenteditable
textbox; Send `[role="button"][aria-label^="Send"]`, `[role="button"][aria-label^="Saada"]`, or a
button named Saada / Send; Cc a button or link named Koopia / Cc / Add Cc. Only the stand-in proves
them.

**29.3.6 Spelled addresses.** Unchanged from rounds 5 and 6 (25.1, 26): "kirjuta meil ralf ät gmail
punkt com" is still the spelled address (a name must be one or two words in the allative), and a
sound-alike correction never reaches a mail command ("kirjuta meile" stays dictation). The three
read-backs the plan names are tests of `typedFromSpoken` in `src/core/spelling.test.ts`: an ID code
digit by digit, a phone number, an e-mail with "punkt" and "ät". A name is typed into To as the chat
rules take it off the allative ("Jaanile" is "Jaani", as for chats); Gmail's suggestions then match
on that prefix or not: unverified.

**29.3.7 Privacy.** The server logs for a mail ask what it logs for any ask (`[intent] kind=… done=…
plan=… care=… ms=…`): no address, no body, no page text (`server/intent.test.ts`). The contacts'
values are the model's input, sent once in the user turn, never logged.

### 29.4 Wake word and "Minu kohad" (WAKE lane)

Two things for a no-hands day: the bar listens all day and acts only on what starts with a word he
chose, and plain nouns ("uudised", "raadio", "ilm") open the places he set once.

**29.4.1 The listening mode "Äratussõnaga".** A third `listenMode`, `wake`, beside `toggle` and
`gaze` (settings page group "Kuulamine"; `settingsFrom` in `strip.ts` reads it). The service worker
puts `&wake=<word>` into the offscreen document's address while the mode is on (the offscreen
document cannot read storage, as with the token), so a changed word or mode makes a new document,
and it starts listening when the browser starts (`onStartup`) and when the mode or the word is
changed to it. The microphone button still turns listening off; nothing turns it back on by itself
until the next browser start or settings change.

The word is the setting `wakeWord` in `chrome.storage.local`, default "Ütle". `wakeWordFrom` takes
one or two words of letters (Estonian letters included), at most 20 letters each; anything else is
the default. The settings page edits it with a small text field and a save button under the mode's
choices (shown only in wake mode): a helper types it once, so the voice entry flow of 26.5 was not
worth its weight here.

**The gate** (`src/core/wake.ts`, pure, `wakeGate(state, final, now) → { state, utterance | null }`)
sits in the engine, in front of everything a final does; the recogniser and the server are unchanged.
The state is the word's phonetic keys and `openUntil` (0 when the window is closed). The state machine:

1. Closed. A final whose first word (first two, for a two-word setting) is the wake word is acted on
   with the word and the punctuation after it stripped ("Ütle, keri alla" → "keri alla"). Any other
   final is dropped: not typed, not previewed, never sent to the rules or the model. The strip's
   upper line still shows the words heard, so he sees it listens.
2. A woken final that the rules type into an armed box (their step has a `setText`) opens the
   dictation window: `openUntil = now + WAKE_WINDOW_MS` (20 000 ms). A woken command into an armed
   box ("Ütle, keri alla" in WhatsApp) does not: the room's talk after a command must not be typed.
   The bare word alone ("Ütle.") opens it too, whatever the box.
3. Open. Every final is acted on without the word (the word is still stripped when he says it), and
   each final and each partial moves `openUntil` to now + 20 s, so "20 s of silence" means 20 s with
   no speech heard.
4. Open → closed: 20 s with nothing heard (a timer in the engine publishes it); "aitab", "see on
   kõik", "that's all" (with or without the word: nothing is typed, the strip says the window
   closed); a plain send ("saada") is acted on and closes it (the message is gone; the room's talk
   after it must not be typed); stopping listening.
5. While open the strip shows a small amber disc on the microphone (`wakeOpen: true` in the strip
   state; false when closed).

The match: each word's `phoneticKey` (after Cyrillic look-alike letters are read as Latin: the model
has written "Üтле") equals the wake word's key, or both keys have the same length of at least four
and differ by one letter or one swapped pair. So "ütle", "Ütle,", "Üтле" and "ütel" wake; "ütlesin",
"ütles", "ütleb" (a letter added) and "ma tahtsin ütelda" (not first) do not. `soundsLike` is not
used: it lets one added letter through, and "ütles, et tuleb" is ordinary speech.

Details: the options page's voice entry (26.5) bypasses the gate (spelling letter by letter with a
word before each would be unusable); a continued utterance (round 4's "siis …") passes when the final
it continues passed; the instant release of a one-word reply from a partial (21.3) is off while the
window is closed (a partial cannot be gated before its final), so a woken "saada" waits for its final,
about half a second.

**What the server sees.** Nothing new. The word is stripped on the client, not on the server as the
round 8 plan said: the server never sees settings, and a dropped final must cost nothing beyond the
socket. The cost of wake mode is the always-on socket: the client streams 16 kHz float32 mono, 64 000
bytes a second, 230.4 MB an hour (16-bit would be half: 32 000 B/s, 115.2 MB/h). The speech detector
(24.2) runs the decoder only on speech, so room noise yields no finals: a minute of pink noise at
-30 dBFS through `scripts/asr-file.ts` gives 0 finals (log in the WAKE lane report).

**29.4.2 Minu kohad.** `src/core/places.ts`: `Place { noun, url, label }`, stored in
`chrome.storage.local` under `places` as the user's rows; `placesFrom(stored)` merges them over the
defaults (a user row with the same noun wins; a row with an empty url removes a default).

| noun | address | label |
|---|---|---|
| uudised | https://www.postimees.ee/ | Postimees |
| raadio | https://otse.err.ee/k/vikerraadio | Vikerraadio otse |
| ilm | https://www.ilmateenistus.ee/ | Ilmateenistus |
| mail (also meil, post) | https://mail.google.com/ | Gmail |
| kalender | https://calendar.google.com/ | Google Kalender |
| kaart | https://www.google.com/maps | Google Maps |
| video | https://www.youtube.com/ | YouTube |
| pank | none by default | |

The radio address is ERR's live stream page for Vikerraadio (found by search, not opened). Changing
the station is the existing click intent on that page ("vali Raadio 2"): no code.

**By the rules** (`placeCommand(utterance, places)`), only when the box is not armed (in an armed box
"mis ilm on" may be a message): "vaata uudiseid", "näita uudiseid", "ava uudised", "pane raadio
mängima", "pane raadio käima", "ava raadio", "mis ilm on", "näita ilma", "ava mu mail", "ava meil",
"vaata videoid", in the general shapes `(ava|vaata|näita|mine) [mu|minu] <noun>`, `pane <noun>
(mängima|käima|tööle)`, `mis <noun> on`. The noun is matched after a case ending comes off
(uudiseid → uudis, raadiot → raadio, ilma → ilm, videoid → video) and by `soundsLike`. The engine
checks it before the rules of `inpage.ts` and runs `goTo` with the stored address. The engine holds
no places until the offscreen document hands it the merged list (`utle-places` at start, a `places`
message on every change; the service worker sends his raw rows, merged on the engine's side).

**By the model.** The page context carries `places: ["uudised", "raadio", …]`, the nouns only, never
an address. The model may answer `place { noun }`; `pageIntentFrom` accepts it only when the noun is
one of `page.places`, and the engine resolves the address from storage on his machine. A new intent
kind outside `PageIntent` (`ModelIntent = PageIntent | PlaceIntent`), so `applyIntent` in `inpage.ts`
is unchanged; the engine turns it into a `goTo` step.

**29.4.3 Adding a place by voice, and the settings page.** By voice, with no spelling: on the page
he wants, "lisa koht uudised", "salvesta see koht uudised", "save this place as news" (anywhere), or
"see on mu uudised" (only when no box is armed: there it may be a message) saves the address of the tab
in front under that noun; "eemalda koht uudised" / "remove place news" removes it (his row with an
empty address, so a default is hidden too). `placeVoice` in `places.ts` holds the rules; the noun is
one or two words through `placeNoun` and none of them a command word (`COMMAND_WORDS`: the command
heads of `ENROL_COMMAND_WORDS` and the place shapes' own words), else the utterance is not this. The
engine checks it before the place rules and sends a new command, `{ kind: 'savePlace' | 'removePlace';
noun }`, which the service worker resolves with the active tab's address and writes into `places`;
the strip says "Koht „uudised“ salvestatud: postimees.ee". "lisa koht" alone asks "Ütle, mis sõnaga
seda kohta kutsuda." and the next final within 20 s (`PLACE_ASK_MS`) is the noun, as the entry flow
of 26.5 does; an answer that is not a usable noun ends the question and is handled as usual. The
model never answers these (they are not in its command schema).

The settings page has a "Minu kohad" section after "Minu andmed": every place as noun → label and
address, a remove button on each (click or dwell), and a small form (noun, address) that adds one or
replaces the row with that noun, the helper's path. The page's `<main>` keeps 240 px free at its end
(the strip at its tallest is 192 px), so the last of the page scrolls clear of the bar.

### 29.5 Reading aloud: the measurement (READ lane)

**Verdict: an Estonian voice exists in Microsoft Edge only** (two network voices, Anu and Kert).
Playwright's Chromium and installed Google Chrome list none, so checkpoint 1 did not build the
reading feature (the plan's gate: an `et` voice in the suite's Chromium or in Chrome); checkpoint 2
built it on the orchestrator's ruling ("Built (checkpoint 2)" below). Measured on this
machine (Windows 11 Pro 10.0.26200, English UI, Russian and English speech voices installed) on
2026-10-22 with `npx tsx scripts/tts-voices.ts` (every browser headed; the voice list is read once
its length has not changed for 1 s, at most 6 s; then five runs of `speak()` to `onstart` on a
214-word Estonian paragraph, each cancelled at `onstart`):

| Browser | Voices | `et` voice | `speak()` to `onstart`, median of 5 |
|---|---|---|---|
| Playwright's Chromium 153.0.8010.12 | 8 (SAPI: en-GB George, Hazel, Susan; en-US David, Mark, Zira; ru-RU Irina, Pavel; all `localService`) | none | 151 ms (George; runs 624, 154, 147, 147, 151) |
| Google Chrome 155.0.8059.41 | the same 8 | none | 161 ms (George; 267, 161, 151, 167, 151) |
| Google Chrome, network voices on | 27: the 8, plus Google's 19 network voices (`localService: false`): de-DE, en-US, en-GB female and male, es-ES, es-US, fr-FR, hi-IN, id-ID, it-IT, ja-JP, ko-KR, nl-NL, pl-PL, pt-BR, ru-RU, zh-CN, zh-HK, zh-TW | none | 168 ms (George; 228, 168, 137, 143, 172) |
| Microsoft Edge 153.0.4234.32 | the same 8 | none | 160 ms (George; 344, 146, 178, 160, 151) |
| Microsoft Edge, network voices on | 329 | **et-EE "Microsoft Anu Online (Natural) - Estonian (Estonia)", et-EE "Microsoft Kert Online (Natural) - Estonian (Estonia)"**, both `localService: false` | 707 ms (Anu; 753, 486, 496, 744, 707) |

"Network voices on" drops Playwright's `--disable-component-extensions-with-background-pages`, which
hides the browser's own online voices; a person's everyday Chrome and Edge have them, so those rows
are what he would get. Network voices arrive after the local ones: the first run of this script read
the list after a fixed 3 s and once saw Chrome's 8 local voices only, which 29.5 first reported as
"no Google voices"; that was wrong. Chrome's 27 voices are Google's network voices, none Estonian. The
first run's medians were within 20 ms of these for the local voices and 662 ms for Anu. The local voices are
the Windows SAPI voices of the installed language packs: Windows 11 offers no Estonian speech voice
(Microsoft's "Supported languages and voices" list for Narrator and Settings > Time & language >
Speech has Finnish "Heidi" and no Estonian), so no setting on the person's machine adds one to
Chrome.

What the numbers mean. The local voices start in about 150 ms, but none is Estonian: an English or
Russian voice reads Estonian text with its own spelling rules (õ, ä, ö, ü, long vowels and double
consonants), which we take to be unusable for a person who depends on hearing it (the owner's ear
decides; not judged here). `src/speech/synth.ts` today asks for `et-EE`, finds no voice of that
family and leaves the voice unset, so the dev page's reading is in the browser's default voice
(George, English). Edge's Anu starts in about 0.7 s and is a natural Estonian neural voice, but it
is a network voice: the text goes to Microsoft's service and it needs the internet.

**Edge and the extension.** Measured with `npm run ext` then `npx tsx scripts/tts-voices.ts
--edge-extension`: the built extension is copied to a temporary folder, the copy's manifest gains
the `tts` permission and a probe page (the repository's manifest is unchanged), and Edge 153 loads
the copy unpacked with its network voices on. One Estonian sentence ("Tere, see on Ütle ja ma loen
teile seda lehte ette.") with Anu, three runs, cancelled at the start event; two runs of the script:

| Context | `getVoices()` | Both `et-EE` voices | Start event, run 1 (ms) | Run 2 (ms) |
|---|---|---|---|---|
| (a) a web page (the content script's world shares the page's `speechSynthesis`) | 329 | yes | 1241, 330, 460 (median 460) | 600, `synthesis-failed`, 275 |
| (b) the extension's offscreen document (`AUDIO_PLAYBACK`) | 329 | yes | 712, 470, 893 (median 712) | 1020, 348, 1250 (median 1020) |
| (c) `chrome.tts` in the service worker (`tts` permission) | 329 | yes (`remote: true`) | 475, 1125, 389 (median 475) | 402, 474, 741 (median 474) |

Every context lists and speaks Anu; one start in 18 failed with `synthesis-failed` (a network voice
can fail, so a reader needs a retry or a spoken error). The route this implies: Ütle can read
Estonian aloud in Edge with `speechSynthesis` in the offscreen document it already has (no new
permission and no server of ours), while in Chrome it would need TartuNLP through our server, so the
choice is which browser the person uses, which is the owner's. The `tts` permission is not added to the
product: `chrome.tts` works but gives nothing the offscreen document's `speechSynthesis` does not.

**The proposal if he stays in Chrome: TartuNLP's speech synthesis through our server.** Found on
2026-10-22:

- Endpoint: `POST https://api.tartunlp.ai/text-to-speech/v2` with `{"text": "...", "speaker":
  "mari", "speed": 1}` (text up to 10 000 characters, speed 0.5 to 2); the answer is one `audio/wav`
  (32-bit float, mono, 22 050 Hz). `GET /v2` lists the speakers: albert, indrek, kalev, kylli, lee,
  liivika, luukas, mari, meelis, peeter, tambet, vesta (Estonian) and sulev, hella (Võro). `POST
  /v2/verbose` also returns the normalised text and durations. `scripts/fixture.ts` already uses
  this endpoint to make test speech.
- Latency, measured with `npx tsx scripts/tts-voices.ts --tartunlp` (speaker mari, five runs):
  the first sentence (9 words, 3.6 s of audio) 504 ms median (648, 790, 479, 479, 504); the whole
  214-word paragraph (89.4 s of audio) 6 377 ms median (8 725, 6 174, 5 891, 6 377, 8 825). It does
  not stream, so reading must go sentence by sentence: about half a second to the first word, then
  each next sentence fetched while the one before plays.
- A 10 s sample of mari reading the paragraph's first two sentences, for the owner's ear:
  `docs/proof/r8-read-tartunlp-mari.wav` (16-bit, 22 050 Hz).
- Licence and use: the API and worker code are MIT (`TartuNLP/text-to-speech-api`,
  `TartuNLP/text-to-speech-worker`); the API names terms of service at
  `https://www.tartunlp.ai/andmekaitsetingimused` (a script-rendered page we could not read) and
  states no key, quota or price. The model files' own licence is not stated in the releases. Before
  a release: ask TartuNLP (ping@tartunlp.ai) whether a product's server may call the public API and
  what it logs; a page's text is the person's data.
- Cost: the public API is free and keyless today. Self-hosting is the API image
  (`ghcr.io/tartunlp/text-to-speech-api`), a RabbitMQ broker and the worker image with the
  multispeaker model (`multispeaker.zip`, 194 MB, release v3.1.0, plus a HiFi-GAN vocoder from
  Hugging Face); TensorFlow and PyTorch on CPU, so it would not fit beside the speech model in the
  current 1.22 GB image without a second service.
- Design (not built): the extension sends the text to be read to a new server route
  (`/api/speak`, the session's token), which splits it into sentences, asks TartuNLP for each in
  turn and streams the wav chunks back on the socket; the offscreen document, which already owns the
  audio devices, plays them with an `AudioContext` and reports start and end. While it plays, the
  engine pauses listening (the microphone track is muted, or the recogniser is sent nothing), so
  the speech detector (24.2) never sees the synthesised voice and nothing read aloud becomes a
  final; "stopp" is then heard only between sentences unless listening continues with the speaker
  gate on, which is the owner's choice of trade-off. The server never logs the text, like every
  other route.

Not built in checkpoint 1 (built in checkpoint 2, below): the commands ("loe ette", "loe see ette",
"loe edasi", "stopp"), the "Loe riba ette" setting, `fixtures/news.html` and its suite case.
Not measured: how either Estonian voice sounds to a person (the owner's ear), the real content
script's world in Edge (a page's `evaluate` stood in for it), Edge's voices in a profile signed in
to a work account or with policies, and a recording of Edge's Anu (the browser's speech output
cannot be captured from a test without a loopback device).

#### Built (checkpoint 2)

The orchestrator's ruling on the measurement above: the feature is built browser-independently on
`speechSynthesis` in the offscreen document (no `tts` permission, no server route); where no `et`
voice exists the bar says so instead of reading Estonian with an English voice. TartuNLP stays the
Chrome-side proposal, not built.

**Commands.** `BrowserCommand` gains `{ kind: 'read'; what: 'page' | 'box' | 'selection' | 'continue' | 'stop' }`.
Rules (`src/core/browserIntent.ts`, the fixed table, whole utterances after `cleanForBrowser`):

| Said | Command |
|---|---|
| "loe ette", "loe lehte ette", "loe leht ette", "loe see leht ette", "read the page", "read it out", "read this page" | read page |
| "loe see ette", "loe kasti ette", "loe kast ette", "read this", "read the box" | read box (the armed box's text; no armed box with text: the page) |
| "loe valitud ette", "loe valik ette", "read the selection" | read selection (the page's selected text; none: the page) |
| "loe edasi", "jätka lugemist", "continue reading" | continue |
| "lõpeta lugemine", "stop reading", "lugemine seis"; while reading also "stopp", "stop", "aitab", "seis", "lõpeta" | stop |

With the DOCS lane merged (29.2): "loe ette", "loe see ette", "loe tekst ette" and "read it back" first
meet DOCS's read-back rule in `src/core/inpage.ts`. With an armed box holding words they read that
box (DOCS's `speak` step); the offscreen document passes that text to this reader, so the Estonian
voice rule and the stop words hold for it too. With no armed box holding words they are read page.
"loe lehte ette", "read the page", "loe kasti ette" and the rest of the table are never DOCS's.

"stopp" and "aitab" keep their meanings (stop a slow scroll; typed as a one-word reply while the box
has words) everywhere except while reading: the engine (`extension/src/engine.ts`, `deps.reading`)
takes every final before the rules see it while a reading is in progress; a stop word (`isReadStop`
in `src/core/reading.ts`: "stopp", "stop", "aitab", "seis", "lõpeta", "lõpeta lugemine", "stop
reading", "lugemine seis", and "paus" / "peata", which stop a reading like any playing thing) runs
`read stop` at once, outside the queue, and nothing else; every other final and every partial is
dropped unseen (the pause rule below).
The model (`CommandSchema`, the tool schema's `kind('read', { what })`) may answer the same command;
its rules line: "loe ette", "loe mulle seda lehte", "ma ei näe, loe" read page; "loe see ette" with
an armed box read box; "loe edasi" continue; "lõpeta lugemine" stop; "ma ei näe" alone is still zoom
in. "loe viimane lause ette" is the DOCS lane's.

**What is read** (`read` in `extension/src/page.ts`). The root is the first `main` / `[role=main]`,
else `article`, else `#content` / `#primary`, else `body`. Inside it, in document order, every
`h1` to `h6`, `p`, `li` and `blockquote` that holds no other such block, skipping: anything inside
`nav`, `aside`, `footer`, `form`, `button`, a dialog (`dialog`, `[role=dialog]`, `[role=alertdialog]`,
`[aria-modal=true]`), the navigation, complementary, contentinfo, banner and search roles, `[hidden]`,
`[aria-hidden=true]`, `figcaption`, `address`, a byline (`[class*=byline]`, `[rel=author]`,
`[itemprop=author]`), Ütle's own `utle-*` elements, a `header` that is not inside an `article` or
`main`, anything in a fixed or sticky layer (a cookie banner without a role), and anything
`checkVisibility()` says is not rendered. A heading of 2 characters or more is kept; a paragraph or
list item is kept from 40 characters, or shorter when it ends with `.`, `!`, `?` or `…` (a crumb, a
byline and a menu item are shorter and unpunctuated). The same text twice is read once. `read box`
reads the armed box's text (Google Docs' text where it is the box); `read selection` the page's
selection; either falls back to the page when empty. The answer is `{ ok: true, reading: { text,
sentences } }`: the blocks joined, capped at 20 000 characters (`READ_MAX_CHARS`) at a block or
sentence boundary, and split by `readingText` in `src/core/reading.ts`.

**Sentences** (`splitSentences`, pure). Each block is split on its own, so a heading is one
sentence. A sentence ends at `.`, `!`, `?` or `…` (repeated, then optional closing quotes or
brackets) followed by white space or the end, except: when the next word begins with a lower-case
letter or a digit ("nt. kui", "22. oktoobril", "3. koht"); and after a title or an abbreviation that
never ends a sentence (`nt`, `vt`, `dr`, `hr`, `pr`, `prl`, `mr`, `mrs`, `ms`, `st`, `nr`, `lk`, `u`,
`ca`, `e.g`, `i.e`, `vs`, a single capital letter as in "A. Tamm"). "jne." and "jms." end a sentence
when a capital follows. A decimal ("3.5") has no space and is never split. A sentence over 300
characters (`MAX_SENTENCE_CHARS`) is cut at its last comma, semicolon or colon before the limit,
else its last space, so no single utterance runs long.

**The reader** (`extension/src/reader.ts` over the pure `readStep` of `src/core/reading.ts`). States:
`idle`, `speaking` (sentence `at`), `ended`, `stopped`. Events: `start(sentences)` from any state (a
new reading replaces the old: its sentence is cancelled first); `sentenceEnd` moves to `at + 1`, or
to `ended` after the last (the bar says "Lugemine on lõppenud." / "Nothing more to read.");
`sentenceError` retries the same sentence once, then skips it (`skipped` counts; the bar says
"Jätsin ühe lause vahele." / "I skipped one sentence." once per reading); `stop` while speaking
cancels (`speechSynthesis.cancel()`, synchronously in the command's handler) and goes to `stopped`;
`continue` from `stopped` speaks `at + 1`, and with nothing after it (or from idle or ended) the
command fails `not_found` and the bar says "Lugemine on lõppenud." / "Nothing more to read.". A
sentence that has not ended within 5 s plus 120 ms per character (`sentenceTimeoutMs`) counts as an
error, so a voice that never answers cannot hold the microphone shut. Events of a cancelled
utterance are ignored (each `speak` has a token). While a reading is in progress the strip state has
`reading: true` and the amber line says "Loen ette…" / "Reading…"; the toolbar icon or the bar's
microphone pressed while reading stops the reading and leaves listening as it was.

**The voice rule.** The first voice of `speechSynthesis.getVoices()` whose `lang` is `et` or starts
with `et-` / `et_` (case-insensitive). When the list is empty the reader looks again every 100 ms for
up to 1.5 s (network voices arrive late, as measured above). With no such voice nothing is spoken and
the command fails `not_allowed`; the bar says "Selles brauseris pole eesti häält. Edge'is on." /
"This browser has no Estonian voice; Edge has one.". Every utterance gets `lang` from the voice, rate 1.

**The pause rule** (changed in review round 1, so a person without hands can stop a reading by
voice). While an article, a box or a selection is read, the microphone stays live and the recogniser
hears the room, the synthesised voice included. The engine is the filter: while `reading` is true it
drops every partial and every final unless the final is a stop word, and dropped words are neither
published to the strip's heard line nor typed nor run, so the echo of the voice never shows. The
filter sits first in the handlers: in wake mode (29.4) it runs before the wake gate, so a stop word
stops a reading without the wake word and the echo never reaches the gate. A spoken
"stopp" (or "paus", "aitab", "lõpeta lugemine") is heard over the voice and cancels it at once
(measured below 300 ms in the suite). Strict mode and the speaker gate (24.2) still work underneath:
a final the server judges `other` (as a synthesised voice may be) is dropped before the engine sees
it. The cost of the echo: while an article plays, the server receives and decodes the speaker's voice
as speech (its CPU, and the audio bytes on the socket); no text of it is logged (the server never
logs text) and nothing of it reaches the page. Only a "Loe riba ette" line (under 200 characters, a
second or two) mutes the microphone: `mutedSource` in `offscreenMain.ts` hands the recogniser
silence while the line is spoken and for 150 ms (`RESUME_MS`) after it ends; the strip state's
`micMuted` says when. The bar's microphone or the toolbar icon pressed while reading also stops it.

**"Loe riba ette"** (`readBar`, settings page, last group, default off). When on, each new amber line
the offscreen document publishes is spoken with the same voice, the microphone muted while it speaks, when it is
under 200 characters, not the same line as the one spoken in the last 1.5 s, and no reading is in
progress; the live words (`heard`) are never spoken. The setting reaches the offscreen document at
its start (`utle-read-bar`) and on every change (`readBar`).

**Tests.** `src/core/reading.test.ts` (the splitter, the cap, the state machine, the stop words),
`src/core/browserIntent.test.ts`, `src/core/pageIntent.test.ts`, `server/intent.test.ts` (phrases and
schemas), `src/core/inpage.test.ts` (a reading keeps the box undo), `extension/src/engine.test.ts`
(the precedence of "stopp" while reading, the filter that drops every other word unseen, and nothing
changed outside a reading), `extension/src/offscreenMain.test.ts` (the engine, the real local
recogniser and a fake server that finalises any sound: the voice's echo is dropped unseen and a
spoken "stopp" stops the reading within 300 ms; the voice rule; retry and skip; "Loe riba ette"
mutes only its own lines). The browser suite reads
`extension/test/fixtures/news.html` with a fake `speechSynthesis` injected into the offscreen
document over the DevTools protocol (`Target.attachToTarget`; Playwright lists no offscreen page),
through the same bridge `send` as every other case; the suite has no spoken-utterance path.

**Not verified:** a human ear on Anu or Kert reading a real article; Edge in daily use (the suite's
Chromium has no Estonian voice, so the real voice was only probed in checkpoint 1); the
`synthesis-failed` rate over a real session (1 in 18 starts in the probe); how well TalTech's model
hears "stopp" over Anu's voice from a loudspeaker in a real room, and whether the 150 ms tail after a
bar line is enough for its echo; Chrome's own long-utterance cut-off on a network
voice (sentences are capped at 300 characters against it, not measured).

### 29.6 Dictation cleaning: the measurement (FLOW lane)

**Stand-in, not the measurement the plan asked for.** The plan wanted 20 of Ralf's own captured
finals. They do not exist: `UTLE_CAPTURE` was never run, there is no `log.tsv`. Everything below is
measured on a set this lane wrote, spoken by a synthetic voice. The verdict is provisional until the
same script runs on his 20 finals.

**Prior art** (web, 2026-10-22; vendor pages unless marked)

| Product | What it does to raw speech | Mechanism (as far as public) | Latency claimed | Estonian | Price |
|---|---|---|---|---|---|
| Wispr Flow | Drops "um"/"uh" and pauses; backtrack ("2… actually 3" becomes 3); punctuation from pauses plus spoken marks; spoken numbering becomes a list; tone per app ("styles", English and desktop only); learns a dictionary; snippets. Command Mode on Pro (third-party source) | Cloud only. ASR, then a fine-tuned Llama cleanup pass on dedicated Baseten inference | Under 700 ms end to end, measured at p99 (Baseten case study) | Unknown: "100+ languages", no list found | Free; Pro $15/mo ($12 annual); Growth $23/mo |
| Superwhisper | "Voice to Text" mode: no AI. Message, Mail and Note modes: an LLM cleans the transcript, with a tone slider. Super mode adds context (app, copied text, selected text). Custom modes take your own prompt. A mode can switch on by app | Two stages: speech model (local or cloud, picked per mode), then LLM processing. App context is read between the two. Its docs warn that custom prompts make the LLM answer the dictation or add content | None found | Likely through Whisper-class models ("100+ languages"); not verified | $8.49/mo, $84.99/yr, $249.99 lifetime |
| Aqua Voice | "Cleaned up and formatted for wherever you're typing"; custom instructions; Deep Context reads the screen for names and terms; dictionary. Filler handling not spelled out | Own ASR model (Avalon), cloud. Instant mode and Realtime (streaming) mode | Inserts text in about 1 s, "as fast as ~450 ms" | **Yes** (49 languages) | Free 1,000 words; Pro $8/mo annual, $10 monthly; Max $24/mo annual |
| macOS Dictation | Auto-punctuation (commas, periods, question marks) in some languages; spoken punctuation and editing commands. No filler removal | On-device on Apple silicon for supported languages, otherwise Apple's servers | None | **No** (not in the Dictation list) | Built in |
| Windows 11 voice typing (Win+H) | Optional auto-punctuation; Estonian spoken commands "koma", "punkt", "küsimärk", "hüüumärk", "uus rida", "kustuta see". Fluid dictation (fillers out, grammar fixed) is English only, on-device, Copilot+ PCs | Online (Azure Speech) | None | **Yes** for voice typing and its commands; no for Fluid dictation | Built in |

Sources: wisprflow.ai/features, wisprflow.ai/pricing, docs.wisprflow.ai/articles/3191899797-use-flow-with-multiple-languages,
baseten.co/customers/wispr-flow, eesel.ai/blog/wispr-flow-pricing (Command Mode; third party);
superwhisper.com/docs/modes, ai.superwhisper.com/docs/modes/custom, superwhisper.com/docs/common-issues/context,
ai.superwhisper.com/docs/common-issues/hallucinations.md, superwhisper.com/docs/billing/plans.md;
aquavoice.com/llms.txt, aquavoice.com/faq, aquavoice.com/guide/languages;
apple.com/macos/feature-availability, support.apple.com/guide/mac-help/use-dictation-mh40584/mac;
support.microsoft.com/en-us/windows/use-voice-typing-to-talk-instead-of-type-on-your-pc-fec94565-c4bd-329d-e59a-af033fa5689f.

Three things carry over from all of them. The cleaning step is a separate LLM pass after the
recogniser. It is tuned per app. Speed is sold at well under a second. The only Estonian-capable
products with any cleaning are Aqua (unverified for Estonian fillers) and Windows (spoken marks only).

**What Ütle already does to dictation, and what it does not**

| Behaviour | Ütle today |
|---|---|
| Punctuation and capitals | The TalTech decoder writes them itself ("Tere, Mari. Ma jõuan homme kell kolm."), but not every time: one voice got none at all, and another got a stray opening quote (lines 5 and 6 of the set). `joinDictation` (`src/core/inpage.ts`) capitalises a sentence start and adds a full stop after three or more words. |
| Spoken numbers | `typedFromSpoken` text mode turns three or more number words in a row into digits. A decoder comma ends the run, so "viis, viis, viis üks kaks kolm neli" is typed as "viis, viis, 51234" (checked). |
| Spoken punctuation ("koma", "punkt") | Only in e-mail and code fields. In a message the words "koma" and "punkt" are typed as words (checked). |
| Fillers, restarts, self-corrections | Nothing. The words are typed as heard. |
| Repair by voice | "võta tagasi" (the undo stack of earlier box texts), "kustuta viimane sõna/lause", "asenda X sõnaga Y", "mitte X vaid Y". In document mode the model proposes ops and the preview shows the diff (`diffSegments`). |
| The model and dictation | Type first, verify after (22.2). The intent model's `dictate.text` ("tidied into a sentence") is never typed: when it says `dictate`, the rules' words stay. |

New finding from the decoder: **the TalTech model hears the filler "ee" as "ei" ("no", "not")**.
It did so in both lines where the voice said it: "Ei noh, ma arvan…" and "Ei, Eesti kirjandus ei
kujunes…". So a filler turns into a negation. That is the most dangerous kind of change to
remove automatically, because a real "ei" must stay (line 19).

**The set** (`scripts/fixtures/flow-set.tsv`, 20 lines, `raw<TAB>meant`). Every `raw` is real
decoder output (`scripts/asr-file.ts`, TalTech model with the Silero detector) from a synthetic
voice (TartuNLP). Lines 1 to 6 are the repository's fixtures: `et-dictate-send`, `live-vad-saada`,
`et-jah`, `et-sentence`, `speaker-set/other-kalev-3` and `speaker-set/other-albert-3`. Lines 1 to 3
are the controls. Lines 7 to 20 this lane wrote, spoke with the voice "mari" and decoded. They
cover fillers (7, 8, 14, 17, 18), restarts (11, 15), self-corrections (9, 10, 16), a phone number
(12), spoken punctuation (13), and traps where "ei" and "tegelikult" are meant (19, 20). The
decoder added its own errors, and they stay in `raw`: "võitu" for "võid", "Egaarel … tööl" for
"ee Kaarel", "trend" for "trenn", "igav igav", a trailing "siis".

**The measurement** (`scripts/flow-eval.ts`). WER is Levenshtein distance over lowercase words with
punctuation stripped, against `meant`. Effort is `low`, as the server's quick asks use, and
temperature is the API default. Runs a to c went in parallel with the haiku and sonnet runs. "Ütle
today" means `raw` plus the rules above; it differs from `raw` only on line 12.

| Model | Output | Runs | WER raw / Ütle today | WER cleaned | p50 / p90 latency | Tokens in / out per line | USD per 1000 | Meaning changes |
|---|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | plain text | 3 (+1 earlier) | 28.0 % / 25.2 % | **3.5, 3.5, 3.5 %** (earlier run 4.2 %) | 1350, 1720, 1281 ms (earlier 1282) / 3136, 3415, 3173 ms | 709 / 61–63 | 4.05–4.10 | **0 of 20** in every run |
| claude-opus-5-5 (orchestrator re-run) | plain text | 1 | 28.0 % | 4.2 % (6/143) | 1370 ms / not reported | not reported | not reported | 0 of 20 (flagged #10 võitu, #14 ei, #17 egaarel tööl, #19 trend; none a meaning change) |
| claude-sonnet-5-5 | plain text | 1 | 28.0 % | 13.3 % | 1100 / 2799 ms | 709 / 55 | 1.97 | 1 of 20 |
| claude-haiku-5-5 | plain text | 1 | 28.0 % | 72.7 % | 854 / 1324 ms | 709 / 40 | 0.09 | 3 of 20 |
| claude-opus-5-5 | structured `{text}` | 1 | 28.0 % | 2.1 % | 3481 / 4966 ms | 893 / 31 | 4.19 | 0 of 20 |
| claude-sonnet-5-5 | structured `{text}` | 1 | 28.0 % | 3.5 % | 1441 / 3724 ms | 893 / 46 | 2.25 | 0 of 20 |
| claude-haiku-5-5 | structured `{text}` | 1 | 28.0 % | 5.6 % | 1537 / 2417 ms | 893 / 32 | 0.11 | 2 of 20 |

**Meaning changes, read line by line.** A meaning change is something the cleaning added, dropped,
or got the wrong way round compared with `raw`. A decoder word the cleaning left in is not one.

- Sonnet, plain text, #10: "Too poest piima ja leiba ei, ma mõtlen piima ja võitu" became "Too poest piima ja võid.", then a blank line, "Hmm, "võitu" — ära paranda sõnu. Jätan öeldud kujul.", then "Too poest piima ja võitu.". Its own deliberation went into the answer and would have been typed.
- Haiku, plain text, the same failure on three lines: #16 "Uuringus osales kakskümmend vabandust kolmkümmend õpilast" became a first try, then "Hmm, wait: the rules say…", then a second try; #17 "…Tartus tööl." became "…Tartus. Tööl." plus "Hmm, "tööl" on siin eraldi lausena…"; #19 "…mul on trend." became "…mul on tren." plus "Hmm, "trend" ei sobi siin…".
- Haiku, structured: #16 "kakskümmend vabandust kolmkümmend" became "kakskümmend, õigemini kolmkümmend": the retracted number stays. #17 "…ma elan Tartus tööl." became "…ma elan Tartus. Töötan.": a sentence he did not say.
- Opus (all four plain runs and the structured run) and Sonnet structured: none.

Left in by every model, and not counted: #17 "Egaarel" and "tööl" (decoder). #19 "trend" (decoder; Opus structured changed it to "trenn"). #14 and #7 the leading "Ei," that was a misheard "ee": Opus plain kept it on #14, Opus structured removed it, Sonnet structured kept it on both. #9 a trailing "siis". In the earlier Opus run, #10 kept "võitu".

**The ee/ei hazard.** The 0 of 20 above holds only because this set's `meant` says which "ei" was a
negation and which was a misheard "ee". The cleaner has no such knowledge: it guesses, from the
sentence alone, whether he said "not" or hesitated, on a decoder that turns his "ee" into "ei".
Line 14 shows one side of it. Raw "Ei, Eesti kirjandus ei kujunes välja…" was cleaned to "…kirjandus
kujunes välja…" in every Opus run. The cleaner removed a mid-sentence "ei". Here that was right, by
this set's word. In a sentence where he meant "ei", the same rule removes his negation and types the
opposite of what he said. Line 19 shows the other side. "Ei, ma ei saa täna tulla" kept both of its
"ei", correctly. These two lines differ only in whether the sentence still parses with "ei" in it.
That is the model's guess, not a fact the server can check. A dropped "not" reads fluently, and a
person who cannot use his hands may not see it before "saada". It is the most dangerous change this
lane found.

**Verdict per the kill rule (kill if cleaning changes meaning in more than 1 of 20):** as applied, 0
of 20 on this stand-in for Opus, in each of four runs plus the orchestrator's re-run. Word error
fell from 28.0 % (25.2 % after Ütle's own rules) to 3.5–4.2 %. So cleaning is not killed for Opus.
Haiku is killed (2 to 3 of 20). Sonnet passes only with structured output (0 of 20); in plain text
it typed its own monologue once. This 0 of 20 is not the test. These are the lane's sentences in a
synthetic voice, and a prompt rule ("ee" heard as "ei") came from the same decoder run. The real test
is Ralf's 20 captured finals, with his own fillers, run through `npx tsx scripts/flow-eval.ts` (replace
the TSV). The thing to count there is the ee/ei hazard: every line where cleaning removed or added a
negation word, judged against what he meant.

**Proposed next step** (only after the real 20 pass). Add a `clean` option to the preview path, on
the server, under the same rule as editing: the model proposes ops, and the server and the reducer
validate them. The box text becomes a one-block `Doc`. The model answers `replace_text` ops (exact
`find`, `replace`), never a rewritten string. `applyOps` refuses a `find` that is not in the text,
and an op that adds a content word the utterance lacks is refused too (a new check, the same test
as this script's INVENTED flag). **Negation rule:** the cleaner may never remove or add a negation
word ("ei", "mitte", "pole", "ära") unless it is the first word of the utterance. The ops validator
refuses any op whose `find` and `replace` differ in the count of those words outside the first
word, and the model is told the same. Under this rule, line 14 keeps its mid-sentence "ei" ("Eesti
kirjandus ei kujunes"): wrong grammar he can see and repair, instead of a silently flipped meaning.
Order: type first (as today), clean after, show the change with
`diffSegments`, and let "võta tagasi" undo it. Measured cost, plain text: Opus about $4.1 per 1000
utterances at 709 in and 62 out tokens, p50 about 1.3 s after the final. Sonnet structured: about
$2.3 per 1000 at about 1.4 s. Answering as ops roughly doubles the output tokens (estimated, not
measured): Opus about $5.3 per 1000 (709 in, about 124 out). Two fixes need no model and are cheaper than any of this: type
spoken "koma"/"punkt" as marks in a message, and stop a decoder comma from splitting a digit run.

## 30. Round 9: usable by everyone (2026-10-27 night)

Plan: `docs/plans/2026-10-27-usable-by-everyone.md`. One subsection per lane; a lane writes only
its own. Written before the code, as the rule in `CLAUDE.md` asks.

### 30.1 The first run (ONBOARD lane)

(lane ONBOARD writes this)

### 30.2 Help inside the product (HELP lane)

(lane HELP writes this)

### 30.3 Known faults fixed (FAULTS lane)

(lane FAULTS writes this)

### 30.4 Real public pages: the measurement and what changed (REALPAGES lane)

(lane REALPAGES writes this)

### 30.5 One door to any model, cost per completed task (MODEL lane)

Plan: `docs/plans/2026-10-25-round-9-model-provider.md`, lanes A and B. Lane C (the drill on a
real DeepSeek key) is the owner's.

**30.5.1 The door.** Every model call of the server goes through one interface in `server/model/`:
`Model.ask(ask: ModelAsk): Promise<ModelReplyNeutral>`. Nothing outside `server/model/` imports a
provider's SDK or speaks its wire format.

```ts
interface ModelTool { name: string; description: string; schema: Record<string, unknown>; strict?: boolean }
interface ModelToolCall { id: string; name: string; input: unknown }
interface ModelAsk {
  system: string                 // the fixed, cacheable prefix
  systemExtra?: string           // CAREFUL_PROMPT, after the cached block
  user: string                   // the one user turn
  tools: readonly ModelTool[]    // one for /api/intent, four for /api/interpret
  corrections?: ReadonlyArray<{ call: ModelToolCall; error: string }>  // /api/interpret's retry
  effort?: 'low' | 'high'        // absent: the provider's default
  maxTokens: number
  timeoutMs: number
}
interface ModelReplyNeutral {
  call: ModelToolCall | null     // the first tool call, or null
  stop: 'tool' | 'text' | 'cut' | 'refusal'
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
  provider: string; model: string; ms: number
}
```

The plan's `tool` (one) became `tools` (a list) and `call` carries the tool's name and id, so the
old `/api/interpret` demo path (four tools, one corrective turn) goes through the same door. `usage`
counts tokens billed at the full input price (`input`), read from the cache (`cacheRead`), written
to it (`cacheWrite`) and generated (`output`); the four never overlap, so cost is a sum of four
products. A failure is thrown as a `ModelError` with `kind`: `timeout`, `unreachable` (connection
refused or lost), `busy` (429, 5xx), `no_key` (401, 403) or `rejected` (any other status, with it).

- `anthropic.ts`: the SDK call of round 8 moved verbatim: the first system block marked
  `cache_control: ephemeral`, `systemExtra` as a second block only when given, `output_config.effort`
  only when given, `tool_choice: { type: 'auto', disable_parallel_tool_use: true }` (forced tool use
  is a 400 on Sonnet 5.5 and Opus 5.5, so `/api/interpret` loses its `any`), the SDK timeout, no
  retries. `stop_reason` `max_tokens` is `cut` (even with a tool call in it), `refusal` is
  `refusal`, a tool call is `tool`, else `text`. Usage: `input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`.
- `openaiCompat.ts`: one `fetch` to `${baseUrl}/chat/completions` with an `AbortSignal.timeout`.
  Body: `model`, `messages` (one system message, `system` and `systemExtra` joined by a blank line so
  the cached prefix stays the same; the user turn; per correction an assistant `tool_calls` turn and a
  `tool` turn), `tools` as `{ type: 'function', function: { name, description, parameters } }`
  (`strict` only when true), `tool_choice` the one function by name (or `required` for several),
  `max_tokens`. DeepSeek gets `thinking: { type: 'disabled' }` on every ask (plan 4.3: a careful ask
  on a non-thinking fallback gets no thinking); the field name is from third-party docs of V4 Flash,
  not yet from a live call (lane C). `finish_reason` `length` is `cut`, `content_filter` is
  `refusal`; `tool_calls[0].function.arguments` is parsed with `JSON.parse` in a try and a failure
  is `text`. Usage: `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` when present (DeepSeek),
  else `prompt_tokens` less `prompt_tokens_details.cached_tokens`.
- `fallback.ts`: `withFallback(primary, fallback | null)` is itself a `Model` and remembers which one
  gave the last reply (`last: 'primary' | 'fallback' | null`, null before any). The fallback is asked
  only after a fast failure of the primary: `no_key`, `busy`, `unreachable`, or a reply with
  `stop: 'refusal'`. Never after `timeout` or `rejected`: a spoken command that waited 7 s does not
  wait 7 more, and a 400 is our bug, not the provider's.
- `config.ts` parses the strings below; `index.ts` has `modelFromEnv(env)`, which returns the
  composed `Model` with its labels, or throws the configuration's one-line message.

**30.5.2 The configuration.** One string per slot, provider and model joined by a colon:

| `UTLE_MODEL` / `UTLE_FALLBACK` | provider | base URL | key |
|---|---|---|---|
| `claude-sonnet-5-5` (no colon) or `anthropic:claude-sonnet-5-5` | Anthropic SDK | SDK default | `ANTHROPIC_API_KEY` |
| `deepseek:<model>` | OpenAI-compatible | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` |
| `fireworks:<model>` | OpenAI-compatible | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` |
| `openrouter:<model>` | OpenAI-compatible | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `openai:<model>` | OpenAI-compatible | `UTLE_MODEL_URL` (fallback slot: `UTLE_FALLBACK_URL`) | `UTLE_MODEL_KEY` (fallback slot: `UTLE_FALLBACK_KEY`) |

`UTLE_MODEL` unset is `anthropic:claude-sonnet-5-5` (unchanged default); `UTLE_FALLBACK` unset or
empty is no fallback. An unknown provider, an empty model, or a non-Anthropic slot without its key
or URL stops the server at start with one line naming the variable. A missing `ANTHROPIC_API_KEY`
does not: that is the known "no model, rules only" state, reported by `/api/status` as
`intent: 'no_key'` as before. `/api/status` gains `model: { primary, fallback, last }`
(`primary` and `fallback` as `provider:model`, `fallback` null when unset); in rehearsal mode
`model` stays null.

**30.5.3 What the server says about cost.** `/api/intent`'s answer carries
`usage: { input, output, cacheRead, cacheWrite, provider, model }` (optional in
`IntentAnswerSchema`), and its log line gains `in= out= cached= provider=`; never words. An error
line keeps its shape and gains `provider=` only.

**30.5.4 The usage record, per completed task.** The unit is the engine's `Job` (one utterance to
its end). `Job.spend` sums `asks`, `input`, `output`, `cacheRead` and `ms` over every `askOnce`
(a failed ask counts as an ask with its time and no tokens) and keeps the provider and model of
the last answer. When the job ends, in `endWork`, the one place every ending passes, the engine
emits one record:

`{ outcome, asks, steps, goals, input, output, cacheRead, ms, provider, model }`

`outcome` is `tookTooLong` (the watchdog), else `cancelled` ("katkesta", or a later utterance that
cancelled it), else `rules` (no ask was made: the rules finished it), else what the model work
ended in: `done`, `unclear` (the answer was unclear and no step of it ran), or `stopped` (step
limit, failures, no answer). A type-first job that hands its utterance to a background verification
emits nothing; the verification's job emits the record (a dictate verdict, the words staying, is
`done`). The record holds no words, no page and no address. The engine passes it to `deps.spend`;
the offscreen document logs it as `[spend] outcome=… asks=… …` and sends it to the service worker,
which keeps the last 200 in `chrome.storage.local` under `utle-spend`
(`extension/src/spendStore.ts`; an offscreen document cannot reach storage itself).

**30.5.5 The eval's number.** `scripts/intent-eval.ts` builds its model with `modelFromEnv` (so
`UTLE_MODEL=deepseek:deepseek-flash npx tsx scripts/intent-eval.ts` is the whole switch; the
default is now the server's), prints tokens and dollars per case, and ends with the table
`model | pass | asks per task | tokens per completed task (in / cached / out) | $ per completed task | $ wasted on failed tasks | p50 / p95 ms`.
"Per completed task" divides the total over all cases by the cases passed, so failures pay in the
denominator; "wasted" is the spend on the failed cases. Prices per model id are in
`scripts/prices.ts` (moved out of `flow-eval.ts`), with DeepSeek's peak and off-peak rates by the
hour of the ask; `UTLE_EVAL_JSON` gets per-task records and the hour of the run.

**30.5.6 The eval on the default model.** Round 8's eval ran on Opus 5.5 while the server's default
is Sonnet 5.5; on Sonnet it passed 63 of 78 (2026-10-27 08:06 UTC). The fifteen failures, by cause:

- Right in substance, wrong in shape (seven cases: three places, four saved values). Sonnet wraps a
  place or a saved value as a command, `{ kind: 'command', command: { kind: 'place', noun } }`.
  `liftWrapped` in `server/intent.ts` lifts exactly these two kinds to the top, with only their own
  field (`noun`, `name`), before `pageIntentFrom`; every other shape is validated as it came.
- The prompt was unclear to Sonnet (three changes to `INTENT_SYSTEM_PROMPT`, one static text, so
  the cached prefix stays one prefix): "tagasi" in an armed box with text is the edit undo, never
  pressKey Undo (Google Docs only); a search that serves opening or playing something is done:false;
  in the WhatsApp delete, the choice "Kustuta kõigi jaoks" is done:false because a confirming
  dialog follows. ("tagasi" in a chat box reaches the model only in the eval, which calls
  `pageIntent` directly; in the extension the rules answer it before any ask.)
- The identical failed action repeated (one case): `repeatsFailedStep` answers unclear when the
  answer is the same id-addressed command (clickItem, focusItem, hover, contextMenu, scrollTo on the
  same id) as a step that failed, as the prompt already asked.
- The case expected one of two acceptable answers (widened, not loosened): "mina youtube" and
  "open youtube" on the new-tab page accept clicking the YouTube tile as well as going to the
  address; "kirjuta uus kiri" in Gmail accepts the compose command as well as clicking Koosta; the
  four multi-step cases written as one goal (done:false between steps) accept the round 4 answer,
  done:true with the rest in `plan`, and the eval then asks the rest as the chain the engine would
  derive. One case had wrong data: "homme asemel täna" ran on a box without "homme"; the box now
  holds "Tulen homme".

After the fixes (08:41 UTC): Sonnet 5.5 77 / 78 ($0.0057 per completed task, p50 1.6 s), Opus 5.5
77 / 78 the same hour ($0.0084, p50 2.5 s). Sonnet's one miss, the WhatsApp delete chain stopping a
step before the confirming button, passed in the run before; Opus's, scrolling again where the
steps show it already scrolled, is Opus's own.

### 30.6 The store (SHIP lane)

(lane SHIP writes this)
