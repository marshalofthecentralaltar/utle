# Review of round 5 (2026-10-06, afternoon)

The round-5 diff (`37f7a85..HEAD`: the contract commit and three lanes, fields, brain and zoom)
read end to end against the seven questions of the brief, with the owner's test with the real user
in mind: numbers typed as words into ID and phone fields, hurrying on long prompts, getting stuck
for minutes, text fields being a hassle during a Smart-ID login. Findings are ranked by what would
hurt in that test; each has a file, a failure scenario and a fix. "Fixed" means fixed on `r5-review`
with a test; the gate is green (`npm run typecheck && npm run lint && npm run test`, 2950 tests).
The browser suite (`extension/test/run.ts`) was not run here.

Method for question 1: a throwaway vitest ran `typedFromSpoken` over 160 ordinary Estonian and
English chat sentences (as `text`) and 52 field values (as `code`, `tel`, `email`, `number`,
`password`); 36 of the sentences changed, and each change was read. The keepers are now cases in
`src/core/spelling.test.ts` ("review of round 5").

## High

### H1. An ID code was a careful ask of the model, and a PIN went to the model. Fixed.

`src/core/inpage.ts` `inpageStep` set `ask: true` on every plain dictation, and the engine's
single-field path (`extension/src/engine.ts` `handle`, "wait-first") asked before typing. Trace of
the Smart-ID login: he looks at the ID field (a trusted click arms it), says "kolm üheksa null kaks
üks kaks neli üks kaks kolm viis": eleven words, so `careOf` says **careful**: effort high, up to 14 s
of "Mõtlen pikemalt…" before a single digit appears, for the one utterance that can never be a
command. If the model answered `command switchTab {query}` (digits read as a tab) the tab switch
ran; `clickHint` is refused by `pageIntentFrom` without labels, which gave `unclear` and nothing
typed (H3). Then the PIN field: `type=password`, four digit words, a quick ask, and the words of the
PIN travelled to the model in `utterance` (the box text was masked, the words were not).

