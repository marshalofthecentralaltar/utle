# Review of round 4 (2026-10-06, morning)

The round-4 diff (`8847d77..HEAD`: the contract commits and three lanes, chain, page and voice)
read end to end against the six questions of the brief. None of it has met a real voice, a real
page or the speaker model; the owner tests today with the real user. Findings are ranked by what
would hurt in that test; each has a file, a failure scenario and a fix. "Fixed" means fixed on
`r4-review` with a test; the gate is green (`npm run typecheck && npm run lint && npm run test`,
2604 tests). The browser suite (`extension/test/run.ts`) was not run here.

## High

### H1. A stranger's words stayed in his WhatsApp box until he next spoke. Fixed.

`src/speech/local.ts` line 197 (`onForeignFinal`) drops the final and calls `onForeign`, but the
partials of that utterance had already been typed as a live preview by the engine (`Live.inBox`).
The lane documented it ("the preview goes when he next speaks"). Scenario: only-owner on, someone
behind him says "pane telekas kinni", it appears in his armed WhatsApp box, he says nothing more
(or looks away in gaze mode: that path did take it back through `engine.stop`); the words sit there,
and his next "saada" sends them: `handle` reads the box as `u.base` only for an utterance with
partials, and a fresh "saada" with no live preview goes through `pressSend`, which sends whatever
the box holds. Fix applied: the engine owns `onForeign` (`extension/src/engine.ts` line 757): the
live utterance ends and its preview is taken back exactly as on `stop()`; `offscreenMain.ts` calls
the engine's handler before showing the line (it had overridden it through the spread). Test:
`a foreign final takes back the preview its partials typed`. Spec 24.2, HANDOFF and the README say
so now.

### H2. During "Õpeta mu hääl" everything he said was typed and run. Fixed.

`server/asrSession.ts` line 91 (`feedEnrolment`) collects frames while the decoder goes on decoding
them, and the old `offscreenMain.ts` `enrol` case only sent the frame and a line. Scenario: he
presses the button on the settings page, the bar says "Räägi 8 sekundit…", he says "tere, mina olen
siin ja räägin nüüd natuke, ava youtube ja…": every final is an utterance; with no box on the
options page each is asked of the model ("Mõtlen…" replaces the enrolment line at once) and "ava
youtube" navigates the options tab away mid-enrolment. Fix applied: `Engine.enrol(seconds)`
(`engine.ts` line 825) starts listening if needed, drops the live preview and ignores utterances,
continuations and partials until `onEnrolled`, a microphone error, an unreachable model, `stop()`,
or `ENROL_TIMEOUT_FACTOR` (5) × seconds with no answer (the server gives up after 4 × seconds, and a
closed socket answers nothing). Two tests under `review of round 4`.

### H3. A failed judgement closed the connection and lost the final. Fixed.

`server/asrSession.ts` line 283 (`sendFinal`): a throw from `decoder.judge`, or a rejected
`judged` promise (the worker's `failed` reply, or the worker exiting), went to `failed(error)` →
`onError` → close 1011; the client retries and the utterance is gone. With the real model the
likeliest throw is sherpa's extractor on an odd clip (`speakerModel.ts` rethrows "too little audio"
only inside `judge`'s own try, but the worker message path has its own rejection). Fix applied: a
judge that fails loses the verdict, not the words: the final goes without a speaker, and the session
goes on. Test rewritten: `sends the final without a speaker when the judge fails`.

### H4. A profile from another model version made the owner a stranger. Fixed.

`server/speaker.ts`: `readProfile` kept `model` but `judge` never compared it, and `cosine` answered
0 for vectors of different lengths. Scenario: `owner.json` written with one model, `npm run model`
later fetches a different file (or the name in `SPEAKER_MODEL_FILE` changes): every cosine is of
unrelated embeddings, or 0 outright, which is at or below `OTHER_THRESHOLD` (0.35), so with
only-owner on every one of his utterances is dropped and the bar says someone else spoke. Fix
applied: a profile whose `model` is not this gate's is judged by loudness only (`comparable`, line
178); vectors that cannot be compared score NaN → `unknown`. Test: `never calls the owner a stranger
over a profile from another model or of another size`. The round-trip test now reloads with the
same model name, which is what it meant.

