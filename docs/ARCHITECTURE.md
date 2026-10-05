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
  asked: string;                  // the instruction sent with that request
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

**The target tab.** Commands act on the active tab of the most recently focused ordinary (`normal`) browser window that is not the window the request came from. The service worker keeps a most-recently-focused list of window ids in session storage; when it knows nothing, it takes any ordinary window other than the sender's. Ütle's own window is never a target: when docked it is a popup window, and in any case it is the sender's window. No such window: `no_target`. `newTab` opens in the target window and so becomes the target. Pages an extension may not script (`chrome://`, `chrome-extension://`, `about:`, the Chrome Web Store, and any page where injection fails with an access error) answer `not_allowed` with a plain sentence. `newTab` and `goTo` accept only `http` and `https` addresses. Tab commands that navigate wait for the tab to finish loading (at most eight seconds) and answer with the resulting `tab: {title, url}`.

**Numbered labels.** An element is actionable when it matches one of: `a[href]`, `button`, `input` (not hidden), `textarea`, `select`, a `contenteditable` root, `role` button, link, tab, menuitem, option, checkbox or textbox, or an `onclick` attribute; and is not disabled. It is visible when it has a non-empty box that intersects the viewport, `checkVisibility` (visibility, opacity, content-visibility) passes, and a hit test at its centre (or one of four inner points) lands on the element or inside it, so things under a dialog are skipped. An element nested inside another actionable element with nearly the same box is the same target and gets no second number. Labels are small black-on-yellow numbers in a shadow-DOM layer positioned in document coordinates, so they scroll with the page. They stay until `clickHint`, `hideHints`, a new `showHints`, or a navigation (a real one unloads the page; a same-document one fires the Navigation API's `navigate` event, which removes them). `clickHint` focuses a text field (input, textarea, contenteditable) and puts the caret at the end; anything else gets pointer and mouse down/up events and then `click()`.

**Inserting text.** The box is the focused editable element; else the visible `contenteditable` with `role="textbox"` lowest on the screen (where composers live), else a visible textarea, else a visible text input. The text goes in with `document.execCommand('insertText')`, which fires a real `beforeinput` and `input`, so framework editors (React, Lexical) take it as typing and the text arrives once. If the command is refused, an input or textarea gets its value through the native setter and an `input` event, and a contenteditable gets a dispatched `beforeinput`. `submit` then dispatches `keydown`, `keypress` and `keyup` for Enter; if the box still holds the text after a moment, it clicks the site's send button when `sites.js` names one, or submits the input's form.

**Opening a conversation.** Names are compared lower-cased with diacritics removed (`Märt` matches `mart`). Score: whole name equal 100; every spoken word equal to a word of the name 80; every spoken word a prefix of a word 60; contained anywhere 40. Highest wins, ties go to the shorter name, then the first on screen. On messenger.com and facebook.com/messages the candidates are the conversation links named in `sites.js`; elsewhere every visible link, list item, row or option. Nothing scores: `not_found`.

**The dock.** The toolbar button opens Ütle in a popup window, 440 px wide and full height at the left edge of the work area of the display under the current window, and moves the current browser window to fill the rest. A second click finds the existing popup showing the Ütle origin and focuses it. Ütle is a top-level page there, so microphone permission works as in a tab.

**Best effort, and says so.** Everything about Messenger's markup (`sites.js`) is unverified until a logged-in person tries it. Synthetic Enter is not a trusted key press; a site that checks `isTrusted` will not send, which is why the send-button fallback exists. Hit testing cannot see elements inside cross-origin iframes or closed shadow roots, so those get no number.