Fix applied (`directValue` in `inpage.ts`, `spokenValueOnly` in `src/core/spelling.ts`): in an
armed single field, anything into a `password` field, and an utterance that is nothing but a value
(number words, digits and symbol words, at least one number) into a `code`, `tel` or `number` field
(or any single field while "numbritena" is on), is typed by the rules at once with no ask; the line
reads it back ("Kirjutasin: 39021241235 (ütle „edasi“ või „valmis“)"). Words with the digits ("kood
on kolm üheksa") and e-mail addresses are still asked, quickly (an address is under eight words).
Tests: `inpage.test.ts` "review of round 5" (three), `spelling.test.ts` (`spokenValueOnly`); the
fields lane's two tests that asserted `ask: true` on value fields now assert the new contract. Spec
25.2 and HANDOFF 4 say so.

With this the rest of the trace holds: "valmis" → `FORM_KEYS` Tab → `focusNext` focuses and **arms**
the next field (`page.ts` line 1435, round 3's arming); the PIN digits are typed at once, read back
as dots; "kinnita" → Enter → `dispatchKey` and `implicitSubmit` through the form's own button.

### H2. "katkesta" after a half-said sentence was typed into the box. Fixed.

`src/speech/assembler.ts` `final`: when words are held (the last final ended with a connective,
"tulen homme ja", 2.5 s hold), a new final is pushed onto the held words whatever it is, and the
instant check (`isInstant`) runs only while nothing is held; `local.ts` `onPartial` skips the
quick-reply release too while the assembler is not idle. So "tulen homme ja … katkesta" was
delivered as one utterance, "tulen homme ja katkesta", which the rules took as dictation and typed,
then asked the model. The cancel was not instant; it was not a cancel at all. Fix applied in the
core (`isCancelAll`): an utterance that ends in a cancel phrase after a connective is the cancel;
the held words are dropped with everything else. It arrives at the end of the hold (2.5 s), not at
once; a fix in the assembler would need the cancel predicate threaded through `createLocalRecognizer`
and the engine's `recognizer` dependency, left for the brain lane's author if 2.5 s is too long.
Test: `"katkesta" after held words is still the cancel`.

### H3. An `unclear` verdict in a field he armed lost his words. Fixed.

`engine.ts` `handle`, wait-first: `follow` → `applyIntent(unclear)` shows "Ei saanud aru" and types
nothing, which is right for a box the page focused by itself but wrong for a field he armed with a
look: a name ("Mari Maasikas") the model cannot place is still what he wants in the field. Fix
applied: an `unclear` with no plan for an armed single field runs the rules' typing (undo works);
an unarmed field still gets nothing. Two tests under "round 5, BRAIN lane".

### H4. A careful answer could be cut off by its own thinking. Fixed (800 → 2000).

`server/intent.ts` `MAX_TOKENS_CAREFUL` 800 with `effort: 'high'` on Sonnet 5.5: thinking is on
(adaptive) and its tokens count against `max_tokens`; at high effort a chain plan can spend more than
a few hundred tokens before the tool call. A `stop_reason: 'max_tokens'` reply is `answerFrom` →
null → `unclear` (verified: no crash, `server/intent.test.ts` line 217), so the whole careful ask was
wasted exactly on the long utterances it exists for. Raised to 2000; the 12 s timeout still bounds
the wait; quick stays at 400 and effort low. Test and spec constants updated. The cache: the request
is tools → system block 1 (`cache_control`) → block 2 (careful only) → messages; block 1 is the same
string on both paths (`INTENT_SYSTEM_PROMPT`, tested byte-equal in `intent.test.ts` line 305), so
the cached prefix hits on quick and careful alike.

## Medium

### M1. Counting with commas became one number. Fixed.

`spelling.ts` `asText`: a run of three or more number tokens becomes digits, and the recogniser's
commas on tokens were stripped by `key`, so "Kell viis, kuus, seitse." → "Kell 567.", "Ma lähen kell
üks, kaks, kolm." → "kell 123.", "Oota üks, kaks, kolm sekundit" → "Oota 123 sekundit". Fix applied:
a mark on a token ends the run, so a comma list stays words; "viis üks kaks kolm neli viis kuus
seitse, palun" still becomes 51234567 (the comma is on the last token). What stays and is accepted:
"Kolm neli viis sõpra tulevad" → "345 sõpra" (three bare number words in a row in chat are a number
far more often than a list), "kell kolm null null" → "kell 300", "sada null" → "1000" (the parser's
quirk for a zero after a hundred; nobody says it). "kell viis või kuus või seitse", "üks või kaks",
"to/for/one more thing" are untouched (the English homophones are not number words; "one" needs two
more).

### M2. A spoken "punkt" at the end of a code. Fixed.

`typedFromSpoken('kolm üheksa null kaks punkt', 'code')` was "3902."; the sentence's full stop is
never part of a code. A trailing dot is dropped for `code` only (a password may end in one).

### M3. "numbritena" on a PIN field showed the PIN. Fixed.

`inpage.ts` `act` `dictate`: `readBack(text, kind)` with `kind = action.spell ?? session.spell ??
box.fieldKind`, so with "numbritena" on (`spell: 'code'`) the line for a password field read back
the digits. Now dots whenever the field is a password. Test in "review of round 5".

### M4. A house number in an address field stays words. Proposal.

A single `text` field (Aadress, Tänav) uses the chat rule: three number words or more. "Tartu
maantee viis kuus" stays as words; "korter kaksteist" too. The owner's complaint ("numbers typed as
words") will recur on address and apartment fields. Proposal: for `box.single === true` with
`fieldKind 'text'`, a run of **two** number words, or one number word at the end of the utterance,
becomes digits (`joinField` could pass a lower threshold to `asText`). Not applied: a search box is
single text too ("otsi kolm põrsakest"), and the threshold wants a day of real forms.

### M5. Gmail's To field is `text`, so "ät" stays a word. Proposal.

`extension/src/box.ts` `fieldKindOf`: Gmail's recipient input has no `type=email`, name `to`,
aria-label "To recipients" / "Saajad": no clue matches, so an address dictated there is not
converted. Add `recipient|saaja|adressaat|kellele` to `EMAIL_CLUE` (not `\bto\b`, which matches too
much). Four words; unverified against the real Gmail DOM, which is why it is a proposal.

### M6. A search bar is `single`, so it waits for the model. Decided: keep.

`boxState` marks every `HTMLInputElement` single, a search input included (`fieldKind 'text'`). An
armed search bar (he said "kirjuta siia" on it, or looked and clicked) is therefore wait-first: the
words appear only after the model answers (one quick ask, 1 to 3 s), and never as a live preview.
Kept, because: a search bar is rarely armed (the usual path is "otsi X" → `siteSearch`, no
dictation); the model's `siteSearch` answer on a search bar is as good as typing; and `single` is
what makes "kinnita" / "valmis" (Enter, Tab) work there. If the wait annoys, the alternative is one
line: `single: kind !== 'search'` in `boxState`, which brings back the live preview and type-first
for search bars and loses the two form words there. Name `q` is not misread as a code (no clue
matches `q`); `\bcode\b` does not match "postcode"; `isikukood` is explicit; "Card number" and
"Order number" are `number` (digits only); "Flight number" (`LH123`) would lose its letters, rare.
WhatsApp's and Messenger's composers are contenteditable, never single.

### M7. The watchdog is per goal, not per step. Proposal.

`JOB_WATCHDOG_MS` 25 s is restarted at every goal of a chain (`follow`), not after each step of a
goal's loop (`runGoal`). A goal of three steps whose page answers slowly (a `goTo` waits up to
`LOAD_TIMEOUT_MS` 8 s in `background.ts`, a careful ask up to 14 s) can pass 25 s while still
moving; the watchdog then gives it up between steps: the command in hand finishes (the page is not
left mid-action; `runSafe` is not aborted), the late line is not shown, and "Võttis liiga kaua,
katkestasin." replaces it. Proposal: `watch(job)` after every `perform` in `runGoal` too, so the
watchdog means "25 s without progress"; `INTENT_LOOP_BUDGET_MS` (15 s) and `MAX_CHAIN_MS` (90 s)
still bound the whole. One line; not applied because the spec says per goal and the brain lane's
17 tests assume it.

### M8. `COMMAND_TIMEOUT_MS` and a slow `goTo`. No fault.

`background.ts` `andWaitForLoad` gives a navigation at most 8 s (`LOAD_TIMEOUT_MS`) and answers
ok either way, so a 25 s page never meets the engine's 20 s; `timed_out` is reached only when the
page script never answers at all, which is what it is for. `busyTimer` is cleared on every exit:
`endWork` in the `finally` of `handle` and `verify`, `tookTooLong` and `cancelAll` through `busyCheck`
after `started = null` (verified by reading; the brain lane's tests cover the first three).

### M9. No spec section for the fields and zoom lanes. Proposal.

`docs/ARCHITECTURE.md` 25 has only 25.2 (brain). The field kinds and their clues, `single`, the
conversions and their rules (three number words in chat, letters by name, the domain after a dot),
`FORM_KEYS`, "numbritena", `implicitSubmit`, and zoom's steps and per-origin persistence are in code
comments and the README only. Same shape as M9 of round 4; needs 25.1 and 25.3.

### M10. Letter names before the dot of an address. Known, accepted.

In an `email` field a word that is an Estonian letter name becomes the letter unless it follows a
dot: "info ät tee punkt ee" → `info@t.ee`, "uus ät kuu punkt ee" → `uus@q.ee`. The domain ending is
protected ("teet ät mail punkt ee" → `teet@mail.ee`, "ott punkt oo ät mail punkt ee" →
`ott.oo@mail.ee`); a host named "tee" or "kuu" is rare enough. "koma" inside an address stays the word
`koma` (harmless, never a comma).

## Low

- L1. Zoom (`background.ts` line 371): `chrome.tabs.getZoom`/`setZoom` throw on a `chrome://` tab;
  the throw reaches `utle-run`'s rejection handler and comes back as `failed` with the message, so the
  bar says the command did not work, nothing hangs. Chrome's zoom is per origin by default, so
  "suurenda" on one YouTube tab grows every YouTube tab and "tavaline suurus" resets them all; that
  is Chrome's own behaviour and what a person expects from the keyboard shortcut. The strip is in the
  page and grows with it: at 300 % it takes a large part of the view, which is also what he asked for.
- L2. `careOf` counts words, so a seven-word e-mail address is quick and an eleven-digit code would
  have been careful; moot for value fields after H1. An address with a name of eight words or more
  would be careful; rare.
- L3. The `heard` line on the strip shows the spoken PIN words while he says them; it is local to the
  browser and goes with the next utterance. With H1 the words never leave the browser; the box text
  of a password field is dots in the model's message (`intentUserMessage`, tested), `typedInto`
  reads dots, the server's log lines carry kind, done, plan, care and ms only, and the eval has no
  password case.
- L4. "Üks kaks kolm, kas kuulete?" still becomes "123, kas kuulete?" (three bare number words then a
  comma): accepted, see M1.
- L5. `FORM_KEYS` "edasi" means Tab only in an armed single field; everywhere else it stays history
  forward. "kinnita" in an armed search bar is Enter, which is the search. After the Tab the line is
  the generic `browserDone` for a key press, not the new field's label; a small nicety for the fields
  lane (`inpageResult` could say `label` of `result.box`).
- L6. `hasConnective` makes "ja" anywhere careful, so "jah ja ei" is careful; harmless, two seconds.

## What was changed on r5-review

- `src/core/spelling.ts`: a marked token ends a number run in text (M1); `code` drops a trailing dot
  (M2); `spokenValueOnly` (H1).
- `src/core/inpage.ts`: `directValue`, no ask for a password field or a value of digits in a code,
  phone or number field (H1); `isCancelAll` accepts the cancel after a connective (H2); dots for a
  password whatever the spelling mode (M3).
- `extension/src/engine.ts`: an `unclear` in an armed single field runs the rules' typing (H3).
- `server/intent.ts`: `MAX_TOKENS_CAREFUL` 2000 (H4).
- Tests: `spelling.test.ts` (4 blocks), `inpage.test.ts` (3 new, 2 of the lane's adjusted),
  `engine.test.ts` (2), `intent.test.ts` (constants). Spec 25.2 and HANDOFF 4 updated.

What a person must still check: that the recogniser hears "katkesta" as one word; the latency of a
careful ask at 2000 tokens on the real model; whether real bank and Smart-ID pages mark their ID
field so that `fieldKindOf` says `code` (type `text` with name `personalCode`/`idCode`, placeholder
"Isikukood" all match; a bare "ID" does not); and the real Gmail To field (M5).