## Medium

### M1. A plan that repeats the goal re-asked the same thing up to 16 times. Fixed.

`extension/src/engine.ts` `planChain` (line 468): with no chain, `remaining = heard.plan` whatever
it held; in a chain, `fresh` was filtered only against `remaining`, never against `completed`, the
goal in hand or the original. `firstGoal` falls back to the model's `say` or the whole utterance,
so a plan of `["mine youtube'i"]` for "mine youtube'i" made a chain whose next goal is the
utterance again; the model, told `chain goal: "mine youtube'i"` on a page that is already YouTube,
may answer `goTo` again with the same plan (`fresh` would re-add it once `remaining` had shifted),
and so on until `MAX_CHAIN_STEPS` (16) or `MAX_CHAIN_MS` (90 s): sixteen page loads, or a scroll
loop. Fix applied: goals equal (case and punctuation aside) to the goal in hand, the utterance, the
original, a completed goal or an earlier plan entry are not goals; a plan with nothing left starts no
chain. Two tests.

### M2. Chain requests could exceed the schema and silently never reach the model. Fixed.

`src/core/pageIntent.ts` line 196: `completed` is at most 12 entries of 200 characters, `utterance`
500. The engine built `completed` from `lastDone`, which for a rules-only utterance was
`[job.utterance]` unclipped, and a chain's `completed` grew by one per goal without a cap (a plan may
add goals mid-chain). A 400 answers `{ error: 'bad' }` → `askOnce` null → the rules' step stands.
Scenario: he dictates a long sentence, then "siis saada" within 2.5 s: the continued goal's request
carries a 300-character `completed[0]`, the server answers 400, and "siis saada" is typed into the
box as dictation (the rules do not know "siis saada"), verified by a request that is 400 again, so
it stays. Fix applied: `clipGoals` on every `completed`/`lastDone`, `utterance` clipped to 500,
`original` to 1000. Test: `a continued utterance after a long one carries goals clipped…`.

### M3. A plain "saada" after a chain judged the box as it was before the chain. Fixed.

Round 3's M7 ("harmless"), made real by chains: `handle` took a send's box from `u.base`, read when
its first partial arrived, which for a chain running in `verify` (type-first, armed box) is before
the chain opened the conversation or typed the message. Scenario: "ava Karin ja kirjuta et tulen
homme" typed first into the current box and verified; the verification finds a command and runs the
chain; "saada" partials arrive meanwhile, the base reads `present: false` (the chat list); the send
waits for the chain as it should, then the rules say `pickField` and nothing is sent. Fix applied: a
plain send reads the box after what it waited for (`engine.ts` line 639; a send types no preview, and
a preview its early partials typed is taken back before the read). Test: `a plain send reads the box
after what it waited for`.

### M4. The chain line could stay on the strip after a thrown step. Fixed.

`follow` published `chain: ''` only on its normal exit. A throw inside (`applyIntent` on a bad
session, a `publish` that throws) left "2/3 · …" on the bar. Fixed with a `finally` (line 567).

### M5. Judging a 20 s clip holds the decoder. Fixed (8 s).

`server/asrSession.ts` `MAX_KEPT_MS` was 20 000: the embedding runs on the decode thread (the
worker, or the server thread), so a 20 s clip costs a few times a 3 s one (CAM++ is a few hundred
MFLOPs per second of audio; on one thread perhaps 0.5 to 1 s for 20 s, unmeasured) during which no
frame is decoded; the session's backlog passes 1.5 s and drops the start of his next utterance. An
embedding of the newest 8 s tells the voice as well. Changed to 8 000; spec 24.2 updated. Still
unmeasured on the real model: if `[asr]` lag lines appear right after long utterances, lower it.

### M6. The energy gate without the model: the safest default. Proposal.

