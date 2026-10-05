# Review of round 3 (2026-10-05, night)

The round-3 diff (`5583d3a..HEAD`, six lanes: speech, engine, ptt, edit, nav, soniox, plus the
follow-ups) read end to end against the seven questions of the brief. Nothing in it has met a real
voice, a real eye tracker, the real model or the real Soniox. Findings are ranked by what would
hurt tomorrow morning; each has a file, a failure scenario and a fix. "Fixed" means fixed on
`r3-review` with a test, gate green (`npm run typecheck && npm run lint && npm run test`, 2497 tests).
The browser suite (`extension/test/run.ts`) was not run here.

## High

### H1. The lag line never showed: the engine's threshold was above the server's backlog. Fixed.

`extension/src/engine.ts` `LAG_SHOWN_MS` was 2000 and `extension/src/strip.ts` `LAG_SHOW_MS` 2000,
but `server/asrSession.ts` drops as soon as the queue passes `MAX_BACKLOG_MS` (1500 ms) and reports
the backlog at that moment (`dropOldest`, line 175: `report(backlog)`), which is 1500 to 1700 ms.
Scenario: decoding runs slower than real time for a minute; the server drops a second of his
speech every few seconds, every drop sends `lag ~1600`; the engine's `onLag` sees `1600 > 2000`
false, publishes nothing; the strip never says "Kõne jääb maha". Audio was dropped silently, which
is the one thing the brief asked to rule out. The client's own `bufferedAmount` guard reports from
2100 ms, so only that (rare on localhost) could ever have shown the line.

Fix applied: both thresholds are 1000 ms (engine test `the lag threshold is below the server's 1500
ms backlog`). Also: the server sends `lag 0` only when its queue empties, never after the socket
closes, so a lag shown at the moment he stopped stayed on the strip; `engine.stop()` now publishes
`lag: 0` (test `clears the lag line when listening stops`). Spec 22.2 updated.

### H2. Push-to-talk released: the words were lost when the final came after 300 ms. Fixed.

`extension/src/offscreenMain.ts` `FLUSH_STOP_MS` was 300: `stop` with `flush` called
`engine.flush()` and `engine.stop()` 300 ms later. `src/speech/local.ts` `flush()` sets `flushed`
and waits for the server's final; `stop()` → `teardown()` closes the socket and `assembler.dispose()`
drops what is held. Two ways to lose the utterance:

1. The server first decodes the frames queued before the flush marker (up to 1500 ms of backlog,
   at decode speed), then sends the final. Soniox answers a `finalize` over the network. Either is
   routinely later than 300 ms. The final arrives at a closed socket; `onMessage` ignores it
   (`socket !== ws`). The whole gaze utterance is gone, and its preview in the box is taken back
   by `engine.stop()`.
2. `onPartial` reset `flushed = false` (line 128). The frames queued before the flush produce one
   more partial almost always (the text grows by the last word), so when the final did arrive it
   went into the assembler *with* the 700 ms hold instead of at once, and the stop 300 ms later
   disposed it.

Fix applied: a partial no longer clears `flushed`; `stop()` while a flush is pending delivers the
newest partial (joined with what is held) through the assembler before teardown, and never twice
(the final then meets a closed socket); without a flush a stop still drops the words in progress,
as the existing test demands. `FLUSH_STOP_MS` is 800 so the real final usually wins. Four tests in
`src/speech/local.test.ts` under `flush`. Spec 23.1 updated.

### H3. Gaze mode: the poll could restart the microphone with nobody looking. Fixed.

`extension/src/strip.ts` lines 326 to 330: every second, `if (inside(gazeEl, pointer)) gaze.enter()
else gaze.leave()`. `pointer` is the last `pointermove` seen by the page's document. Scenario: the
bar sits at the bottom edge of the viewport; the eye tracker's pointer leaves the window downward
through the bar (looking at the keyboard, the taskbar, the second screen). `pointerleave` fires,
the grace runs, the stop with flush goes out. No `pointermove` follows, so `pointer` still reads a
point inside the bar; the next poll calls `enter()` → `arming` → `onStart` → listening again, and
it listens until he comes back onto the bar and leaves it once more. Fix applied: the poll only
ever leaves (its purpose is a lost `pointerleave`); entering stays with the real `pointerenter`
and with `bindGaze` for a target that appears under the pointer.

