# Ütle: architecture

As of 2026-10-05. Written before any code. This is the spec; the implementation plan in
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
| `src/core/preview.ts` | `buildPreview(doc, ops)` for rendering a proposal | `document`, `ops`, `diff` |
| `src/core/candidates.ts` | Mark candidate quotes in a block for the "which one" question | `document` |
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
| `server/vitePlugin.ts` | Mounts `POST /api/interpret` on the dev server | `interpret` |
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
- `move_blocks`: an empty list, a repeated id, or `beforeBlockId` inside the moved set is `bad_move`.
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
export type Mode = 'listening' | 'thinking' | 'confirming' | 'choosing' | 'asleep';
export interface Session {
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
}
export type Event =
  | { type: 'utterance'; text: string; source: 'voice' | 'typed' }
  | { type: 'key'; key: 'confirm' | 'reject' }
  | { type: 'intent'; seq: number; intent: Intent }
  | { type: 'interpretFailed'; seq: number; message: string };
export type Effect = { type: 'interpret'; seq: number; request: InterpretRequest };
export function initialSession(doc: Doc): Session;
export function step(s: Session, e: Event): { state: Session; effects: Effect[] };
```

Transition table. "Quick" means the result of `quickReply` on the utterance.

| Mode | Event | Result |
|---|---|---|
| any | utterance that is empty after trimming | no change |
| asleep | quick `wake` | `listening` |
| asleep | anything else | no change, not counted |
| thinking | utterance or key | no change, `understood` says a request is in progress |
| listening | quick `sleep` | `asleep` |
| listening | quick `undo`, history not empty | pop history and log, restore the document |
| listening | quick `undo`, history empty | message: nothing to undo |
| listening | quick `number` n naming a block | focus that block |
| listening | quick `number` naming no block | message: no such paragraph |
| listening | quick `yes` or `no` | message: nothing to confirm |
| listening | any other utterance | `thinking`, resume `listening`, effect `interpret` |
| confirming | quick `yes`, or key `confirm` | apply ops, push history and log, `listening` |
| confirming | quick `no` or `undo`, or key `reject` | drop the proposal, `listening` |
| confirming | quick `sleep` | drop the proposal, `asleep` |
| confirming | any other utterance | `thinking`, resume `confirming`, effect `interpret` with `pending` |
| choosing | quick `number` in range | `thinking`, resume `choosing`, effect `interpret` with `choice.picked` |
| choosing | quick `number` out of range | message: say a number from 1 to k |
| choosing | quick `no`, or key `reject` | drop the question, `listening` |
| choosing | any other utterance | `thinking`, resume `choosing`, effect `interpret` with `choice.picked = null` |
| thinking | intent with a stale `seq` | no change |
| thinking | intent `propose_edit` whose ops apply | `confirming` with `pending` |
| thinking | intent `propose_edit` whose ops fail | resume mode, message: nothing changed |
| thinking | intent `ask_which` with two or more candidates | `choosing` |
| thinking | intent `navigate` | `listening`, focus the block |
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
what they said. Text changes are word-level diffs. `added` rows sit after the nearest
preceding block that did not move.

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
Chrome ends the session. The interpreter is language-agnostic; only the recogniser has a language.

## 12. Server

`interpret(request, client)`:

1. Check the request with `InterpretRequestSchema`.
2. Build one user message: the numbered document (`#3 id=b3 h2: Summary`), then the pending
   proposal or the question being answered when present, then the utterance.
3. Call the model with four strict tools and `tool_choice: { type: 'any', disable_parallel_tool_use: true }`,
   so the answer is exactly one tool call. Thinking is off. Timeout 20 s, one SDK retry.
4. Map the tool input to an `Intent`, check it with `IntentSchema`, then check it against the
   document: every id exists, `applyOps` succeeds, `ask_which` has two or more candidates.
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
| D8 | `diff` package for word diffs | Diffing is solved; a hand-rolled one is a liability. |
| D9 | Haiku 4.5 by default | Sub-second answers matter more than depth for single-sentence edits. The smoke test decides whether it is good enough. |
| D10 | No persistence | Reload resets to the sample document, which is what a demo wants. |

## 16. Open questions for the room

- Where does editing break in the Danish fieldwork: accuracy, moving around, correcting, formatting?
- Is Chrome's Estonian recognition usable, or is a paid recogniser needed?
- Which repair words does a person with lived experience actually reach for?