`server/speaker.ts` line 47: without the model, an utterance below 40 % of the enrolment RMS is
`other` and dropped. It cannot tell voices; the HANDOFF already says a quiet owner fails it. Today's
risk: `npm run model`'s second step fails (GitHub release download) or is not rerun, he turns on
"Kuula ainult mind" anyway, speaks softly or leans back, and his words vanish with "Keegi teine
rääkis". The feature he asked for (background conversations) is not served by loudness either: the
stranger is usually as loud. Safest default: without the model, `judge` answers `unknown` always
(nothing is ever dropped), the voice note and the log say the mode is waiting for the model, and the
energy gate stays available behind an explicit constant (`ENERGY_GATE = false`) for a session that
measures it. Not changed here because it removes the lane's only no-model behaviour; one line in
`judge` plus the two strings.

### M7. Long dictation now costs a model call every time, and a wrong verdict erases it. Proposal.

`LONG_UTTERANCE_WORDS` 14 → 60 (`engine.ts` line 95) so a long chain is still asked. Consequences:
every dictated sentence under 60 words is verified (one `/api/intent` call with the page, ~1 to 3 s
of "thinking" dots, a few cents an hour of chat); and the revert path stands for a 40-word sentence:
when the model answers a command, the sentence is taken out of the box and the command runs. The
prompt's "a sentence with a first-person verb is text" is the only guard. Proposal: in `verify`, a
verdict of one plain `command` with `done` true and no `plan`, for an utterance of 14 words or more,
leaves the words (a 14-word single command is implausible; chains, the reason for 60, carry a plan or
`done: false`). Four lines and a test; not applied because it changes the type-first contract of
22.2 and the owner should decide after a day of chains.

### M8. The continuation window is measured at the final, not at the first word. Proposal.

`src/speech/assembler.ts` line 90: a final continues the last delivery when it *arrives* within
`CONTINUE_WINDOW_MS` (2.5 s) of it. "siis ava Karini viimane sõnum ja kustuta see kõigi jaoks" takes
four seconds to say, so its final is always too late: it becomes an utterance of its own (still
asked of the model, but without `completed`, and "siis" leads). Fix: stamp the first `activity()`
after a delivery and compare that. Also, a quick reply released from a partial
(`local.ts` line 130 `releaseInstant`) bypasses the assembler's `last`, so "keri alla" settled early
then "siis ava esimene" is never a continuation while "keri alla" delivered by a final is. Small;
left for the chain lane's author.

### M9. No spec section for the chain and page lanes. Proposal.

`docs/ARCHITECTURE.md` has 24 with only 24.2 (voice). The chain (connective hold, continuation,
`plan`, the chain line, the limits 12/16/90 s) and the page lane (text items, hover, contextMenu,
scrollTo, the WhatsApp message selectors) are described in `extension/README.md` and the code
comments only; CLAUDE.md says sections 21 onward are the spec. Needs 24.1 and 24.3.

### M10. Toggling "Kuula ainult mind" while listening ends listening silently. Known, left.

`extension/src/background.ts` line 480: the mode is in the offscreen document's address, so the next
message to it (a gaze `flush`, a toggle) recreates the document; round 3's M2 resets the state so
the icon is right, but a gaze release at that moment loses its words. The note on the settings page
says the choice takes effect at the next start; it does not say listening stops. Same shape as M2 of
round 3; the same cleaner fix applies (the options page sends `utle-listen off` first).

## Low

- L1. `extension/src/page.ts` `activate` (line 724) now hovers first. On the YouTube stand-in the
  card's menu button appears on `mouseover` and the click still goes to the title link (`el.click()`
  is on the element, not a hit test); the menu sits at the card's right. On real YouTube a hover also
  starts the inline preview after a second; the click lands before that. No swallowing found. What
  stays: `hovered` is never left after a click, so a tooltip or a preview may linger until the next
  click or hover elsewhere.