### H4. Sound-alike matching turned plain words into commands. Fixed (two rules), one left.

Script: every ordered pair of 170 common Estonian chat words through `inpageStep` with an armed box
and with no box (203 hits, 104 distinct pairs), then the same pairs through the pre-round-3 rules.
New in round 3:

- `teeb kolm`, `kolm teeb`, `viis teeb` … → `switchTab 3` ("tab kolm"). `phoneticKey('teeb')` is
  `tep`, `'tab'` is `tap`; the three-letter rule of `soundsLike` (`src/core/phonetic.ts` line 81)
  compared *keys*, so a four-letter word collapsed to three letters could differ in its middle
  letter. "teeb" is among the commonest verbs. Fixed: the rule applies to words of at most three
  letters (tests: `teeb`, `tiib`, `toob` are not `tab`). Spec 23.2 updated.
- `ei lõpeta`, `lõpeta ja`, `ma lõpeta`, `lõpeta et` … → scroll stop ("Kerimine seis.", the words
  swallowed). Not the new pass: the pre-existing joined-words rule of 21.3 (`src/core/inpage.ts`
  `misheard`, the `joined` loop) allows two edits from eight letters, so "ei"+"lõpeta" = "eilõpeta"
  ≈ "lõpeta". It only bit now because "lõpeta" became a command. Fixed: the join takes only words of
  three letters or more (what it was for: "vaik semaks"). Six regression cases in
  `src/core/inpage.test.ts`.
- Left: `poes kolm`, `ääres viis` → `clickHint 3` ("press kolm"): `poes`/`äres` are one edit from
  `pres`. Improbable as whole two-word utterances, and the click needs the labels to be showing.
  If it bites, drop the English `press` from the Estonian sound-alike pass, or require the heard
  word and the target to agree in their first two letters for the one-edit rule.
- By design and worth knowing: `mina` sounds like `mine` (listed in `phonetic.test.ts`), so "mina
  youtube" opens YouTube; `natuke alla`, `veidi alla`, `keri aga` are intended. `vali ma` with
  "Mari" in the box selects the "Ma" of "Mari" (`textHas` and `findSpan` fall back to substrings).

## Medium

### M1. "saada" on Google Docs pressed Enter into the title or search input. Fixed.

`extension/src/page.ts`: `readBox` on docs.google.com answers `docsBox()` (an armed composer named
"Google Docs"), so the core's send rule produced `pressSend`, but `pressSend` used
`findMessageBox(site)`, which on Docs finds no composer and falls through to `pick('input')`: the
document title or the menus search box. It read that text, pressed Enter there and said
"Saadetud". Fix applied: `pressSend` on a page where `docsBox()` is non-null fails with "Google
Docs has nothing to send". `clearField` was already safe (`fieldToClear` finds nothing on Docs);
"kustuta kõik" goes through `setText('')` → `docsSetText`, which backspaces what Ütle typed.

### M2. Changing the speech engine while listening left a dead engine behind a live state. Partly fixed.

`extension/src/background.ts` `ensureOffscreen`: the engine is in the offscreen document's URL, so
the next message after the setting changed closes the old document (`closeDocument`) and creates a
new one. The old engine dies without publishing; `stripState.listening` stayed true, the mic icon
filled, while nothing listened. Fix applied: when the document is recreated the state is reset
(`listening: false, thinking: false, lag: 0`). Left: the message that caused the recreation is
delivered to the fresh engine as is; a `toggle` meant to stop the old engine starts the new one, so
he needs one more click. A cleaner shape: the options page sends `utle-listen off` before writing
`speechEngine`, or `toOffscreen('toggle')` becomes `start`/`stop` resolved from the state.

### M3. An utterance waiting its turn never asks the model. Left (spec says so; worth a second thought).

