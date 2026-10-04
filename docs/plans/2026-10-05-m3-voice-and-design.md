# Ütle M3 (voice without a model) and design implementation plan

> **For agentic workers:** execute task by task, in order, in this session. Test-first for
> everything in `src/core` and for every unit in `src/speech` that can run in Node.

**Goal:** Everything voice needs works and is measurable with no API key: hands-free start,
commands that never touch the network, reading aloud, proof that the editor is hearing,
a recogniser test bench with a score, and a recogniser that can be scripted so the whole voice
path is verifiable without a person. Then the interface gets an identity of its own.

**Architecture:** The reducer gains a local command tier that returns the same `Intent` the
model would, so nothing downstream changes. Reading aloud is an effect like `interpret`.
New browser adapters (speech synthesis, level meter, scripted recogniser) sit behind small
interfaces. The design is tokens plus four components; no logic moves.

**Tech stack:** unchanged. No new dependencies.

**Spec:** `docs/ARCHITECTURE.md` sections 18 (voice) and 19 (design), added with this plan.

## Global constraints

Those of the M1 and M2 plan, plus:

- Nothing in this milestone calls the model. Every behaviour here must work in rehearsal mode and with the server stopped.
- A local command produces an `Intent` and goes through the same checks as a model's.
- Edits still need yes. Only moving and reading act at once.
- One typeface family. No all-caps labels, no monospace labels, no cards, no decoration that carries no information.
- Both themes. Visible keyboard focus. `prefers-reduced-motion` stops the dots from animating.

## Review focus

1. Reading aloud while the microphone is open: the editor hears itself. Expected: while reading, only "stop" (or any real utterance, which stops the reading first) is acted on. Test: Task 3.
2. A local command wrongly catches a sentence meant for the model ("go to the budget and change the deadline"). Expected: only whole-utterance matches are local. Test: Task 2.
3. A heading matched in the wrong language or by a short common word. Expected: a heading matches only when every one of its words is found; two matching headings give no local match. Test: Task 2.
4. The recogniser offers the right word only as a second alternative ("to" first, "two" second). Expected: the alternative that is an instant command wins when nothing is held. Test: Task 4.
5. Microphone permission not yet granted. Expected: no automatic start, no error, one click starts it and the next visit starts by itself. Verified in the browser, Task 7.

## Tasks

### Task 1: Word error rate
**Files:** `src/core/wer.ts`, `wer.test.ts`
**Produces:** `wordErrorRate(expected: string, heard: string): { words: number; errors: number; rate: number }`.
Tests: identical is 0; case and punctuation are ignored; one substitution in five words is 0.2; a deletion and an insertion each count one; empty heard gives rate 1; empty expected gives words 0 and rate 0 or 1 by whether anything was heard; Estonian letters survive normalisation.

### Task 2: Local commands
**Files:** `src/core/localIntent.ts`, `localIntent.test.ts`, `src/core/quickReply.ts` (adds `stop` and `help`)
**Produces:** `localIntent(text: string, doc: Doc, focusId: string | null): Intent | null`; `Quick` gains `{ kind: 'stop' }` and `{ kind: 'help' }`; `sectionText(doc, blockId): string`.

| Said (English, Estonian) | Result |
|---|---|
| go to paragraph 6, paragraph 6, mine lõigu 6 juurde, lõik 6 | navigate to block 6 |
| go to budget, go to the budget, show budget, mine eelarve juurde | navigate to the one heading whose every word is matched by prefix |
| next, next paragraph, järgmine | navigate one block down from the focus (from the top when nothing is focused) |
| previous, back, eelmine | one block up |
| top, go to the top, algusesse | first block |
| bottom, go to the end, lõppu | last block |
| read it, read this, read aloud, loe ette | navigate to the focus with `readAloud` |
| read paragraph 4, read 4, loe lõik 4 | navigate with `readAloud` |
| read the summary, loe kokkuvõte | heading match with `readAloud` |
| go to budget and read it, mine eelarve juurde ja loe ette | navigate with `readAloud` |
| delete paragraph 2, remove paragraph 2, kustuta lõik 2 | `propose_edit` with `delete_block` (needs yes) |
| delete this, delete it, kustuta see | the same for the focused block |
| anything else, or two headings that match, or no focus where one is needed | `null` (the model decides) |

Tests: one per row in both languages; a longer sentence that starts like a command is `null`; a number out of range is `not_understood` with the range; next at the last block stays there; heading match is case-insensitive and prefix-based (`kokkuvõtte` finds `Kokkuvõte`); a heading named by one common word of another heading does not match when ambiguous.

