# Ütle: handoff

Written 2026-10-06 about 02:00 (Tallinn), after milestones M7, M7.2 and round 3, for a fresh session with no context.
Read this, then `docs/PRODUCT.md`, then `docs/ARCHITECTURE.md` section 21 onward (22 is M7).
The plan for M7 is `docs/plans/2026-10-05-m7-understanding.md`.

Everything stated as fact here was observed in the session that wrote it. What was not is marked.

## 1. What exists and works

Ütle is a Chrome extension. A bar at the bottom of every page listens; Estonian speech is typed
into the site's own message box, repaired and sent by voice, and the same voice moves the browser.

M7 (this evening) changed two things Ralf named as the brief after a day of real use:

1. **It understands what he means, not only fixed phrases.** Rules still come first (instant,
   offline). What the rules do not recognise goes to Claude on the dev server (`POST /api/intent`)
   with what is on the page: address, title, the message box, the visible clickable things with their
   text, the video state, the open tabs. Claude answers one intent from a fixed set, validated in
   `src/core/pageIntent.ts` before anything runs. So "uus leht", "mine vaata hiljem", "vajuta Mari",
   "pane vaiksemaks", "kirjuta kommentaar" work without being in any list.
2. **Nothing is typed where he did not ask.** Dictation goes only to an *armed* box: the site's
   own composer (WhatsApp, Messenger, or a field with a send button beside it), a conversation he
   opened, or a field he picked by voice ("kirjuta siia", "näita numbreid" and a number). A page's
   own search bar never receives dictation; the bar says where the words can go instead.

M7.2 (later the same evening), after Ralf said it must work for everything and not for scripted paths:

- **Type first, verify after.** Dictation into an armed box is typed at once; the model checks
  afterwards whether the words were a command and, if so, takes them back and runs it. No waiting
  before words appear, and a "saada" said right after waits for the check (`docs/ARCHITECTURE.md` 22.2).
- **Compound requests.** "Mine youtube'i ja otsi kassivideod ja mängi esimene" runs as a bounded
  loop: act, look at the page again, act again, at most 4 steps, 25 s, two failures.
- **What the model sees is accessibility-tree quality** (`extension/src/page.ts` `readPage`):
  proper accessible names, one item per video card, dialogs and cookie banners first, items just
  below the fold, the page's heading and the open chat's name; clicks fall back to Enter, Space and
  navigation when a synthetic click is ignored; scrolling picks the right pane and reports when
  nothing moved; the hit test looks through the strip so a site's fixed bottom bar (Gmail's compose)
  is listed.
- **A real click arms.** A field he clicks with the eye tracker (a trusted click or Tab) becomes the
  dictation target; a field the page focused by script never does. WhatsApp's own chat search gives
  way to the composer of the open chat.
- The adversarial review's fixes (`docs/REVIEW-M7.md`): "tagasi" after "kustuta kõik" brings the
  words back instead of leaving the page; one-word commands that are ordinary words (välja, sulge,
  enter, paus…) are dictation while the box holds words; requests are clipped to the schema so a
  long line can never turn every model call into a 400; the queue survives a thrown step; fetches
  time out; the fixed prompt is marked for caching.

Also new in M7: "tagasi" undoes typing when there is text, else goes back; "sulge", "tühjenda otsing",
"peida riba" / "näita riba", "otsi kassivideod" searches the site in front (Google when it has no
search), video control ("paus", "vaiksemaks", "täisekraan"), Escape and Enter, numbers to 39. The
bar is restyled, can be hidden to a pill, and the options page is usable by voice and by dwell
(bar height, microphone side, hidden at start).

- Branch `claude/utla-voice-command-access-4ftxk4` on GitHub, gate green (`npm run check`: 2495
  tests), browser suite green (`xvfb-run -a npx tsx extension/test/run.ts`: every command kind,
  Messenger stand-in skipped where there is no IPv6).
- Speech: TalTech's model in the dev server (`ws://localhost:5173/api/asr`), unchanged.
- The default model for `/api/intent` is `claude-opus-5-5` at low effort; `UTLE_MODEL` overrides it
  (`claude-haiku-4-5` if a command feels slow).

## 1b. Round 3 (2026-10-05 night): speed, push-to-talk, sound-alikes, editing, Soniox

Ralf's report after real use: much better; but "at the end it reacted to 'open WhatsApp' four or
five minutes later"; wants push-to-talk by gaze with the whole bar as the button; it mishears a lot
(try Soniox); proper text editing; slow scrolling; an undo. Built, all green on the gate (2495 tests)
and the browser suite, none of it tried with a real voice:

- **It cannot fall minutes behind any more.** The speech server decodes on a worker thread
  (Node 22.18 or newer; older Node decodes on the server thread with the same bound), keeps at most
  1.5 s of audio queued and drops the oldest when behind, telling the bar, which shows "Kõne jääb
  maha N s" from 1 s. The engine runs the rules only for an utterance that waited over 3 s, a new
  utterance cancels an earlier one's model work, and dictation verification no longer blocks the
  next utterance (a "saada" still waits for it). The default intent model is `claude-sonnet-5-5`.
- **Push-to-talk by gaze.** Settings: Kuulamine = Lülitiga (as before) or Vaatamisega; the target is
  the microphone square or the whole bar; it listens from 250 ms of rest and stops 600 ms after the
  pointer leaves, delivering the words at once. The pill works the same way when the bar is folded.
- **Sound-alikes.** "juutuba", "aga whatsapp", "keri ala", "saadake" and the like work (phonetic
  keys in `src/core/phonetic.ts`); a reviewer's scan over 170 common words found and fixed two false
  positives; "mina" still sounds like "mine" by design.
- **Editing in the box.** Caret by sentence, word or to a named word; select; type at the caret;
  Backspace, Delete, arrows, Home, End, Undo, Redo, Tab, with counts ("kustuta kolm tähte"); on
  textareas and rich editors. Google Docs: keys and typing only, no reading; "saada" does nothing
  there. The model knows these commands too.
- **Scrolling.** "keri natuke", "keri aeglaselt alla" until "stopp"/"seis", smooth page scrolls.
- **Soniox** as a second recogniser behind `SONIOX_API_KEY` on the dev server and the Kõnemudel
  setting; built from Soniox's public client code, never run against the real service.

Known, not fixed (docs/REVIEW-R3.md has the details): a queued utterance that has not started is
cancelled by a barge-in and typed unverified; a one-word "kustuta see" with nothing selected deletes
one letter; after 4 s on Google Docs the next sentence is glued to the last; Soniox has no lag path.

## 1c. Round 4, VOICE lane (2026-10-06): the server knows his voice

Ralf's words after the demo: the microphone picks up background conversations. Built on
`r4-voice`, green on typecheck, lint, 2526 tests and the extension build; nothing tried with a real
voice (this machine has no model files):

- `npm run model` now also fetches a 29 MB speaker model (WeSpeaker CAM++, VoxCeleb) into
  `models/speaker/`. The settings page has **Minu hääl**: **Õpeta mu hääl** (speak 8 s; the server
  stores an embedding in `models/speaker/owner.json`, never audio) and **Kuula ainult mind** /
  **Kuula kõiki** (`onlyOwner`, takes effect the next time listening starts).
- Every final then carries `speaker: owner | other | unknown` (cosine similarity 0.55 / 0.35 in
  `server/speaker.ts`); the client drops `other` while the mode is on and the bar says "Keegi teine
  rääkis, jätsin vahele." `unknown` is obeyed, so a bad profile never locks him out.
- Without the model the mode only drops speech fainter than his was at enrolment (40 % of its RMS).
- The other voice's partials are typed as a preview before its final is judged; the review made the
  engine take the preview back the moment the final is dropped. Thresholds unmeasured on an
  Estonian voice. See ARCHITECTURE 24.2 and `docs/REVIEW-R4.md` (what was fixed, what is proposed).
  Round 5 was reviewed the same way: `docs/REVIEW-R5.md`.

## 1d. Round 5 (2026-10-06): the demo with the real user

Ralf's report after the demo, in his words as near as the lanes carried them, in his order:

1. "Inserting an e-mail, a phone number or an ID code is very hard": the recogniser writes numbers
   as words.
2. "For long prompts it should take some time to think about what is really wanted; with a very
   long message it hurried to act too fast, but it can't come at the cost of executing short
   commands efficiently."
3. "It got stuck thinking at one point and became unusable for a few minutes."
4. "Correcting a form field was a hassle"; a Smart-ID login needs a way to move on and to confirm
   by voice.
5. He could not zoom or enlarge the text.

Built on branch `r5` in three lanes, each green on the gate and the browser suite, nothing of it
tried with a real voice (ARCHITECTURE 25):

- **1 and 4, forms (25.1).** Every one-line `<input>` is reported `single` with a `fieldKind`
  (email, tel, code, number, password, text) read from its type, inputmode, autocomplete, name,
  id, placeholder and label. Dictation into it is converted in the core (`src/core/spelling.ts`):
  number words to digits, one by one or as a number, "ät" to @, "punkt" to a dot, letters by name,
  "suur a". Nothing is typed into a one-line field live: the model checks the words first, the
  field is replaced whole, and the bar reads it back ("Kirjutasin: 39002100001 (ütle „edasi“ või
  „valmis“)", a password as dots). "numbritena" / "tavaliselt" switch digits on and off for
  everything; "kirjuta kood X", "sisesta e-post X" name the kind once and need no model. In a form
  field "valmis" / "edasi" are Tab and "kinnita" / "logi sisse" are Enter, which submits the form
  the way a real Enter does.