`extension/src/engine.ts` `interrupt` sets `cancelled` on every earlier job, including ones that
have not started; `handle` then computes `shouldAsk = … && !job.cancelled`, and skips `verify` too.
Spec 22.2 states this ("an utterance that was still waiting its turn … gets the rules' step, never
the model"). Scenario: "ava delfi" (goTo, 1 to 3 s while the page loads), then "uus leht" arrives and
queues, then "otsi ilm" arrives while the goTo still runs. "uus leht" is cancelled before it ran:
with an armed box it is typed as dictation and never verified, else it gets "Ütle „kirjuta
siia“…". A model-only command is silently lost whenever anything is said within a page command's
duration. Barge-in's purpose (stop stale model work) is served by aborting the controller and
`looping`; a job that has not started has nothing stale. Proposed change (~4 lines): in
`interrupt`, cancel only jobs with `controller !== null || looping || verifying`; set `interrupted`
on all (no loop for them). The stale rule (`STALE_MS` 3 s) already covers the case the spec worries
about.

### M4. Soniox: no lag path, and an error's message is kept out of the log. Left.

`server/soniox.ts`: audio goes to `upstream.send(pcm)` with no look at the upstream socket's
`bufferedAmount`; when the network stalls, `ws` buffers without limit and the delay grows silently,
the one failure mode round 3 set out to end on the local path. Proposal: extend `SocketLike` with
`bufferedAmount`, drop a frame when it exceeds 2 s of PCM (64 000 bytes) and send `lag` as
`local.ts` does. Separately, a Soniox error logs only its code (`[soniox] error 400`): the test
`a Soniox error response … only the code logged` wants it so because a 401 message can echo the
key. A wrong `SONIOX_MODEL` is then invisible. Proposal: log `error_message` for codes other than
401 and 403.

Verified against what I know of Soniox's real-time API: URL, the config field names, `pcm_s16le`,
binary audio frames, `tokens[].is_final`, `<end>` on endpoint, `{"type":"finalize"}` and `<fin>`,
`{"type":"keepalive"}` within 20 s, the empty text frame as end of stream, `finished`, `error_code`.
The model name `stt-rt-v5` is not verifiable from here; `SONIOX_MODEL` overrides it. The query
reaches the server: `offscreen.html?asr=…&engine=soniox` → `asrAddress` sets `?engine=soniox` on
the ws URL → `wantsSoniox` reads it; the upgrade handler compares the path before the `?`.
`/api/status` `speech.soniox` is the key's presence, as specified.

### M5. Docs: after the 4 s reset the next utterance is glued to the previous one. Left, with a sketch.

`extension/src/page.ts` `docsBox`/`docsSetText`: `docsTyped` resets to `''` after
`DOCS_TYPED_RESET_MS`; the base the core joins onto is then empty, so the next sentence has no
leading space: "Tere.Uus lause." Sketch: keep `docsLast` (the last character typed ever); when
`docsTyped === ''` and `docsLast` is a letter or a mark, and the tail starts with a letter, type a
space first. Also `readPage` on Docs still reports `boxState(findMessageBox(site))` (the title
input) while `readBox` reports "Google Docs": the model and the rules see different boxes.

### M6. "kustuta see" with nothing selected deletes one letter. Left; propose.

`src/core/browserIntent.ts`: `kustuta see` is a Backspace phrase. Without a selection it erases the
last letter, which is almost never what "delete this" means after dictating. Proposal: make
`kustuta see` / `delete this` a core action: with a selection (unknown to the core, so: when the
last step was a `select`), Backspace; otherwise the box undo of the last utterance ("tagasi" when
there are words), which is what he most likely means. Needs a `lastWasSelect` flag in the session
(~15 lines with tests), so left as a proposal.

### M7. A send after a verification acted sees the old base. Left (harmless).

`extension/src/engine.ts` `handle`: with interims, a send's box is `u.base`, read when its first
partial arrived, which can be before a background verification took the words back and ran a
command. The rules then say `pressSend`, the page finds an empty box and answers "The message box
is empty". Nothing wrong is sent. If it shows up as a confusing line, re-read the box for a `send`
job after `settled(pending)`.

## Low

- L1. `src/speech/local.ts` `bufferedAmount` guard: on localhost the kernel takes the bytes at once,
  so it fires only when the server process is wedged; the real bound is the server's queue. Fine.
- L2. `server/asrWorker.ts`: one frame in flight per session (the session awaits each result before
  the next), so nothing piles up in the worker's inbox; results carry `id:seq`, so order holds;
  the worker's death rejects every pending frame → `onError` → close 1011 → the client retries
  three times → Chrome's recogniser. The next connection reloads the model. Node below 22.18 makes
  the Worker emit `error` then `exit` → `load_failed` → the thread path with the same bound.
- L3. `server/asrSession.ts` `step`: `setImmediate` between frames lets the poll phase deliver `ws`
  messages, so a flood of frames reaches `audio()` and `dropOldest` between decodes; no starvation.
  `done` after `closed` schedules nothing. A flush marker survives a drop (owed final). Verified.
- L4. `extension/src/engine.ts` job set: two utterances' page commands cannot interleave. A
  non-send newcomer cancels a verification before `acting` (the window between `askOnce`'s cancel
  check and `acting.add` is microtasks only); once acting, the newcomer waits on `acting`. A send
  waits on `pending`. `thinking` is balanced in `finally` on both paths. A cancelled job's preview
  is taken back through `perform` (no `setText` → `takeBack`). The stale rule cannot starve: a
  newcomer aborts the in-flight question, so the queue moves within a page command's time.
- L5. Gaze: a flush with nothing spoken sends no utterance (the server skips an empty final; the
  client's `releaseNow` has nothing held). The pill is the gaze target while hidden, and in gaze
  mode the pill's 2 s dwell is off, so the bar comes back only by voice ("näita riba"); documented
  in the code, worth a line in the README. Settings changed while listening: `bindGaze` disposes
  the old gaze (stop with flush) when the target changes. In `bar` mode, resting on the Hide or
  Settings control for 1 s still fires it (hiding re-targets to the pill and stops cleanly).
- L6. Editing (`extension/src/page.ts`): `modelOf` handles nested inline elements, `<br>` as `\n`,
  block boundaries, and trims trailing breaks; `domPosition` prefers the end of the earlier text
  node at a boundary, which is fine for typing. Backspace on Lexical: `execCommand('delete')` raises
  a native `beforeinput` that Lexical handles; the 20 ms re-read then the synthetic `beforeinput`
  fallback could delete twice on a tab so slow that Lexical's update lands after 20 ms; acceptable.
  `focusNext` arms a text field reached by Tab, as a real Tab does. Enter on Docs is a new paragraph.
- L7. Security: `utle-listen` and every other new message is behind `sender.id === chrome.runtime.id`
  in `background.ts` line 529; `utle-tabs`/`utle-run` reject senders with a tab. The options page
  writes only the extension's own `chrome.storage.local`, read back through `settingsFrom` which
  accepts only known values. No new log line carries text or audio: `asr.ts` logs counts and codes,
  `soniox.ts` codes only, the worker nothing, the engine and offscreen document nothing.

## What was changed on r3-review

- `extension/src/engine.ts`, `extension/src/strip.ts`: lag threshold 1000 ms; stop clears the lag.
- `src/speech/local.ts`: `flushed` survives partials; a stop with a flush pending delivers the words.
- `extension/src/offscreenMain.ts`: `FLUSH_STOP_MS` 800.
- `extension/src/strip.ts`: the gaze poll only leaves.
- `src/core/phonetic.ts`: the three-letter rule is for three-letter words.
- `src/core/inpage.ts`: the joined-words rule joins words of three letters or more.
- `extension/src/page.ts`: `pressSend` refuses on Google Docs.
- `extension/src/background.ts`: state reset when the offscreen document is recreated.
- Tests in `engine.test.ts`, `local.test.ts`, `phonetic.test.ts`, `inpage.test.ts`; spec 22.2, 23.1, 23.2.

What a person must still check: a real release of the gaze with the local model and with Soniox
(does the final beat 800 ms, and does the "as last heard" fallback read right), the lag line under
a deliberately slowed decode, and the Docs typing path.