### Task 3: Reading and local commands in the state machine
**Files:** `src/core/session.ts`, `session.test.ts`
**Changes:** `Session.reading: boolean`, `Session.help: boolean`; `Effect` adds `{ type: 'speak'; text: string }` and `{ type: 'hush' }`; `Event` adds `{ type: 'speechEnded' }`.

| Mode | Event | Result |
|---|---|---|
| listening | utterance with a local intent | handled at once, no request, no `thinking` |
| confirming, choosing | utterance whose local intent is `navigate` | handled at once, the proposal or question stays |
| any but thinking, asleep | `navigate` with `readAloud` (local or from the model) | focus, `reading` true, effect `speak` with the block's text, or the whole section when the block is a heading |
| reading | quick `stop` | `reading` false, effect `hush` |
| reading | any other handled utterance | effect `hush` first, then handled as usual |
| not reading | quick `stop` | message: nothing is being read |
| any | `speechEnded` | `reading` false |
| listening, confirming, choosing | quick `help` | `help` true; the next handled utterance sets it false |
| any | quick `sleep` | also `hush` when reading |

Tests: each row; the M1 and M2 scenario still passes unchanged; a local delete goes to `confirming` and yes applies it with no effect emitted at any point; reading a heading speaks the section.

### Task 4: Alternatives and instant commands in the assembler
**Files:** `src/speech/assembler.ts`, `assembler.test.ts`, `src/speech/webSpeech.ts`
**Changes:** `createAssembler({ holdMs, onUtterance, isInstant })`; `final(text, alternatives?)`. With nothing held, the first of `[text, ...alternatives]` for which `isInstant` is true is released at once. `webSpeech` asks for three alternatives and passes them.
Tests: existing ones with `isInstant` injected; second alternative wins when it is instant; alternatives are ignored once something is held.

### Task 5: Scripted recogniser
**Files:** `src/speech/scripted.ts`, `scripted.test.ts`
**Produces:** `createScriptedRecognizer(handlers, script, opts): Recognizer` where a script line is `{ text: string; pauseAfterWord?: number }`. It emits interim results word by word, then a final; a line with `pauseAfterWord` is sent as two finals with a silence between, to exercise the assembler exactly as Chrome does.
Tests with fake timers: interims grow word by word; the final arrives; a split line reaches `onUtterance` once, joined; `stop` cancels everything.
Used by `?voice=demo` in the browser: the demo script plays itself, hands off, which is also the backup for the pitch.

### Task 6: Browser adapters
**Files:** `src/speech/synth.ts`, `src/speech/level.ts`, `src/ui/useSession.ts`
- `speak(text, lang, onEnd)` and `hush()` over `speechSynthesis`, choosing a voice for the language when one exists.
- `createLevelMeter(onLevel)`: microphone level from 0 to 1, about fifteen times a second.
- Hands-free start: when the browser already holds microphone permission and the microphone was on last time, it starts by itself. Language and the microphone preference are remembered in `localStorage`.
- `isInstant` for the assembler: a quick reply or a local command on the current document.
Not unit-tested; verified in the browser.

### Task 7: Voice check
**Files:** `src/ui/VoiceCheck.tsx`, `src/speech/checkLines.ts`
A screen that asks the user to read each demo line in English and Estonian, shows what the recogniser wrote, and scores it with word error rate. Totals per language. Results can be copied as text. Works with no server. In scripted mode it can be walked without a person.

### Task 8: Design
**Files:** `src/index.css`, `index.html`, `public/favicon.svg`, `src/ui/*.tsx`, `src/core/candidates.ts` (parts carry `highlight`), spec section 19.
See spec section 19 for tokens, type and layout. One commit, so it can be reverted alone.

### Task 9: Verify and wrap
- `npm run check` green.
- Browser, rehearsal mode, `?voice=demo`: the script plays itself to the end; screenshots of listening, preview, which-one, reading, asleep, and the voice check, in the light theme and one in the dark theme.
- Spec section 17 and README updated. Clean tree.

## Acceptance

| # | Criterion | Proof |
|---|---|---|
| B1 | Navigation, reading and delete-by-number work with the server stopped | Task 2 and 3 tests |
| B2 | Reading aloud never triggers an edit by hearing itself | Task 3 tests |
| B3 | One sentence spoken with a pause arrives as one utterance, end to end in the browser | scripted demo run, screenshot |
| B4 | The demo plays hands-free from page load in scripted mode | browser run |
| B5 | A recognition score per language can be produced without a key | voice check screenshot |
| B6 | The interface no longer reads as generated: one family, no caps labels, no cards, marks from a copy desk | screenshots looked at against spec 19 |
| B7 | Real speech recognition quality | Not provable by the builder. Ralf runs the voice check with a headset. |