- **2 and 3, the brain (25.2).** Every ask carries `care`: careful for eight words or more, a
  connective, or a chain (effort high, 800 tokens, 12 s on the server, 14 s in the engine, a second
  system block "read the whole utterance, plan every goal, then act"); quick, unchanged, for
  everything else. A 25 s watchdog per job and per goal of a chain gives up with "Võttis liiga
  kaua, katkestasin."; the strip counts the seconds from 3 s ("Mõtlen… 7 s"); every page command is
  cut at 20 s; "katkesta" (also "tühista kõik", "lõpeta kõik", "stopp kõik", "cancel") drops
  everything in flight without asking the model. The review's M7 and M8: a sentence of 14 words or
  more typed first is not taken back for one plain command, and the continuation window is measured
  from the first word after a delivery.
- **5, zoom (25.3).** "suurenda", "vähenda", "tavaline suurus" (and "tee suuremaks", "suurem
  kiri", "suumi sisse", the English forms) step Chrome's own tab zoom through 50 to 300 %, kept per
  site; the bar zooms with the page.

What to try first:

1. A Smart-ID login. On the test page first: `npx vite --port 5193 --strictPort`, open
   `http://localhost:5193/extension/test/fixtures/login.html` (the dev server serves the repository's
   files at their paths; the strip needs an http page, not `file://`), click Isikukood, say the code digit by digit, watch the bar read it
   back; "valmis"; the phone number; "valmis"; the e-mail with "punkt" and "ät"; "kinnita". Then the
   real page: note which fields are taken for the wrong kind (the bar's read-back shows it) and
   whether "kinnita" submits.
2. A long chain in one breath ("mine youtube'i, siis otsi kassivideod, siis mängi esimene ja pane
   heli vaiksemaks"): the bar should say "Mõtlen pikemalt…" and count seconds, then run the goals.
   Time a short command next to it ("keri alla"): it must stay instant.
3. Say "katkesta" in the middle of that chain: everything stops with "Katkestatud." within a second.
4. "suurenda" twice on Postimees, then "tavaline suurus".
5. If a careful ask feels slow, run `npx tsx scripts/intent-eval.ts` with the key: it prints the
   care and the latency per ask.

## 1a. The eval, run by Ralf on 2026-10-05 evening with his key

- As first shipped: 0 of 62, every call a 400 "The compiled grammar is too large. Simplify your tool
  schemas or reduce the number of strict tools." The answer tool is no longer strict (the schema is
  still closed; `pageIntentFrom` validates every answer). Fixed in this branch.
- Without strict: 61 of 62 pass. Latency on `claude-opus-5-5` at low effort: p50 2.7 s, p95 5.4 s.
  The one miss ("recovery: click failed, do not repeat it") was the engine's loop stopping after a
  failed step when the model had said done; the engine now asks once more after a failed step. Fixed.
- 2.7 s per free-form command is noticeable in a voice UI. `UTLE_MODEL=claude-sonnet-5-5` is the
  thing to try next, with the eval, before the demo. Dictation is not affected: it is typed first.

**The laptop's `main` has 27 commits (sections 21.4 to 21.7: navigation, settings) that are not on
GitHub. This branch conflicts with them in 23 files. Ralf asked that the PR not be merged. The
conflicts cannot be resolved from the cloud until that `main` is pushed; the two sides built the
same features twice (navigation commands, a settings page), so resolving them is a judgment call
on which to keep, per file.**

## 2. What Ralf must do before the demo

1. `git pull` on `main`, `npm ci`, `npm run ext`, reload the extension on `chrome://extensions`,
   reload open tabs. Restart `npm run dev` and look for `[asr] model loaded on a worker thread`.
2. Put a working Anthropic key in the environment of the terminal that runs `npm run dev`
   (`ANTHROPIC_API_KEY`). Without it everything in section 1 except the free-form understanding
   works, and the bar shows one amber line saying so. `curl localhost:5173/api/status` must say
   `"intent":"live"`.
3. With the key: `npx tsx scripts/intent-eval.ts` runs 62 Estonian and English utterances, including
   multi-step ones, against fake YouTube, WhatsApp, Google, Gmail, news, Facebook, form and new-tab
   pages through the real model and prints pass or fail, the latency per case, and p50/p95.
   `UTLE_EVAL_JSON=out.json` writes the results; send that file back. This has NOT been run by anyone:
   this machine had no key. If p50 is above about 2.5 s, start the dev server with
   `UTLE_MODEL=claude-sonnet-5-5` (or `claude-haiku-4-5`) and run the eval again.
4. Try the demo path on the real sites and note what misses. Selectors for YouTube and Google
   (`extension/src/sites.ts`, `SEARCH_FIELDS`) and the player shortcuts are UNVERIFIED.
5. Round 4: `npm run model` again (the speaker model), restart `npm run dev` and look for
   `[asr] speaker model loaded`; on the settings page press **Õpeta mu hääl**, speak 8 s, then
   **Kuula ainult mind**; turn listening off and on. Have someone else speak: the bar should say
   "Keegi teine rääkis, jätsin vahele." If your own words are skipped, lower `OWNER_THRESHOLD` in
   `server/speaker.ts`; if a stranger gets through, raise `OTHER_THRESHOLD`.

## 3. Not verified by anyone

- The model's answers on real pages (no key here). The server, the validation, the engine and the
  page side are each tested with fakes; the join is tested end to end only without a model.
- His voice, a real eye tracker, real WhatsApp with the M7 build, real YouTube and Google, Messenger.
- Whether `requestFullscreen` works from an injected script (it may need a user gesture; then the
  command answers "See ei õnnestunud").
- Latency of a model answer in his network. The engine waits at most 9 s for a quick ask and 14 s for
  a careful one and shows "Mõtlen…" / "Mõtlen pikemalt…" with the seconds from 3 s on (25.2).

## 4. Known faults

- Round 5 (BRAIN lane, 2026-10-06 afternoon, spec 25.2), after the owner's report that a long prompt
  was acted on too fast and that it once got stuck for minutes: the model is asked with `care`
  (careful for eight words or more, a connective, or a chain: effort high, 2000 tokens, 12 s on the
  server, 14 s in the engine, an extra system block; quick for everything else, unchanged), a 25 s
  watchdog per job and per goal, the elapsed seconds on the strip from 3 s, every page command cut
  at 20 s, and `katkesta` as a global escape. Single-line fields (`box.single`) are verified before
  anything is typed, except digits into a code, phone or number field and anything into a password
  field, which the rules type at once (review of round 5, `docs/REVIEW-R5.md`). None of it has met a real voice; the latency of a careful ask on the real model
  is unmeasured (the eval prints care per ask).
- Round 5 (FIELDS lane, spec 25.1): the field kinds come from the markup of the test page and of
  what the lane knew of Smart-ID and bank forms, never from the real pages; a field the rules take
  for text gets words, not digits ("numbritena" is the way round it). "kirjuta kood X" is typed by
  the rules without the model's check even in a one-line field, by design. A one-line field is
  always replaced whole, so a value said in two breaths is joined by the core, not by the page.
- Round 5 review: see `docs/REVIEW-R5.md` when it lands; its open items belong here.
- "Kirjuta siis mulle" is taken as opening a conversation with "Siis Mul" (the two-word name rule
  in `src/core/message.ts` excludes only single-word pronouns). Not fixed.
- A page that navigates on the search's Enter within 600 ms can lose the page's answer, so the bar
  says the command did not answer although the search ran.
- The earlier faults stand: the command word can flash in the box when he keeps talking after a
  quick command; the "Sain aru" line is replaced by the result line a moment later; live words come
  in bursts of about 0.6 s; Chrome's own pages (settings, Web Store) cannot show the bar, and no
  extension can change Chrome's settings. Ütle's own settings page is the answer to that.
- Push-to-talk (listen only while the pointer rests on the microphone) is not built.
- A click whose only effect is a network request with no DOM change for 400 ms gets a second
  activation (Enter) by the click fallback; on an element that handles both it could toggle twice.
- The cookie-banner rule covers overlays; YouTube's own consent is a separate page (a form), which
  the model handles as any page with buttons.

## 5. Where things are

| What | Where |
|---|---|
| The intent set and its validation | `src/core/pageIntent.ts` |
| Rules, the armed box, `applyIntent` | `src/core/inpage.ts`, `src/core/browserIntent.ts` |
| The prompt and the endpoint | `server/intentPrompt.ts`, `server/intent.ts`, `server/vitePlugin.ts` |
| When the engine asks the model, and how carefully | `extension/src/engine.ts` (`LONG_UTTERANCE_WORDS`, `ASK_TIMEOUT_MS`, `CAREFUL_WORDS`, `JOB_WATCHDOG_MS`) |
| Numbers and symbols as a field needs them | `src/core/spelling.ts`; the field's kind in `extension/src/box.ts` (`fieldKindOf`) |
| Page commands, the armed element | `extension/src/page.ts`, `extension/src/box.ts` |
| Strip, pill, settings | `extension/src/strip.ts`, `extension/src/options.ts` |
| Screenshots | `docs/proof/m7-*.png` |

## 6. People and time

Hackathon: NewWorkTech, TalTech Mektory. Tuesday 6 October: 10:00 three-minute recap, teamwork to
12:30, pitch preparation 13:30, pitch to the jury 14:30. Tanel Alumäe (TalTech) made the speech
model; it is not ours and must not be pitched as ours.