- L2. `isMessagePart` (line 481) runs `closest` and `querySelector` with the three-way `messageRows`
  union for every actionable `row`/`other` element: on a chat of a few hundred rows this is some
  thousands of selector matches per `readPage`, well under the 300 ms settle. A scrollable pane with
  `tabindex` that wraps the messages matches `querySelector` and drops out of the list, which is
  harmless.
- L3. `collectText` (line 513): the 40 cap keeps the top-most items outside a chat, so on a long
  YouTube page the "40" are the first headings and paragraphs in view; YouTube's comments are custom
  elements, not `p`/`li`, so they are not text items at all. Fine for the demo path; if comments
  matter, add `#content-text` to `TEXTUAL` per site.
- L4. `contextMenu` (line 958): a synthetic `contextmenu` never opens the browser's own menu; on a
  page with no handler it answers ok and nothing shows; the model is told to look again, sees no
  menu, and must not repeat it (prompt: never the identical action). One wasted step.
- L5. WhatsApp fallback: when none of the `messageRows` guesses match, the chat has no text items and
  the message text (`span.selectable-text`, not `p`/`li`) is not listed by `TEXTUAL` either, so
  "Karini viimane sõnum" gets `unclear`. A safe fallback: when a site has `messageRows` and nothing
  matches, list the visible leaf blocks of `main` with 12 to 160 characters as text items (no
  `[sõnum]` prefix). Left for the page lane; the README names the four lines to fix at the demo.
- L6. Prompt and schema (`server/intentPrompt.ts`): `plan` is required in the tool (line 169),
  `hover`/`contextMenu`/`scrollTo` are in `COMMAND` with "answer done:false" in their descriptions
  (lines 109 to 111) and in the prose (line 25), the chain lines are in the user turn (lines 198 to
  209), the eval's `actionOf` gives `command hover 7` as the engine's `kindSummary` does, and
  `pageIntentFrom` checks the ids of all three. Verified.
- L7. Connective hold: "tulen homme ja" waits 2.5 s instead of 150 ms before it is typed. The partials
  already show the words live, so the wait is only before the final is fixed in the box; acceptable.
  "ja" is a rare last word of a finished Estonian sentence. A final beginning with "siis" within the
  window continues the previous delivery whatever it was: for a command that already ran ("keri
  alla" then "siis ava esimene") the engine handles `added` only, so the command is not rerun; the
  goal carries the leading "siis" into the model's `utterance`, harmless.
- L8. `extension/src/strip.ts` makes the chain element inside `render` on every call
  (`querySelector('.chain')`); it works and costs nothing visible. `messages.ts` says `foreign` is
  "cleared on the next owner utterance"; it is a 3 s timer in `offscreenMain.ts`.
- L9. Security and logs: `utle-enrol` is behind `sender.id === chrome.runtime.id`; the enrolment
  frame is bounded (1 to 30 s) on the server; `owner.json` holds an embedding and an RMS; no log line
  carries text, audio or a verdict (the close line counts foreign finals). The eval's new cases send
  nothing new to the log.

## What was changed on r4-review

- `extension/src/engine.ts`: `onForeign` takes back the live preview; `enrol` with the enrolling
  guard and its timeout; `planChain` drops repeated and known goals; `clipGoals` on every
  `completed`; `utterance` clipped; a send re-reads the box; `follow` clears the chain line in
  `finally`.
- `extension/src/offscreenMain.ts`: the engine's `onForeign`/`onEnrolled` run before the strip lines;
  `enrol` goes through the engine.
- `server/asrSession.ts`: a failed judge sends the final without a speaker; `MAX_KEPT_MS` 8 s.
- `server/speaker.ts`: a profile from another model is judged by loudness; incomparable vectors score
  NaN → unknown.
- Tests in `engine.test.ts` (7), `asrSession.test.ts` (rewritten 1), `speaker.test.ts` (1 new, 1
  corrected); spec 24.2, HANDOFF 1c and the README's voice section updated.

What a person must still check: the thresholds on his voice (HANDOFF section 2, step 5); whether
the real WhatsApp DOM matches the four guessed selectors; whether a hover shows the arrow on the
real page; the time a judgement takes (watch for lag lines after long utterances).
