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

Known, not fixed (docs/REVIEW-R3.md has the details): after 4 s on Google Docs the next sentence is
glued to the last. The queued-utterance barge-in, "kustuta see" deleting one letter and Soniox's
missing lag path were fixed in round 7 (1i).

## 1c. Round 4, VOICE lane (2026-10-06): the server knows his voice

Ralf's words after the demo: the microphone picks up background conversations. Built on
`r4-voice`, green on typecheck, lint, 2526 tests and the extension build; nothing tried with a real
voice (this machine has no model files):

- `npm run model` now also fetches a 29 MB speaker model (WeSpeaker CAM++, VoxCeleb) into
  `models/speaker/`. The settings page has **Minu hääl**: **Õpeta mu hääl** (speak 8 s; the server
  stores an embedding in `models/speaker/owner.json`, never audio) and **Kuula ainult mind** /
  **Kuula kõiki** (`onlyOwner`, takes effect the next time listening starts).
- Every final then carries `speaker: owner | other | unknown` (cosine similarity 0.55 / 0.35 in
  `server/speaker.ts`; round 7 replaced this with one threshold and strict mode, see 1g); the client drops `other` while the mode is on and the bar says "Keegi teine
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

## 1e. Round 6 (2026-10-06 evening): Minu andmed

Ralf: "Inserting an e-mail, a phone number or an ID code is very hard." Built on branch `r6-saved`
(ARCHITECTURE 26, `extension/README.md` "Minu andmed"):

- **Saved once.** The settings page has a **Minu andmed** section: each saved e-mail, phone number or
  ID code with what to say under it, Muuda and Unusta, buttons to add one by voice, and a keyboard
  form for Tom. By voice: `minu andmed` opens it, `lisa uus e-post` opens it with the entry started;
  he spells letter by letter (`punkt`, `ät`), `gmail` / `hotmail` / `mail punkt ee` add the ending,
  `kustuta`, `loe ette`, `valmis`, `katkesta`. Kept in `chrome.storage.local` only.
- **Put in by voice.** In an armed field `minu e-post`, `mu meil`, `pane mu email sinna`, `kirjuta mu
  telefon`, `my email` type the value whole at once with no model; two of a kind and no name: the bar
  asks which. Free phrasing ("täida telefon", "sisesta see gmaili aadress") goes to the model, which is
  told the names only and answers `insertSaved`; the engine types the value from this machine.
- **Guidance.** The bar adds "Või ütle „minu e-post“." when an armed field matches a saved value.

Proven: unit tests (`src/core/saved.test.ts`, `savedEntry.test.ts`, `inpage.test.ts`,
`pageIntent.test.ts`, `extension/src/engine.test.ts`, the request never holds a value), the browser
suite (`openSettings` from the words, the savedEntry walk to ralf.tamm@gmail.com, screenshots in
`extension/test/out/andmed.png` and `andmed-saved.png`), and four eval cases on the form page.
Not verified: a real voice spelling letter by letter (how the recogniser writes "r", "emm", "ät" as
single utterances), real forms, and Tom using the form.

What to try first: say `lisa uus e-post`, spell the address, `gmail`, `loe ette`, `valmis`; then on
`http://localhost:5193/extension/test/fixtures/login.html` click E-post and say `minu e-post`.
## 1f. Round 6, HOST lane (2026-10-06): a hosted server, the store zip

The real user's work laptop allows nothing to be installed. Built on branch `r6-host`
(`docs/ARCHITECTURE.md` 27; `extension/README.md` "Hosted server", "Install on a locked computer",
"The store zip"):

- `npm run serve` (`server/serve.ts`): the same API as the dev server on plain Node, no Vite;
  `/healthz` and `/` without a token. The dev server and `serve.ts` share `server/app.ts`.
- `UTLE_TOKEN`: bearer header on `/api`, `?token=` on the speech socket, 401 otherwise;
  `"auth":"on"|"off"` in `/api/status` (`server/auth.ts`).
- The settings page's **Server** section: address, token, **Proovi ühendust** (works / cannot
  connect / wrong token). The extension sends the token on the socket and every fetch; a 401 shows
  "Serveri võti on vale." on the strip.
- `Dockerfile` (Node 22.20, both models in the image), `.dockerignore`, `railway.json` (health
  check `/healthz`). The service needs at least 1 GB of memory.
- `npm run ext:pack` writes `extension/out/utle-0.3.0.zip` for the store; icons; manifest 0.3.0;
  `docs/PRIVACY.md` is the privacy policy's text.

**The audio leaves the machine** when the server is hosted. Not verified: the Docker image was never
built (no Docker on the machine that wrote it; the sherpa addon's Linux libraries and
`LD_LIBRARY_PATH` are the likeliest thing to need a fix), no Railway deploy, no store upload, no real
voice over the network (latency over the internet is unknown). The voice profile is lost on a
redeploy without a volume.

What Ralf must do: create the Railway service (README "Hosted server"), set the variables, read the
first deploy's log for `[asr] model loaded`, then the store listing (README "The store zip").

## 1g. Round 7, SPEECH lane (2026-10-21): a speaker gate that drops other voices, a speech detector

The owner's report, 2026-10-20: "I had my voice learnt, then had my friend talk next to me, his
voice was picked up fully. Mine was too, the background noise was as well." Built on branch
`r7-speech` (ARCHITECTURE 24.2 is the spec; `extension/README.md` "Only your own voice"):

- **Why it let the friend through**, three faults, all fixed: `unknown` (cosine 0.35 to 0.55) was
  obeyed; judge embedded the utterance with its silences while enrolment embedded speech only, so
  one recording scored 0.34 against itself (now 1.000); and round 4's model, WeSpeaker CAM++, does
  not tell voices apart on short utterances (other voices up to 0.85, the owner down to 0.21).
- **New speaker model**: TitaNet small (`nemo_en_titanet_small.onnx`, 40 MB). `npm run model` fetches
  it. The old `owner.json` was made with CAM++: until the voice is taught again the server cannot
  judge voices, and with strict mode on it obeys everything except much fainter speech.
- **Strict mode**: "Kuula ainult mind" drops `other` and `unknown`; one threshold,
  `OWNER_THRESHOLD = 0.54` in `server/speaker.ts`. The bar says "Keegi teine rääkis, jätsin vahele."
  at each drop and, at the third in a row, once "Kui see olid sina, õpeta hääl uuesti seadetes."
- **Scripted enrolment**: the settings page's **Õpeta mu hääl lausetega** shows 12 sentences
  (`src/core/enrolPhrases.ts`) one at a time with "1 / 12"; one embedding per sentence, the
  profile is their mean. **Valmis** keeps what was read; under 6 sentences the bar says the profile
  is thin. The old 8 s button is **Õpeta vabalt rääkides**.
- **Speech detector**: Silero VAD v5 (`silero_vad_v5.onnx`, 2.3 MB, third file of `npm run model`).
  Only speech reaches the decoder and the speaker gate; everything else reaches the decoder as
  silence, so 20 s of pink noise gives zero finals. Log: `[asr] vad model loaded` / `[asr] no vad model`.
- **UTLE_CAPTURE=<folder>**: each final's speech as `<time>-<speaker>-<score>.wav` plus a line in
  `log.tsv` with the words. For calibration on his own machine only; delete the folder after.

**The numbers** (`npx tsx scripts/speaker-calibrate.ts scripts/fixtures/speaker-set`, full table in
that folder's `scores.json`). There is no recording of the owner on disk: the five fixtures are
TartuNLP's synthetic voice "mari", used as a stand-in owner; the others are six more TartuNLP voices
(albert, kalev, meelis, kylli, vesta, liivika) and "mari" pitch-shifted 20 %. Stand-in owner,
utterances with 0.6 s of speech or more: 0.622 to 0.760. Other voices: at most 0.499 (vesta, a
woman's voice; the pitch-shifted owner 0.365). Threshold picked: 0.538, set as 0.54: 0 other clips
pass. The stand-in owner's one-word utterances ("jah", "saada", "üks", 0.4 to 0.5 s of speech)
scored 0.14 to 0.27. No threshold keeps them and drops a friend, so continuity (below) keeps them
instead. Against the real round 4 `owner.json` (its own CAM++ model) every
synthetic clip scored at most 0.346.

**Proven, and by what**: `npx vitest run server/speaker.test.ts server/asrSession.test.ts
server/asr.test.ts src/speech/local.test.ts extension/src/engine.test.ts
extension/src/offscreenMain.test.ts src/core/enrolPhrases.test.ts` (strict mode, the self-score,
scripted enrolment, the speech detector with a fake, capture); `npx tsx scripts/asr-file.ts <wav>`
through the real recogniser and detector (pink noise: 0 finals; the five fixtures: their sentences);
the browser suite's settings case (`extension/test/out/enrol.png`, "1 / 12"); `npm run check`.

**Defect round (same day, branch `r7-speech`):**

- **Merged main** (0d96e3d): HOST's profiles per token and ROBUST's hotwords now run with this
  gate, the detector and scripted enrolment. A token's socket enrols and is judged on its own
  `profiles/<id>.json`; tested with phrase enrolment ("two tokens enrol two profiles from read
  phrases").
- **Continuity** (`continued` in `server/speaker.ts`, ARCHITECTURE 24.2): an utterance with under
  1.0 s of speech (`SHORT_UTTERANCE_SECONDS`) is the owner's when his last owner final judged on its
  score was at most 10 s (`CONTINUITY_MS`) before it, whatever it scores. So "saada" after the
  sentence, or "jah" right after he spoke, passes strict mode. Only a score-judged owner final opens
  the window, an `other` final closes it, and long utterances are never covered. The cost: a
  friend's one-word reply within 10 s of the owner speaking passes. The log says
  `[asr] final judged owner 0.168 continuity (only owner on)`, never the words.
- **The voice test's case 6 failure, found and fixed** (`server/vad.ts`): the detector made short
  words vanish. Silero at 0.1 s minimum speech missed the quiet "üks" at some window phases (3 in 96
  replays), and on the digital zeros it fed for non-speech the recogniser could drop a short last word
  ("Saada" then nothing, in 4 of 21 recorded live sessions). Now 0.05 s, and non-speech reaches the
  recogniser as a faint fixed hiss (-85 dBFS). `UTLE_REAL=1 extension/test/voice.ts`: ALL PASS 3 of
  3 full runs. A lone "." is no longer sent as a final.
- **The image** builds and runs with the three models: 1.22 GB, peak memory 579 MB (ARCHITECTURE 27.7).
  Same words from the container as from the dev server.
- The browser suite's two "with no ordinary window → no_target" failures did not occur on the merged
  tree (`npx tsx extension/test/run.ts`: ALL PASS, one run).

**Not verified**: a real voice through any of it: the threshold on his voice and a friend's, a real
room's noise, a real microphone, and how often continuity lets a friend's short word through in a
real conversation. Measured, not explained: with the detector the "saada" after a sentence and
"järgmine vaheleht" end 0.5 s later, "jah", "näita numbreid" and "üks" 0.2 to 0.4 s earlier
(ARCHITECTURE 27.7 has the table); the cause is not found. The hosted
server (Railway) needs a redeploy for the new models.

**Ten minutes in the morning, with the friend:**

1. `npm run model` (fetches the two new files), then teach the voice again: settings, **Õpeta mu hääl
   lausetega**, read the 12 sentences.
2. Stop the dev server. PowerShell: `$env:UTLE_CAPTURE="C:\temp\voice-me"; npm run dev`. Turn
   **Kuula kõiki** on (nothing dropped while recording). Say 20 things you really say: "saada",
   "jah", "keri alla", "ava uus leht", two or three whole sentences. Stop listening.
3. Restart with `$env:UTLE_CAPTURE="C:\temp\voice-friend"`. The friend, beside you, says the same
   kinds of things, short and long. Then both of you at once for a minute. Then a minute of the room
   with nobody speaking (it should write nothing: the detector).
4. Move the "both at once" clips by ear (`log.tsv` has the words) into `voice-me` or `voice-friend`.
5. `npx tsx scripts/speaker-calibrate.ts --owner C:\temp\voice-me --other C:\temp\voice-friend`.
   Read the printed best threshold and how many of your clips it drops. Put it in
   `OWNER_THRESHOLD` (`server/speaker.ts`) if it differs, restart, turn **Kuula ainult mind** on and
   try the friend again.
6. Delete both folders: they hold your voice and your words.

## 1h. Round 7, HOST lane (2026-10-21): the image runs, one server for several people

Built on branch `r7-host` (`docs/ARCHITECTURE.md` 27.6 and 27.7; `docs/DEPLOY.md`; `extension/README.md`
"Hosted server"):

- **The Docker image builds and recognises speech.** `docker build -t utle-server .` exits 0 with
  both models fetched inside the build; the Dockerfile needed no change (the addon loads with the
  `LD_LIBRARY_PATH` it already set). 1.19 GB on disk, 393 MB compressed. The container logs
  `[asr] model loaded` and `[asr] speaker model loaded`, answers `/healthz` without a token and
  `/api/status` only with it, and gives the same finals for the recorded dictation as the dev server
  (1691 ms from the last speech to the last final in the container, 1727 ms on the dev server).
- **Memory:** 407 MB peak (two sockets and an enrolment), about 0.5 GB needed, not 1 GB. Railway
  Hobby allows 48 GB per service; memory costs about $4 to $5 a month at $10 per GB.
- **Profiles per token.** `UTLE_TOKEN=ralf:<t1>,mari:<t2>`: each token is a person with their own
  voice profile at `UTLE_DATA_DIR/profiles/<first 16 hex of the token's SHA-256>.json`; enrolment
  writes only the caller's. No `UTLE_TOKEN` (the dev server): `models/speaker/owner.json` as before.
  `/api/status` answers `profile: { name, enrolled, seconds }`; the settings page's **Proovi
  ühendust** adds "Profiil: ralf, hääl õpetatud / õpetamata". A profile written to a Docker volume
  survived a new container.
- `scripts/asr-client.ts <ws(s)://…/api/asr?token=…> <wav> [--enrol 2]` streams a recording to any
  server the way the extension does.

Deployed to Railway on 2026-10-23 (`docs/DEPLOY.md` has the address and the three checks' numbers; the
internet adds about 740 ms to the recorded dictation). Not verified: no real voice over the internet, the
latency over a real network. The recorded fixtures are quiet: only `et-sentence-16k.wav` has the two
seconds of speech an enrolment needs within its patience window.

Ralf's morning, in full in `docs/DEPLOY.md`:
1. `railway login`, then `railway init -n utle`, `railway add --service utle-server`, `railway service link utle-server`.
2. One token per person (`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`).
3. `railway variable set "ANTHROPIC_API_KEY=…" "UTLE_DATA_DIR=/data"`, and `UTLE_TOKEN` as `name:token,name:token` through `--stdin`.
4. `railway volume add --mount-path /data`, `railway up --ci`, `railway domain`.
5. The three checks: `/healthz` 200, `/api/status` with the token, `npx tsx scripts/asr-client.ts "wss://<domain>/api/asr?token=…" scripts/fixtures/et-dictate-send-16k.wav`.

## 1i. Round 7, ROBUST lane (2026-10-21): the round 3 leftovers, a flaky test, hotwords

Built on branch `r7-robust` (`docs/ARCHITECTURE.md` 23.2, 21.1, 23.6, 28), green on `npm run check`:

- A barge-in cancels only a job that has begun (review R3 M3). An utterance still queued behind a
  slow page command ("ava delfi", then "uus leht", then "otsi ilm") is now asked when its turn comes
  instead of being typed unverified. `npx vitest run extension/src/engine.test.ts`, tests
  "barge-in: a queued job is not cancelled" and "barge-in: a running model ask is cancelled".
- "kustuta see" / "delete this" takes back the last thing he said (the box undo, as "võta tagasi");
  after a "vali ..." step it deletes the selection (review R3 M6). `npx vitest run
  src/core/inpage.test.ts`, the "review R3 M6" block.
- Soniox: past 2 s of audio the network has not taken, a frame is dropped and the strip gets the
  lag; an upstream error's message is logged except for 401 and 403 (review R3 M4). `npx vitest run
  server/soniox.test.ts`. Never run against Soniox.
- The engine test that failed under load ("stops at MAX_CHAIN_STEPS") waited 16 × 300 ms of real
  time; it runs on fake timers now.
- Hotwords: the local recogniser leans toward the ~265 Estonian command phrases and site names
  (`models/hotwords.txt`, written by `npm run model` or at server start). `npx tsx
  scripts/asr-hotwords-eval.ts 1 1.5 2 3` on the five fixtures: 1 word error off, 0 at 1.0, 1.5 and
  2.0, 4 at 3.0; 1.5 already changes dictated punctuation, so `HOTWORDS_SCORE` is 1.0.

Not verified: a real voice with hotwords on (the fixtures are synthetic speech, 29 words), whether
and whether hotwords pull ordinary dictation toward command words over a day of use. Seen
2026-10-27 (round 9, 30.3): with both hotword files moved aside, a server start wrote them again
(10:03:49, 321 phrases) and logged `[asr] hotwords on: models\hotwords.txt, 321 phrases, score 1`. Google Docs gluing (M5) is still open: the fix is
in `extension/src/page.ts` and needs a browser test, more than the 20 lines the lane was allowed.

## 1j. Round 8 (2026-10-22 night, overnight, unattended): seek by amount, document mode, mail, wake word and places, reading aloud, the dictation-cleaning measurement

Plan: `docs/plans/2026-10-22-round-8-plan.md`. Spec: `docs/ARCHITECTURE.md` section 29 (29.1 to 29.6, one
per lane). Six lanes on Opus 5.5 in their own worktrees, reviewed by the orchestrator with the full diff and
every proof re-run, merged into `main` in the order MEDIA, FLOW, DOCS, MAIL, WAKE, READ. Push to origin is
disabled in this checkout, so `main` is local only. The two gates only Ralf can pass were both unmet when the
round started: the Railway deploy was done on 2026-10-23 (`docs/DEPLOY.md`), still unmet is the calibration line
from his voice (1g). Nothing below has met a real voice, a real Gmail, a real Google Docs or Edge in daily use.

**What works now, and by what it is proven** (every proof was run by the orchestrator on the merged tree, not
taken from a lane's report):

- **Seek by an amount** (29.1): "keri edasi üks minut", "keri kaks minutit tagasi", "keri tagasi pool minutit",
  "keri edasi 30 sekundit", "skip back thirty seconds"; bare "keri edasi" stays 10 s. `seconds` 1 to 3600 on
  `media forward/back`, in the rules, the schema and the model's tool. Proof: `npx vitest run
  src/core/browserIntent.test.ts src/core/pageIntent.test.ts server/intent.test.ts` ("round 8: media forward and
  back by an amount"); the suite's four `seek` lines (5 s and 60 s both ways on the 20.008 s stand-in video); the
  eval cases "keri minut edasi" and "keri kaks minutit tagasi" (PASS, 2.7 to 3.1 s). Not verified: the YouTube
  `#movie_player` path (the stand-in has none) and `<audio>`.
- **Document mode** (29.2): when the armed box is Google Docs, a textarea or editor over 500 characters, or a
  rich editor with headings or blocks, a pause of up to 20 s continues the sentence, "punkt" and "uus lõik" are the
  only breaks, "välja", "sulge", "edasi", "tagasi", "paus", "veel" are typed as words, only an utterance starting
  with a command verb is asked of the model, and "saada" says "Dokumendis ei saadeta." Formatting by voice:
  "paksuks", "kaldkirja", "allajoonitud", "pealkirjaks", "tavaline tekst", "loendiks", "uus lõik" (chords per
  editor, `execCommand` fallback on a plain contenteditable; Docs chords on the Docs key target); "vali lõik",
  "vali viimased kolm sõna"; "loe viimane lause ette" through speech synthesis. REVIEW-R3 M5 (Docs gluing after
  the 4 s reset) is fixed on a Docs stand-in. Proof: `npx vitest run src/core/inpage.test.ts
  extension/src/engine.test.ts -t "document mode|pause|format|saada|loe"`; the suite's essay case
  (`docs/proof/r8-essay.png`: sentence 2 in italics after "mine sõna paistab ette", "vali see lause",
  "kaldkirja") and the Docs stand-in lines. Not verified: real Google Docs (the chords are the documented ones).
- **Mail by voice** (29.3): "kirjuta meil Marile", "uus meil", "teema: Koosolek", "lisa koopia", "valmis" between
  To, Cc, Subject and body (Tab inside the compose window), "saada" clicks Send (never Enter). `readPage` lists
  the page's e-mail addresses and phone numbers as `contacts` (text, `mailto:`, `tel:`; decoys like a version, an
  ID code, a price, a street number or a date are not contacts); the model may answer `composeTo` only with an
  address the page holds (validated on the server and in the engine), which opens Gmail's compose URL in a new
  tab with To and Subject filled and the body armed. "teema …" and "lisa koopia" act only inside a compose window;
  elsewhere they are dictation (found in review). Proof: `npx vitest run src/core/mail.test.ts
  src/core/contacts.test.ts src/core/pageIntent.test.ts -t "composeTo|mail"`; `server/intent.test.ts` ("logs the
  kind and the time for a composeTo ask, never the address, the body or the page text"); the suite's cv.html and
  Gmail stand-in lines (`docs/proof/r8-mail.png`); three eval cases on the CV fake (PASS). Not verified: every
  Gmail selector (`extension/src/sites.ts` MAIL) on real Gmail; the read-backs of a real voice.
- **Wake word and Minu kohad** (29.4): listening mode "Äratussõnaga": always listening, a final is acted on only
  when it starts with the wake word (default "Ütle", a setting, phonetic match: "ütel" passes, "ütlesin" does not,
  "ma tahtsin ütelda" does not); dictation into an armed box opens a 20 s window (amber disc on the microphone)
  closed by silence, "aitab" or a send. Places: "vaata uudiseid", "pane raadio käima", "mis ilm on", "ava mu mail"
  open his places (defaults: Postimees, Vikerraadio otse, Ilmateenistus, Gmail, Google Kalender, Google Maps,
  YouTube); "lisa koht uudised" on any page saves that page under the noun, "eemalda koht uudised" removes it; the
  settings page lists and edits them; the model sees the nouns only and may answer `place { noun }`. Proof:
  `npx vitest run src/core/wake.test.ts src/core/places.test.ts extension/src/engine.test.ts
  extension/src/offscreenMain.test.ts src/speech/local.test.ts -t "wake|window|place|phonetic"`; the suite's
  places and wake lines (`docs/proof/r8-places.png`, `docs/proof/r8-wake-settings.png`); four eval cases (PASS);
  60 s of pink noise through the detector: 0 finals. The always-on socket costs 230 MB an hour of audio
  (float32). Not verified: a real microphone in wake mode for a day (false wakes, how often "Ütle" is misheard).
- **Reading aloud** (29.5): "loe ette" reads the page's article (headline and paragraphs; nav, sidebar, footer,
  banner left out), "loe see ette" the armed box, "loe valitud ette" the selection, "loe edasi" continues,
  "stopp" / "aitab" / "paus" stops within 300 ms. The reader lives in the offscreen document on `speechSynthesis`,
  sentence by sentence, first `et` voice; without one the bar says "Selles brauseris pole eesti häält. Edge'is
  on." While an article is read the microphone stays live and the engine drops every word but a stop word (found
  in review: with the microphone muted a person with no hands could not stop a reading). "Loe riba ette" (setting,
  off) speaks each new amber line. **The measurement that decides the product route:** Chrome and Playwright's
  Chromium have no Estonian voice (Chrome's 27 voices with network voices on: Google's 19, none `et`); Windows 11
  has none; Microsoft Edge with network voices on has "Microsoft Anu Online (Natural)" and "Kert", usable from the
  extension's offscreen document (0.7 s to the first word, 1 start in 18 failed). TartuNLP's public API is the
  Chrome route (0.5 s for the first sentence, free, MIT code, model licence unstated), not built. Proof: `npx tsx
  scripts/tts-voices.ts` (and `--edge-extension`, `--tartunlp`); `npx vitest run src/core/reading.test.ts
  extension/src/engine.test.ts extension/src/offscreenMain.test.ts -t "read|voice|fail|riba"`; the suite's
  news.html lines with a fake `speechSynthesis` (`docs/proof/r8-read.png`). Not verified: a human ear on Anu;
  whether TalTech's model hears "stopp" over a loudspeaker; the 10 s TartuNLP sample is
  `docs/proof/r8-read-tartunlp-mari.wav`.
- **Dictation cleaning, scoping only** (29.6, FLOW): on a 20-line stand-in set (six lines are real decoder output
  of the fixtures, fourteen written and spoken by TartuNLP's voice, then decoded), a cleaning prompt on Opus cuts
  word error from 28 % to 3.5 to 4.2 % with 0 of 20 meaning changes in five runs (one the orchestrator's), p50
  1.3 s, about $4 per 1000 utterances; Haiku is killed (2 to 3 of 20 meaning changes), Sonnet passes only with
  structured output. The hazard found: the decoder hears the filler "ee" as "ei", and the cleaner then guesses
  whether a mid-sentence "ei" is a negation; the proposed next step (ops on the box, a negation word never removed
  or added except as the first word) is in 29.6. No code in the dictation path. Harness: `npx tsx
  scripts/flow-eval.ts` on `scripts/fixtures/flow-set.tsv`. The real measurement needs Ralf's own 20 captured
  finals (`UTLE_CAPTURE`, 1g).

**The merged tree** (`main` 1394b91): `npm run check` green (44 files, 3499 tests); `npx tsx extension/test/run.ts`
ALL PASS twice (282 checks); `UTLE_REAL=1 npx tsx extension/test/voice.ts` ALL PASS twice (30 checks). The voice test ran on a dev server at port 5194: port 5193 was held by a process this
session was not allowed to stop.

**Not verified by anyone** (in addition to 1g and 1h): a real voice through any round 8 feature; real YouTube's
player for the seek; real Google Docs; real Gmail's selectors; Edge with the extension in daily use; the wake
word all day in a room; "stopp" over a loudspeaker; Ralf's own dictation through the cleaning prompt.

**Known faults added this round:** in document mode a dictated sentence that starts with a command verb ("Ava
uks oli lahti") is asked of the model, which usually answers dictate; (fixed 2026-10-27, 30.3: a long textarea
with a send, post or reply button beside it is no longer a document, and "saada" there presses the button); the wake word is matched on the first one or two words only, so "Ütle" said before a breath that the
recogniser split off becomes its own final (the bare word opens the dictation window, which is the intended way
to say it); in wake mode a woken command never opens the dictation window, only dictation does.

**Ralf's thirty minutes stay as in the plan, section 2:** the Railway deploy (`docs/DEPLOY.md`), the ten-minute
calibration with a friend (1g), and the read-backs on `fixtures/login.html`. Three new things to try first, in
this order: on any news page say "loe ette" in Edge (network voices on in Edge's settings) and in Chrome (the
bar must say there is no Estonian voice); on YouTube "keri edasi üks minut"; in Gmail "kirjuta meil <nimi>",
"teema: proov", dictate, "saada".

## 1k. Round 9 (2026-10-27, overnight and unattended): usable by everyone

Plan: `docs/plans/2026-10-27-usable-by-everyone.md`. Spec: `docs/ARCHITECTURE.md` section 30 (30.1 to 30.6, one per
lane). Six lanes on Opus 5.5 in their own worktrees, each reviewed by the orchestrator against the full diff with the
proofs re-run, merged into `main` in the order REALPAGES, ONBOARD (two checkpoints), FAULTS, HELP, SHIP, MODEL (two
rounds), pushed to origin after each merge. The machine lost its internet for about five hours in the night; every
lane agent died with it and was resumed from disk at 10:00.

**What a new user gets now, in one paragraph:** the install opens **Alustamine**, five cards a helper walks through
(microphone, server, a demo box, voice, ready); the strip's microphone carries a connection dot and says, once, when
the server is gone and once when it is back, in words a helper can act on; "abi" opens **Mida saab öelda**, every
phrase grouped and read aloud on request, and the settings and help pages take `näita numbreid`; the strip folds out
of the way of a page's own cookie bar; "kirjuta siis mulle" is dictation, a long comment box with a Send button sends,
a search that navigates answers ok; the public Estonian pages the product was never run on were run (table in
`docs/proof/r9-real-pages.md`) and what they showed wrong was fixed; the store packet is ready at 0.4.0
(`docs/STORE.md`, `extension/store/`, `npm run ext:pack`), and a helper can load the zip unpacked today; the model
behind `/api/intent` is a configuration string with a fallback, the eval prints dollars per completed task, and the
default model (Sonnet 5.5) passes 77 of 78 scripted asks instead of 63.

**The merged tree** (`main` 91867cf): `npm run check` green (3884 tests); `npx tsx extension/test/run.ts` ALL PASS;
`UTLE_REAL=1 npx tsx extension/test/voice.ts` ALL PASS; `npx tsx scripts/pack-check.ts` PACK PASS (the zip loads, the
welcome page opens, "abi" opens help); `UTLE_MODEL=anthropic:claude-sonnet-5-5 npx tsx scripts/intent-eval.ts`
77/78, p50 1679 ms, $0.0057 per completed task, $0.44 the run. Every proof run by the orchestrator on `main`.

**Only Ralf can do**, in this order: (1) the Web Store developer account and the upload (`docs/STORE.md`, "Ralf's
ten minutes"); (2) deploy the site's new Paigaldamine section (`site/`, by hand); (3) a real voice through the
welcome page and the help page, and the ten-minute calibration with a friend (1g); (4) a DeepSeek key for the round 9
plan's lane C drill; (5) the logged-in sites (WhatsApp, Gmail, Messenger selectors).

**Not verified by anyone**: a real helper doing the first run; branded Chrome's install from the store; the strip's
fold on sites whose sticky footer mentions cookies (it would stay folded); the spend ring written by a real service
worker; a real eye tracker on any new page. The lane paragraphs below have each lane's own list.

## 1k-REALPAGES. Round 9 (2026-10-27): what Ütle sees on real public pages

`npx tsx scripts/real-pages.ts` opens youtube.com, a watch page, google.ee, postimees.ee, delfi.ee,
err.ee, ilmateenistus.ee and otse.err.ee with the built extension (no login, nothing typed, only the
consent button clicked) and writes `docs/proof/r9-real-pages.md` (ARCHITECTURE 30.4). Seen: the
cookie banner is listed first on all seven that show one; YouTube's and Google's `SEARCH_FIELDS`
selectors hit (marked VERIFIED in `sites.ts`); `#movie_player` holds the video; `loe ette` starts
with the headline and no menu text on one article of each news site. Fixed, each on a trimmed copy
of the real markup (`extension/test/fixtures/real-*.html`): a banner over the whole page no longer
lets the items below the fold and the video through (delfi, postimees, err); postimees.ee's
subscriber teaser is no longer read as the article; err.ee's headline is no longer read twice.
**Not fixed, for the strip's owner:** the strip covers a page's own fixed layer at the bottom, so on
youtube.com and ilmateenistus.ee the consent button is under the strip and a pointer or dwell cannot
press it (voice still lists it). A postimees headline carries its comment count, read as "(11)".

## 1k-ONBOARD. Round 9, ONBOARD lane (2026-10-27): the first run for a helper

What works (ARCHITECTURE 30.1): the install opens `extension/welcome.html` (**Alustamine**) instead
of the bare microphone page: five dwellable cards, Estonian with English under (Mikrofon, Kõneserver
with **Samas arvutis** / **Teises arvutis** and **Proovi ühendust**, Proovi with an armed demo box,
Hääl, Valmis). "ava juhend", "alustamine", "setup", "open the guide" reopen it (rules only); the
toolbar icon's right-click menu has Alustamine, Seaded, Abi (Abi opens `help.html` when lane HELP's
page is in the build, else the extension README on GitHub). While listening the extension never
gives up on the server: it tries again after 1, 2, 4, then every 5 s, says once "Kõneserver ei
vasta. Palu abilisel see käivitada (npm run dev)." (local address) or the hosted line, and once
"Server vastab jälle." when it is back; the microphone reopens by itself. A dot on the microphone
square shows the connection (green Ühendatud, amber Ühendan, red Server ei vasta).

Checkpoint 2: a cookie bar or dialog of the page's own under the strip folds that tab's strip to the
pill ("Riba on peidus, kuni leht küsib.", top-right when the layer covers the corner) and it comes
back by itself; his own "peida riba" wins. Proof: suite case `strip-consent` (fixture
`real-consent.html`, the pointer clicks "Nõustun", bar back in 432 ms), `docs/proof/r9-strip-consent.png`,
and `scripts/real-pages.ts youtube ilmateenistus`: both accept buttons "the pointer clicked it".

Proof: suite cases `welcome`, `welcome-server`, the connection dot and the menu in
`extension/test/run.ts` (ALL PASS); `docs/proof/r9-welcome.png`, `r9-welcome-server.png`,
`r9-strip-connection.png`; vitest "server down|server back|hosted" and "juhend|alustamine";
`UTLE_REAL=1 npx tsx extension/test/voice.ts` ALL PASS and `voice.ts down` (local line once, back
line once, no toggle).

Not verified: a real helper doing the first run; the install flow of branded Chrome from the Web
Store (only the unpacked load and Playwright's fresh profile were run); the dot while not listening
shows the last status check and is not polled, so a server that dies while idle stays green until
the next listen. Step 3's "a final landed" is "the words stood still for 1 s", not a signal from
the engine.

## 1k. Round 9, HELP lane (2026-10-27): what can I say, inside the product

Spec `docs/ARCHITECTURE.md` 30.2. Every phrase lives in one source, `src/core/phrases.ts`: 14 groups
(Sõnumid to Abi), 113 entries, 240 Estonian forms, each with its English form and a one-line meaning
in both languages. `src/core/phrases.test.ts` runs every form through the rule the entry names, so a
phrase that drifts fails the gate. "abi", "mida ma öelda saan", "näita käske", "help", "what can I
say" open `extension/help.html` (rules only); "abi kerimine" opens one group; a one-word "abi" with
words in the box is typed. The page is dwellable cards, the open group under them, the strip mounted;
"loe ette" reads the open group, "näita numbreid" numbers its cards and the settings page's buttons
(the worker's own-pages list is newtab, options, help; welcome joins the same way). "Ei saanud aru"
now ends "… või ütle „abi“."; the new-tab examples come from the source. `extension/README.md` "What
to say" is generated by `npx tsx scripts/phrases-doc.ts` (`--check` compares). Not verified: a real
voice saying any of it, the reading with a real Estonian voice (the suite's speechSynthesis is fake),
an eye tracker on the cards. The README had "kolm üheksa null kaks üks null null null null üks" for
39021000001, one "null" short; the source has the right eleven digits.

## 1k-SHIP. Round 9, SHIP lane (2026-10-27): the store packet, everything but Ralf's click

Spec `docs/ARCHITECTURE.md` 30.6. `npm run ext:pack` writes `extension/out/utle-0.4.0.zip` (21
files: manifest, the six pages with `welcome.html` now in `PACKED_FILES`, `dist/`, `relay.js`,
`icons/`). Manifest 0.4.0, `description` Estonian then English in one string (108 characters, the
store's summary), `default_title` "Ütle: mikrofon sisse või välja". `docs/STORE.md` holds the
listing in both languages, every permission's justification, the data declarations, the privacy URL
(`https://utle.ee/privaatsus` answered on 27 October, so the DNS is live; the GitHub page of
`docs/PRIVACY.md` is the fallback) and "Ralf's ten minutes", the upload checklist. Five 1280×800
screenshots in `extension/store/` by `npx tsx scripts/store-shots.ts` (stand-in pages only).
`npx tsx scripts/pack-check.ts` unpacks the zip, loads it on a fresh profile: the welcome page
opens and "abi" opens the help page (`docs/proof/r9-pack-welcome.png`). `extension/README.md`
"Install on a locked computer" has route A (a helper loads the zip unpacked, Chrome or Edge) and
route B (the store link, once published); `site/index.html` has a "Paigaldamine" section with the
same two routes, **not deployed** (utle.ee deploys by hand from `site/`).

What Ralf must do: register the developer account (one-time fee) and upload, steps 1 and 9 in
`docs/STORE.md`; then put the store link into the README and the site and deploy the site. Not
verified: the dashboard itself (its fields were taken from the README's list and Google's current
form as known, not opened); whether the dashboard also requires a 440×280 promo tile (none made);
the unpacked zip on Edge and on a managed computer; a reviewer's reading of the `<all_urls>`
justification. Found, not fixed (outside the lane): the settings page's keyboard form is titled
"Klaviatuuriga (Tom)" / "By keyboard (Tom)" (`src/core/strings.ts` `formTitle`), a person's name in
a user-facing heading; the store screenshot of the settings page shows the Server section instead.

## 1k-MODEL. Round 9, MODEL lane (2026-10-27): one door to any model, cost per completed task

What works: every model call goes through `server/model/` (ARCHITECTURE 30.5). `UTLE_MODEL` takes
`provider:model` (bare ids stay Anthropic), `UTLE_FALLBACK` names a second model asked only after a
fast failure, never after a timeout; `/api/status` says `model: { primary, fallback, last }`.
Answers carry `usage`, the server log gains `in= out= cached= provider=`, the engine emits one
`[spend]` record per task (done, stopped, unclear, cancelled, tookTooLong, rules) and the service
worker keeps the last 200 under `utle-spend`. `/api/interpret` uses `tool_choice: auto` now.
Proven by: 47 tests in `server/model/` (fakes only), `intent.test.ts` on a fake Model, the spend
tests in `engine.test.ts` and `spend.test.ts`, three dev-server starts on 5175 (the anthropic form,
the bare form, and `deepseek:` without its key refusing to start with the variable named), one live
ask showing `last: primary`, and the eval on `anthropic:claude-sonnet-5-5` at 2026-10-27 08:06 UTC:
63 / 78 passed before the default-model fixes; after them (ARCHITECTURE 30.5.6: two wrapped shapes
lifted, three prompt lines, a guard against repeating a failed click, five cases widened or
corrected) Sonnet passes 77 / 78 at $0.0057 per completed task, p50 1.6 s, and Opus 77 / 78 the same
hour (the plan's checklist, row 1). Not verified: anything on DeepSeek or a second host (lane C, needs
Ralf's key); the `thinking: { type: 'disabled' }` field is from third-party docs, not a live call;
the DeepSeek peak hours in `scripts/prices.ts`; the `utle-spend` ring in a real Chrome (the ring
logic is tested, the service-worker write is not).

## 1l. Round 10, prompt 1 (2026-10-27 evening): the fail-closed speaker gate (#3 A+B) and the measurement tools (#4)

Plan: `docs/plans/2026-10-28-round-10-testers-week.md`. Two lanes on Opus 5.5, each reviewed against the full diff
with the proofs re-run, two defect rounds each.

- **GATE (#3 A and B): PR #10, branch `r10-gate`, open, not merged (the issue's rule: Ralf reviews first).** Spec
  ARCHITECTURE 31. Typed `SpeakerDecision` per segment (8 reasons); with only-owner on, nothing speech-driven reaches
  the page, the model, the queue, wake or read-aloud without `verified_owner` for that segment, session and profile
  version. Continuity (round 7's 10 s promotion of short words) is gone. The server sends no unverified words (a wordless
  `activity` instead of partials) and closes every signalled utterance with a final or a rejection; Soniox with
  only-owner on rejects everything (`model_unavailable`) until package E. Real-model proof: `UTLE_ONLY=onlyowner
  UTLE_REAL=1 npx tsx extension/test/voice.ts` (stand-in owner profile in a temp `UTLE_DATA_DIR`): owner long 0.818
  verified, strangers 0.068 to 0.388 rejected, owner "jah" (0.3 s of speech) insufficient_audio, judge 48 to 119 ms.
  UX change: only-owner on without a profile now denies everything (profile_missing). Not done: C to F.
- **MEASURE (#4): merged to `main` (47a7837).** `scripts/record.ts` (12 enrolment phrases first, then 31 prompts;
  consent text is a DRAFT for Ralf), `label.ts`, `wer.ts` (TalTech, Soniox), `speaker-calibrate.ts --labels --models
  all` (four models, buckets on seconds of speech, profile from enrol clips, FAR-target operating point), `latency.ts`.
  Tables in `docs/proof/r10-measure.md`, synthetic only. Proving FAR at most 1 % needs about 381 stranger clips; three
  people recording will not reach it, so real numbers will rank models, not certify the target.
- Pre-existing on main, found here: a one-word utterance right after another voice can end with a partial and no
  final (the recogniser's text empties at the endpoint). Closed in only-owner mode by GATE; off mode unchanged.

## 1m. Round 10, prompt 2, lane VOICE (2026-11-02): onboarding starts with the voice (#3 D + C's safe retry)

Branch `r10-voice` (stacked on `r10-gate`), not merged. Spec ARCHITECTURE 31.7.

- Enrolment phrases are quality-checked (at least 0.8 s of Silero speech, RMS 0.02, at most 0.5 % clipped) and
  asked again with a plain reason; a flush residue with no recognised words is no phrase attempt. The candidate is
  made from N − 2 phrases and verified on the last 2; only a passing one replaces the profile (`.part` + rename).
- Format-2 profile: embedding, model id + SHA-256, phrase count, quality numbers, threshold policy with provenance,
  held-out scores, timestamps; no audio, no text. Round-7 files are `needs_retraining`. A factory-sourced profile is
  judged at today's `FACTORY_THRESHOLD`, so recalibrating it from real recordings reaches existing testers.
- Readiness (`ready | no_profile | needs_retraining | model_unavailable | model_mismatch`) on every connection and in
  `/api/status`; protected only when ready. Welcome starts with the voice; settings keep test, delete, re-enrol, off.
  `insufficient_audio` asks for the longer form ("ütle pikemalt: „saada sõnum“ või „jah, kinnitan“").
- Real model, SYNTHETIC voices (`UTLE_ONLY=onlyowner UTLE_REAL=1 npx tsx extension/test/voice.ts`, enrolled over
  the wire from `scripts/fixtures/enrol-set`, TartuNLP "mari" reading the twelve phrases): 12 of 12 phrases accepted,
  profile from 10, held out 0.773 and 0.813 at 0.54; voice test on the verify sentence recognised 0.855; owner long
  0.845 and 0.828 verified; vesta 0.339, kalev 0.09, mari pitched +20 % 0.424 rejected; owner "jah" (0.3 s)
  insufficient_audio. Not a real voice; no threshold is picked from this.
- Recording people is the three commands in `extension/README.md` ("Recording people for the speaker model");
  `record.ts --fake-mic` runs mark the folder `FAKE-MIC.txt` and the table then says SYNTHETIC. Waiting on: the
  consent text (issue #9), then Ralf and two partners recording.
- Dry run of those commands with the fake microphone (SYNTHETIC: mari from `enrol-set`, vesta and kalev from
  `speaker-set`, `--auto 4`): 75 clips, `label.ts --check` ready (owner enrol 12, owner trials 13, other trials 50),
  calibrate banner SYNTHETIC (fake microphone), all buckets: titanet-small EER 0.0 % at 0.545, eres2net 0.0 % at 0.543,
  campplus 46.1 %, resnet34 38.2 % (n = 13 owner / 50 other: ranks nothing, verifies nothing).
## 1n. Round 10, prompt 2, lane LISTEN (2026-11-01): the bar shows only speech meant for Ütle

Branch `r10-listen` (on `r10-gate`). ARCHITECTURE 32, LIMITED (text, not acoustic; #2 stays open for a
keyword spotter). Wake mode: PASSIVE / ACTIVE / HARD_OFF, the word anywhere in a sentence, glued
"ütlemine youtube'i" split, nothing of the room on the strip (a count instead); not started with a
hosted server or Soniox. Always-on: a sentence no rule knows goes to /api/addressee; "ignore" is never
shown or typed and never touches a running chain. Verified with tests, 16 eval cases (16/16, p50 1.3 s)
and synthetic voices through the real models (voice.ts section 8). Not verified: real voices, a real
room, a TV; the false-wake rate on room speech that contains "ütle" (only the owner's gate guards it).

## 1o. Round 10, FAST lane (2026-11-02): two models, endpointing per mode, acting on a pause (#7)

ARCHITECTURE 33. Built: `UTLE_MODEL_CAREFUL` (33.1), command 0.6 s and dictation 1.0 s endpointing told on the wire
(33.2), the server's `pause` and the early release of a rule-matched partial with only the owner off (33.3), and the
timed scroll (33.4): "keri alla kaks minutit", "keri üles 30 sekundit", "keri alla minut aega" scroll slowly for that
long, the strip says so while it runs and "Kerimine lõppes." after, "stopp", "aitab" and "katkesta" end it at once.

Checkpoint 2: a client that never says its endpoint mode keeps dictation (1.0 s), so the dev page and `npm run smoke`
behave as before; only the extension (which always says) gets 0.6 s for commands, and `scripts/latency.ts` says
command before each clip. An Anthropic `UTLE_MODEL_CAREFUL` without `ANTHROPIC_API_KEY` while the quick slot can
answer now stops the start naming the variable. Gate: `npm run check` 56 files, 4114 tests. Browser suite
(`npx tsx extension/test/run.ts`): 326 PASS, 0 FAIL, the two timed-scroll checks among them. On the way it failed
three runs in a row on "wake: ... &wake=": choosing wake mode starts making the listening document with the default
word, and a word saved before that document existed was lost (`ensureOffscreen` handed back the document already
being made). It now looks again once that document is there (`extension/src/background.ts`).

Eval, `npx tsx scripts/intent-eval.ts`, 94 cases (78 intent, 16 addressee), each run twice. Logs and JSON in
`artifacts/fast/` (not committed).

| run | model | pass | asks per task | $ per completed task | p50 / p95 ms |
|---|---|---|---|---|---|
| sonnet 1 (base 2bb7398) | anthropic:claude-sonnet-5-5 | 94/94 | 1.17 | $0.00493 | 1889 / 2818 |
| sonnet 2 (base 2bb7398) | anthropic:claude-sonnet-5-5 | 94/94 | 1.17 | $0.00466 | 1818 / 3385 |
| haiku+opus 1 | anthropic:claude-haiku-5-5 (quick) | 82/88 | 1.03 | $0.00025 | 1384 / 2768 |
| | anthropic:claude-opus-5-5 (careful) | 6/6 | 3.17 | $0.02713 | 2682 / 7218 |
| | all | 88/94 | 1.17 | $0.00208 | 1552 / 4110 |
| haiku+opus 2 | anthropic:claude-haiku-5-5 (quick) | 83/88 | 1.03 | $0.00023 | 1343 / 2384 |
| | anthropic:claude-opus-5-5 (careful) | 6/6 | 3.17 | $0.02698 | 2553 / 6336 |
| | all | 89/94 | 1.17 | $0.00203 | 1472 / 3909 |

Haiku misses in both runs: "kolmas video" (www.youtube.com, clickItem 6 for 5), "recovery: not on the page, scroll
once, then search" step 2 (www.youtube.com, scroll for siteSearch), "saada ära" (web.whatsapp.com, unclear for
send). In one run only (noise): "tagasi", "puhka" (chrome://newtab), "kommenteeri" (www.facebook.com, cut at 400
tokens), "tulen homme kell viis", "homme asemel täna". Defaults stay Sonnet 5.5.

Latency, `scripts/latency.ts`, SYNTHETIC, 18 clips. Before (base 2bb7398, 10:05 UTC, Sonnet):

| stage | n | p50 ms | p95 ms |
|---|---|---|---|
| speech end -> final | 18 | 1675 | 2104 |
| final -> intent, rules | 16 | 5 | 24 |
| final -> intent, model | 2 | 2036 | 2143 |
| intent -> action, page | 17 | 163 | 423 |

After: NOT MEASURED. Two attempts failed for reasons outside the code: the first hit the base server still running
from the before run (it had hot-restarted on every server edit and loaded the speech model five times); the second
ran on a machine at 76 % CPU from two old `chrome-headless-shell` processes nobody in this lane started, where the
decoder fell more than 1.5 s behind, dropped audio ("keri natuke alla" heard as "keri") and the page timed out. The
fall in speech end -> final and the model stage on Haiku need one clean pair of runs, base and branch back to back.

Checkpoint 2, C7, measured 2026-11-02 15:41-16:05 after Ralf stopped the two runaway `chrome-headless-shell`
processes (none left). SYNTHETIC, 18 clips of `scripts/fixtures/labels.tsv`, vite on 5193, one server at a time,
logs and JSON in `artifacts/fast/cp2/` (not committed). Speech end -> final, p50 / p95 ms:

| run | tail before flush | n | speech end -> final | rules | model | page |
|---|---|---|---|---|---|---|
| base (main 2bb7398, main's script) | 1.5 s | 18 | 1698 / 2105 | 4 / 101 | 2746 / 3310 (n=2) | 169 / 437 |
| branch, command, Sonnet | 1.5 s | 18 | 1702 / 2040 | 5 / 23 | 3241 / 4317 (n=2) | 173 / 434 |
| branch, dictation, Sonnet | 1.5 s | 18 | 2008 / 2958 | 6 / 97 | 3047 / 3559 (n=4) | 377 / 768 |
| base (main's server, branch script) | 3 s | 18 | 1704 / 2286 | 4 / 22 | 2589 / 2710 (n=2) | 166 / 444 |
| branch, command, Sonnet | 3 s | 17 | 1678 / 3045 | 12 / 61 | 2665 / 3293 (n=2) | 186 / 603 |
| branch, command, Haiku | 3 s | 18 | 1668 / 1954 | 5 / 31 | 2839 / 2851 (n=2) | 176 / 452 |

The fall in speech end -> final p50 is NOT the 300 ms the brief asked for: 4 ms worse at the 1.5 s tail, 26 to 36 ms
better at 3 s (p95 330 ms better in the Haiku run, 760 ms worse in the Sonnet run). Dictation is 306 ms slower than
command on the same server, so the mode reaches the decoder. Why the command gain does not show: (1) the
recogniser's last word arrives late. A probe (`artifacts/fast/cp2/probe.ts`, "keri natuke alla") saw the first
pause 810 ms after the speech end with "keri natuke all" and the whole last word only at 1078 ms; the final came at
1763 ms (command) and 1984 ms (dictation). The trailing silence is counted from the last token, so its emission
delay comes first and the endpoint saving is a fraction of the total. (2) At the recipe's 1.5 s tail the flush ends
the base's slower utterances before its 1.0 s endpoint fires, so the base is capped (hence `--tail`). (3) Noise:
the two branch runs at 3 s, same server code, differ by up to 1.3 s on a single clip, so 18 clips cannot resolve
300 ms. The model stage on Haiku: 2839 / 2851 ms (n=2, "Jah" and "Üks"), no faster than Sonnet here (Haiku thinks
before the tool call, 33.1). Not done: more clips or repeated runs, and a look at the decoder's emission delay.

Planner's review (2026-11-02, the same JSON paired clip by clip, 3 s tail): base minus branch is a median of
-268 ms (the branch slower) against the Sonnet run and +11 ms against the Haiku run; and the base's "saada" finals
came 797 to 1035 ms after the speech end, under the 1.0 s rule 2 itself, so on these clips the final is not made by
rule 2 alone. What does make it (the speech detector's end, the flush, the decoder's backlog) is not known. Criterion
7 is NOT MET; #7 stays open and finding what produces the final comes first in round 10 prompt 4.

## 1q. Round 10, prompt 4, lane LATE (2026-11-02): why the final came late, and a command final about 0.5 s sooner (#7)

Merged in 8133773; #7 closed. The lane's `artifacts/` (not committed; every `artifacts/late/...` path below) moved
with its worktree's removal to `C:\Users\ralfs\utle-artifacts\2026-11-02-r10-late\`.

ARCHITECTURE 33.2 and 33.3. Branch `r10-late`: 8ceced7 (each final's why, no behaviour change: main 6ccff92 plus the
measurement) and 381ce67 (the fix). SYNTHETIC: the 18 clips of `scripts/fixtures/labels.tsv`, TartuNLP voices.

**What made the final.** `scripts/latency.ts --why` and the server's `[asr] final cause=...` line (timings and a cause,
never words) give, per final, which rule ended it and where each stage stood on the session's audio clock. Load cannot
move that clock: the server's numbers equalled the in-process probe (`artifacts/late/probe.ts`) clip for clip. On main
all 18 finals were made by rule 2. None came from rule 1, rule 3, the flush (3 s tail) or a backlog cut: 0 ms dropped,
and the server ran within 25 ms of real time. Rule 2 counts its 0.6 s from the recogniser's last token. The model puts
that token 320 to 540 ms after a multi-token command's speech end, and 680 ms before to 80 ms after a one-token word's.
The encoder decodes 640 ms chunks, each once about 200 ms more audio is there. So on the audio clock: multi-word
command finals came 1620 to 1940 ms after the speech end, one-token words 780 to 1140. The speech detector's end lay
36 to 260 ms after the -40 dBFS end. The "saada" finals under 1.0 s on 2bb7398 are explained: its token comes 180 to
680 ms before the speech ends, so even 1.0 s counted from it ends 320 to 820 ms after the speech.

**What changed.** Once the speech detector has heard the mode's silence (0.6 s command, 1.0 s dictation, counted from
Silero's own end of the segment), the decoder hands the recogniser the hiss it would have got anyway, as fast as it
decodes, until the recogniser's own rule ends the utterance. The cause is `detector`, with at most 2 s of hiss per
utterance; the 18 clips needed at most 1.3 s. The words are the recogniser's own: the same on every clip in every run.
Without the detector model nothing changes.

Three runs each, interleaved base/branch, one fresh vite on 5178 per run, `--tail 3000 --why --asr-only`, command
mode, under the suite lock. CPU was 26 to 77 % from another lane's eval, logged per run in
`artifacts/late/runs/pids.log`. Speech end -> final (wall), ms:

| run | base p50 / p95 | branch p50 / p95 | paired base - branch, p50 (min, max) | audio p50 base / branch | WER base / branch | branch causes |
|---|---|---|---|---|---|---|
| 1 | 1457 / 1932 | 872 / 991 | 519 (-71, 1180) | 1380 / 800 | 1/33 / 1/33 | detector 15, rule2 3 |
| 2 | 1441 / 1912 | 921 / 988 | 509 (-98, 1069) | 1380 / 800 | 1/33 / 1/33 | detector 15, rule2 3 |
| 3 | 1442 / 1917 | 880 / 993 | 534 (-12, 1084) | 1380 / 800 | 1/33 / 1/33 | detector 15, rule2 3 |

Over the three runs the paired difference is p50 516 ms (n=54, p25 98, p75 861); the three runs' p50s spread 25 ms.
Multi-word commands gain 700 to 1200 ms. One-token words gain 0 to 300 ms: three of them ("saada" of kylli, meelis,
vesta) are still ended by rule 2 before the detector's 0.6 s, and they cost at most 98 ms in the wall noise. The one
WER error is the same in all six runs ("Näita numbrid" for "numbreid"). Dictation, on the audio clock (probe, both
codes): main 1180 to 2340 ms after the speech end, branch 1040 to 1280, and never under 1.0 s of the detector's
silence. Tables per clip: `artifacts/late/three-runs-command.md`; runs: `artifacts/late/runs/` (not committed).

Not verified: a real voice and a real microphone (room noise that Silero takes for speech would cost up to 2 s of
extra decoding once per utterance, never a final); dictation in wall time (audio clock only); an idle machine. The
hiss decode costs one or two chunk decodes at an utterance's end: 57 ms p50 in one probe run, about 300 ms in another
while another process loaded the CPU. The three runs were measured under 26 to 77 % CPU from another process; an idle
machine was not measured.

**Pauses inside a command (review round 1).** `artifacts/late/splice.ts` puts 0.5, 0.7, 0.9 and 1.2 s of silence between
two words of three clips (cut where the energy envelope is quiet), decodes them with the speech detector in command
mode, passes the finals through the client's 700 ms hold (`LOCAL_HOLD_MS`: an instant final goes at once, any other
waits for the next speech) and the real `inpageStep`. The hard splice makes some misreadings ("kerina Toom",
"Järgmine vastu"); they are the same in both codes. Main gave one final up to 0.7 s. At 0.9 and 1.2 s it gave two
finals, and the hold joined them again: its first final came about 1.2 s after the first piece, so the second piece's
first partial fell inside the hold. The branch gave one final at 0.5 s. From 0.7 s it delivered two utterances: its
first final now comes about 0.6 s sooner, while the second piece's first partial still lags its speech by about 0.6 s
(the same chunk and token delay). On the rules alone, "keri", "keri natuke", "alla", "näita" and "numbreid" each go to
the model, and "natuke alla" scrolls. So "keri | natuke alla" with a 0.7 to 1.2 s pause becomes a model question plus a
scroll on the branch, where main makes one rule scroll. "keri natuke | alla" and "Näita | numbreid" become two model
questions instead of one rule action. "järgmine" alone is instant in both codes (it switches tab), so main splits
"Järgmine | vaheleht" too once the recogniser does. Not fixed in this round; a fix is proposed to the planner. Output:
`artifacts/late/splice-main.txt`, `splice-branch.txt`, `pieces.txt` (not committed).

**Review round 2: both proposals built** (f7680f8, 0753ded). (A) After a detector-ended final the recogniser skips as
much arriving not-speech as it decoded ahead, so nothing is decoded twice; speech is never skipped. (B) The server
sends the wordless `{ type: 'activity', onset: true }` when the detector hears speech start, in both modes. The client
holds a held final `ONSET_HOLD_MS` (1.2 s) from it, once per final. A 700 ms restart was tried first and still split
0.7 and 0.9 s pauses, because the resumed words come up to about a second after the onset. The tests were red first
(`artifacts/late/red-review2.txt`).

- Pauses (`artifacts/late/splice2-main.txt`, `splice2-branch.txt`, same clips and cuts as above): at 0.7, 0.9 and
  1.2 s every spliced command now arrives as ONE utterance on the branch, as on main.
- Hold bound: a partial with words restarts the hold with no cap on both codes. An onset without words holds a final
  at most 1.9 s after it on the branch, against 0.7 s on main (test "bounded" in `src/speech/local.test.ts`).
- Latency, one more interleaved round at 31 to 34 % CPU (`artifacts/late/round-r2-command.md`): base 1401 / 1914,
  branch 864 / 937. The paired p50 is 502 ms (min -51, max 1179), words were identical on all 18 clips, and WER was
  1/33 in both.
- voice.ts on the branch at 24 % CPU (`artifacts/late/voice-r2.log`): 53 PASS / 2 FAIL. Sections 6, 7 and 8 passed
  26 of 26 with 0 s dropped. The 2 FAILs ("box texts", "first words") are among base's 3 section 1 FAILs; the hover
  check passed this time.
- `npm run check`: 59 files, 4231 tests. Browser suite: 330 PASS, ALL PASS.

**voice.ts on base and branch (review round 1).** Run back to back under the lock on vite 5194 (5193 was held by another lane's vite): base 2edb8b5 gave 52 PASS / 3 FAIL, the branch 51 PASS / 4 FAIL. The three section 1 FAILs ("hovering the microphone 1.3 s turns listening on", "at least 3 distinct box texts", "first words visible while speech is still playing") fail on base too: they predate this lane. Sections 7 and 8 passed 18 of 18 on both. The branch's fourth FAIL, section 6 "üks opens the first tile", came with the CPU at 100 % (model load 25.7 s). The server's backlog dropped 5 s of that session's audio, "üks" among it. Base, at 76 %, dropped 1 s and lost nothing; the branch's earlier run (18:07) dropped nothing and passed section 6. The hiss handed ahead is decoding on top of the real-time frames (up to 1.3 s of audio per utterance), so on a starved machine it can add to the backlog. Not fixed here; a fix is proposed to the planner. Logs: `artifacts/late/voice-base.log`, `voice-branch.log`, `voice.log`; the server's lines in `artifacts/late/vite-5193-base.log` and `vite-5193-branch.log` (not committed).

## 1p. Round 10, prompt 3, lane AMBIGUITY (2026-11-02): what he meant, on the page he is on (#5)

Branch `r10-ambig`. ARCHITECTURE 34. From Ralf's session of 2026-10-27 (logging into the Anthropic
console): "ava email" now opens his mail beside a login or form in progress, never over it (it was the
place rule, which never asked the model; the engine now turns every goTo into newTab while the page in
front is a login, a verification, a password or code field, or unsent words); the model hears his last
three commands, what ran and whether it worked, and the tab he came from, so "ava see uues vahelehes"
opens the thing just opened and "mine tagasi sinna kus ma olin" goes back to that tab; readPage lists a
link styled as a button as a button, with its colour ("vajuta musta nuppu"); "kinnita" outside a
one-line field is the page's confirming button, not Enter; a tie asks "Kumb: 1 …, 2 …?" and "üks" or
"kaks" answers it.

Intent eval, `anthropic:claude-sonnet-5-5` (the default), 89 intent cases (78 old, 11 new) and 16
addressee cases, each run twice:

| run | pass | asks per task | $ per completed task | p50 / p95 ms |
|---|---|---|---|---|
| before 1 (new cases, old prompt) | 99/105 | 1.15 | $0.00521 | 1995 / 4200 |
| before 2 | 99/105 | 1.15 | $0.00493 | 1968 / 3410 |
| after 1 | 103/105 | 1.14 | $0.00495 | 1905 / 3135 |
| after 2 | 105/105 | 1.15 | $0.00497 | 1872 / 2972 |

Before, in both runs, six new cases missed: "ava gmail" on the console's login (goTo, the login lost),
"ava see uues vahelehes" twice (unclear), "vajuta musta nuppu" (showHints), "mine tagasi sinna kus ma
olin" after a tab change (history back), "lisa korvi" with two equal buttons (clicked the first); the old
94 passed, "puhka" included. After: all 11 new cases pass in both runs; the old ones 94/94 and 92/94,
the two misses in one run only (noise): "ava sport" (the model took over 7 s, a timeout) and "täida
telefon" step 1 (done true where false was wanted). Logs: `artifacts/eval-before-*.txt`,
`artifacts/eval-after-*.txt` (untracked).

Not verified: the real Gmail and the real console logged in (why "ava esimene kiri" took two tries on
the real Gmail is not known; on the stand-in and in the eval it is one click), a real voice.

Defect round 1 (review): open beside fired on ordinary pages. The first rule matched its words anywhere
in the url and the title, inflections included, so a Delfi article "Riigikogu kinnitas eelarve", an ERR
headline "Officials confirm deal", a YouTube video "How to sign up for a gym" and a blog "Blogin
igapäevaselt" all turned "ava youtube" into a new tab he cannot close by hand. Now (ARCHITECTURE 34.3)
the url counts only by a login host label (accounts., login., auth., sso.) or a whole path segment that
is a login word (/login, /signin, /signup, /verify, /login.php, #/signin), never a word inside a slug;
the title only when one of its parts starts with a whole-word login phrase ("Log in - Anthropic",
"Facebook – log in or sign up", "Kinnita tellimus"). The prompt's "Open beside" says the same; a new
eval case "ava youtube" on the Delfi article wants goTo (106 cases):

| run | pass | asks per task | $ per completed task | p50 / p95 ms |
|---|---|---|---|---|
| after fix 1 | 106/106 | 1.15 | $0.00503 | 1824 / 2721 |
| after fix 2 | 105/106 | 1.15 | $0.00506 | 1866 / 3047 |

The one miss is in one run only: "kommenteeri" on the Facebook stand-in answered choose (the tie
question) where focusItem of the comment field or clickItem of the Kommenteeri button was wanted. The
old prompt already answered goTo on the Delfi page (2 of 2), so the fault was the engine's rewrite; the
prompt change keeps the two in step. Logs: `artifacts/eval-defect1-run*.txt` (untracked).

readPage cost (`scripts/readpage-timing.ts`, page.ts bundled at 2bb7398 and at the branch, timed inside
Chromium, fresh load per run). The first version of the button rule read the whole textContent of a
link's parent for every link, quadratic in a list: 2,000 links under one parent took 1,382 ms against
189 ms (7.3x), 2,000 list rows 347 ms against 164 ms (2.1x). The parent walk now stops at the first
sibling with text or a link, and an unfilled link skips its innerText. After, median of 15:

| page | items | base ms | branch ms | branch / base |
|---|---|---|---|---|
| real-delfi.html | 4 | 2.9 | 3.5 | 1.21 |
| real-postimees.html | 12 | 3.2 | 3.7 | 1.16 |
| 2,000 links in one div | 120 | 183.2 | 202.3 | 1.10 |
| 2,000 list rows | 80 | 161.6 | 164.0 | 1.01 |

On the two small fixtures the difference is about half a millisecond, inside the run-to-run spread
(five-run medians of the same code gave 1.10 to 1.58 on Delfi). Logs: `artifacts/readpage-timing-*.txt`.

Defect after integration (round 2): on the merged main "kommenteeri" on the Facebook stand-in came back
as a choose (the tie question) in 2 of 5 runs, a question where the comment field was wanted. A tie is
now two items of the same kind by rule in `pageIntentFrom` (ARCHITECTURE 34.4): a choose over two items
of different roles runs the first id, focusItem for a field and clickItem otherwise, and asks nothing;
two buttons ("lisa korvi") or two links ("Kumb: 1 Ava, 2 Ava kiri?") still ask. The prompt's tie line
says the same. Eval on r10-ambig, Sonnet, 106 cases: 105/106 ($0.00538 per completed task, p50/p95
1890/3036 ms) and 106/106 ($0.00504, 1909/3289 ms); "kommenteeri" focusItem 6 in both. The one miss,
run 1 only: "recovery: not on the page, scroll once, then search [2/2]" on YouTube answered scroll down
where siteSearch was wanted (2 of 7 runs since the round 10 prompt). Logs: `artifacts/eval-round2-*.txt`.

## 1s. Round 10, prompt 5, lane LIVE (2026-11-02): why voice.ts section 1 was red; the test, not the product

`UTLE_REAL=1 UTLE_ONLY=dictate voice.ts` (section 1, real model, the chat fixture in the toggle mode) failed
"1. at least 3 distinct box texts before the final one" (`0: []`) and "5. first words visible while speech is
still playing" on main since round 10 prompt 2. Reproduced: 7a5ce7c ALL PASS (box previews at -711 ms, final
in the box 1021 ms after the sentence), 8c7b705 the same 2 FAILs (box empty until the whole sentence, 2793 ms
after it; the strip changed 4 times during the sentence).

Bisect (section 1 per step, under the suite lock; a hover miss would have been a skip, none happened):
first-parent 7a5ce7c..8133773 named the merge f9c8c69 (round 10 prompt 2, VOICE and LISTEN); inside it,
bf70016..3c31dbc named **b052456** `fix(#6, review 1): ... no box preview before a verdict ...` (85b6148 good:
three box previews, then the final 1640 ms after the sentence; b052456 bad: the box's first text is the whole
sentence 3981 ms after it; both runs `[addressee] verdict=dictation` 1441 / 1849 ms).

Cause, one sentence: lane LISTEN's review 1 made the toggle and always-on modes stop typing partials into the
box on purpose, so a voice in the room is never typed into his message before the addressee check answers
(engine.ts: the addressee wrapper's `onInterim` publishes `heard` and no longer calls the inner `onInterim`;
ARCHITECTURE 32.3: "Partials are shown on the strip (his only live feedback) and never previewed into the box:
dictation lands with the final and its verdict, not live"). Class: **test**. Section 1 still checked the round 3
contract. The product does what 32.3 says; 31.2 (only-owner, no unverified word anywhere) is untouched.

Fixed: section 1 now checks "1. no words previewed into the box: its first text is the whole sentence (32.3)"
and "5. first words on the strip while speech is still playing (32.3)"; `inpage-live.png` is taken when the
strip's words change, not the box's. New engine test "round 10 prompt 5 (LIVE): his own dictation in the toggle
mode is live on the strip only; ..." (red with the pre-b052456 `onInterim`, `artifacts/live/unit-red.log`;
green on main). README's WhatsApp line said the words appear in the box as he speaks; it now says what he sees:
the strip live, the sentence in the box about three seconds after his last word (wake mode ACTIVE still types
live; only-owner shows nothing until his voice is confirmed). Header of voice.ts names `UTLE_ONLY=dictate`.

What it costs him, measured: the box gets his words 2.7 to 3.3 s after he stops on main over five runs (2729,
3332, 3161, 3348, 2909 ms; one run on b052456: 4.0 s), the addressee check 1.4 to 1.8 s of it, where round 9
typed them while he spoke. Every dictated sentence in a chat box is asked (`probe` uses `SEND_PROBE_BOX`, never
a document, so `documentAsks` is true). Section 1 now bounds it: "5. the sentence lands in the box within
4500 ms of its end (32.3)", N = 4500 for about 1.2 s of headroom under load and below the server's
`ADDRESSEE_TIMEOUT_MS` (5000), so a verdict that only comes at the timeout fails the check. That is 32.3's
trade, not a fault here; if testers find it slow, the place to change is 32.3, not the test.

The hover check ("4. hovering the microphone 1.3 s turns listening on") that fails in some runs: the first hover
of a session makes the offscreen document (count 0 before, 1 after, in every run), and that has to fit in the
300 ms the check leaves after the 1000 ms dwell. Five runs of section 1, CPU before each (the other lane's
work loaded the machine): listening came on 1240, 1115, 1267, **1685** and 1157 ms after the pointer reached the
microphone, at CPU 57-90, 28, 77-96, **88-99** and 80-99 %. Only the run at 88-99 % missed. Not a product fault
in the hover (the dwell fires at 1000 ms); a margin the machine's load eats. Section 1 now logs the `HOVER:`
line, so a miss says by how much. After the fix: full `UTLE_REAL=1 voice.ts` 55 PASS, ALL PASS (sections 1, 2,
6, 7, 8); `npm run check` 60 files, 4238 tests; `run.ts` 330 PASS, ALL PASS.

Logs: `artifacts/live/` in the worktree (good-7a5ce7c, main-8c7b705, bisect-*, bisect-firstparent.log,
bisect-inner.log, hover-1..5, full-voice, suite).

## 1u. Round 10, prompt 6, lane QUICK (2026-11-02/03): where his dictated sentence's 3 s go; the early ask saves 0.18 s; the check is the rest

Method: epoch stamps on the server's `[asr] final ... at=` and `[addressee] ... at=` lines and voice.ts section 1's
`STAGES:` line (no words), `artifacts/quick/stages.py` sets them side by side. Runs under the suite lock, CPU logged
before each (`artifacts/quick/*-outcome.log`); "before" builds the extension from main's engine and recogniser.

Final table (review 1, second agent, 2026-11-03 14:12 to 14:23): main and the final code interleaved, one run each
in turn, five pairs, all valid (CPU 16 to 36 % at start, 5.0 to 6.6 GB free); main's earlier five valid runs beside
them (before-2, 3, 5 and beforex-1, 2; before-1 and 4 stay void at 77 and 88 %). `python artifacts/quick/stages_sel.py`.

| stage (ms after his last word) | main p50 | main max | main, interleaved p50 | max | final p50 | final max |
|---|---|---|---|---|---|---|
| final leaves the server | 974 | 1107 | 907 | 933 | 939 | 977 |
| check request reaches the server | 204 | 212 | 204 | 211 | 23 | 28 |
| the check (Sonnet 5.5, quick slot) | 1606 | 2079 | 1705 | 1800 | 1625 | 2475 |
| verdict to the sentence in the box | 134 | 154 | 90 | 165 | 155 | 184 |
| landing | 2946 | 3485 | 2892 | 3072 | 2749 | 3575 |

Landings: main 2640, 3485, 3208, 2946, 2806 and interleaved 2840, 2961, 3072, 2892, 2865; final 3575, 2749, 2746,
2818, 2578 (and 3971 inside the full voice.ts run). The early ask saves the ask stage, 0.18 s, every run. The target
(p50 at most 2.0 s, max under 3.0 s) is NOT met: the check alone is 1.5 to 2.5 s and the final 0.9 to 1.0 s.

The check's call, by shape (R1; `artifacts/quick/shape.ts`, the 16 addressee cases back to back, all through
server/model/; `shape-table.md`): the 49 output tokens are the tool_use block alone (no text, stop tool_use).

| shape | verdicts | p50 ms | p95 ms |
|---|---|---|---|
| base (tool reply, effort low, max_tokens 400) | 16/16 | 1185 | 4548 |
| effort off | 16/16 | 1251 | 2460 |
| max_tokens 60 | 16/16 | 1162 | 2030 |
| one-word text reply (5 tokens) | 16/16 | 1351 | 3261 |
| JSON reply (14 tokens) | 16/16 | 1176 | 2684 |
| base, first call of a fresh process (6) | 6/6 | 1640 | 2622 |
| base, fresh process after a free count_tokens warm-up (4, `idle.ts`) | 4/4 | 1439 | 1861 |

None faster: the output's length is not the time. Idle gaps of 6 to 45 s in one process cost nothing measurable
(`idle.log`). A warm-up at server start (count_tokens) was built (53615b8) and timed in five section 1 runs: the
in-situ check stayed 1.68 to 2.91 s against main's 1.56 and 1.61 s in the same hour, so it was reverted (e63d2e5).
The in-situ check (1.5 to 2.5 s) is slower than the same call in the eval (p50 1.2 to 1.3 s) for a reason not found
here; the cold first call is not it.

Finding (review 1, the lost "saada" of the first agent's change run 2): pre-existing, not the early ask. The
recogniser heard "Et saada"; main's /api/addressee, asked with run 2's context (the sentence before, the chat
fixture, its box armed), answers ignore 5 of 5 (946 to 3040 ms), and "Saada" alone answers command
(`artifacts/quick/etsaada.log`). Class: a misheard send word goes to the model and is ignored. Owner: the rules or
the addressee prompt; not fixed in this lane. Section 1's check "1. no words previewed" also counted every box value
as a preview when nothing was sent: fixed red first (`scripts/boxLanding.ts`, 63b9da5).

On the final code the pause's early ask goes out in every section 1 run (5 of 5, verdict ignore, 1.1 to 1.6 s),
on the words before "saada" that the final does not keep; its answer is dropped unread and "saada" was sent in
all five.

Cost (R8, Sonnet 5.5 prices, scripts/prices.ts): main, two calls per dictated sentence (the check $0.00101, the
intent ask $0.00463 cached): $0.56 per 100 sentences, 200 calls. Final: the same two plus the early ask that the
final does not keep, 5 of 5 runs here: 300 calls, about $0.67 per 100.

Safety and gates on the final code (14:23 to 14:32, under the lock): voice.ts section 8 (`UTLE_ONLY=listen`) 6 PASS
0 FAIL; full `UTLE_REAL=1 voice.ts` 56 PASS 0 FAIL; section 1 check 1 PASS in all six runs; the 16 addressee cases
16/16 (p50 1304 ms, $0.018); `run.ts` ALL PASS; `npm run check` green, 61 files, 4246 tests (the 32.3 and 31.2
engine tests untouched). The bound (4500 ms) and README's "about three seconds" stay: the final's landings were
2.6 to 4.0 s (p50 2.75 s), still under 4500 and the server's 5000 ms timeout.

Review 2 (2026-11-03, ruling: the pause trigger goes). The pause's early ask (the paragraph above) cost a third
model call per sentence for no measured gain, so the early ask now starts only on the final's arrival (32.3,
bbc362f spec, 0d63db3 red, b3485e7 code; `src/speech/local.ts` onPause no longer calls `onStable`). Five section 1
runs on that code (14:52 to 14:57, CPU 24 to 43 % at start, 6.1 GB free, artifacts/quick/r2-*): landings 3042,
2729, 2411, 3819, 2634 ms (p50 2729, max 3819); stages p50 final 943, ask 31, check 1585, typed 81. One addressee
line and one intent line per run (5 of 5). Cost after: 200 calls per 100 sentences, $0.56, as main. Section 8:
6 PASS 0 FAIL; `run.ts` ALL PASS; `npm run check` green, 4246 tests.

Diagnostic (no fix): is the in-situ check (1.4 to 2.6 s) slower than the eval's (p50 1.2 to 1.3 s) because the
server's event loop is blocked while the reply waits? `artifacts/quick/looplag.mjs` (loaded into vite only, by
NODE_OPTIONS, not product) logged `monitorEventLoopDelay` every 250 ms; `loop_window.py r2`. Inside each check's
window the loop's delay peaked at 52 to 75 ms (Windows' timer floor is about 15 ms), against 1411 to 2595 ms
checks; the whole process (worker threads included) used about one core in that window (1171 to 2719 ms CPU).
At most about 60 ms of the gap is the loop: it does not explain it. Still open: the API's own time in the hour
and the first call of a fresh process (+0.2 to 0.45 s outside the product, not moved in situ by a warm-up).

## 1v. Round 10, prompt 6, lane EXIT (2026-11-03): the exit test (#9) rehearsed end to end on stand-ins

`UTLE_REAL=1 npx tsx extension/test/exit.ts` runs the whole path in a fresh Chromium profile: install, the real
welcome page, enrolment in a SYNTHETIC voice (twelve phrases), the voice test, only my voice, wake mode (LIMITED:
PR #11 is unmerged, so the wake word is the text alone), "Ütle, mine youtube'i ja otsi lastelaulud" with two room
voices (kalev before him, vesta over his end), YouTube's consent stand-in, the results, the WhatsApp stand-in, one
sentence dictated, "saada". The server is the real one in-process (TalTech's recogniser, TitaNet, the default
model); the microphone is a stand-in at the socket. Each run writes a timeline and a screenshot per step under
`artifacts/exit/<run>/` in the worktree (not committed); `artifacts/exit/runner.log` has CPU and free memory before
each run. This is the exit test's precondition, not the test: no person, no room, no real YouTube.

Runs (suite lock held, CPU 19 to 54 %, 6.5 to 6.9 GB free before each): v-1, v-2, v-3 at the brief's condition
(`UTLE_EXIT_OVERLAP_MS=800`), control-1 with vesta starting 2 s after his last word (`-1500`). The variable
overstates the overlap: vesta's file has 800 ms of silence before her speech and exit.ts subtracts 300, so at 800
her first word lands 300 ms before his last (scene line: his speech 5160-7340 ms, hers 7040-9700); the header now
says so. The first EXIT agent's runs (dbg2-1, r-1, r-2) agree with these; r-3 (91 % CPU) and dbg-1 (no network)
are void.

| step (ms from install, or after his last word) | v-1 | v-2 | v-3 | control |
|---|---|---|---|---|
| install: the welcome page opens | 1189 | 1205 | 980 | 1031 |
| microphone, server, enrolment (12 phrases) ends | 66790 | 66450 | 65086 | 66151 |
| voice test, only my voice, wake mode | PASS | PASS | PASS | PASS |
| YouTube opens (after his last word; only at his second saying, finding 6) | 7994 | 8446 | 8947 | 3642 |
| YouTube's consent first | PASS | PASS | PASS | PASS |
| results for "lastelaulud" | FAIL | FAIL | PASS | PASS |
| WhatsApp, Jaan Tamm's chat open (after his last word) | 6511 | 9837 | 9990 | 9775 |
| dictated sentence in the box (after his last word) | 1160 | 1681 | 1582 | 1728 |
| "saada": sent, his sentence only (after his last word) | 1985 | 2567 | 2500 | 2531 |
| the bar shows three room words in a row (samples) | 443/1826 | 568/2095 | 566/1831 | 0/1738 |
| enrolment: no phrase of his reading runs as speech | FAIL | FAIL | FAIL | FAIL |
| machine time | 194.3 s | 226.3 s | 196.9 s | 187.0 s |

Machine time is about 3 to 4 minutes, well under ten. The sent list is `["Tere, Jaan, ma jõuan homme kella
kolmeks."]` in every run: his sentence only. One-word "saada" was verified in v-1 and the control (0.578, 0.583);
in v-2 and v-3 it was `insufficient_audio` and "saada sõnum" sent it. Steps a person adds, not timed: reading the
helper's sheet; loading the unpacked extension; Chrome's microphone Allow; reading the twelve phrases at his own
pace; choosing wake mode; "Ütle, nõustu kõigiga" on YouTube's consent; "saada sõnum" when "saada" is too short;
saying the command again when nothing opens (every run, finding 6).

**FAIL: enrolment, his last phrase runs as a command (4/4).** The server sends `enrolled` before that phrase's
final: 66321/66363, 66031/66079, 64611/64652, 65681/65722 ms (enrolled/final), so the engine takes "Värskenda
lehte: mine edasi ja vaigista heli enne tööleminekut." as speech for Ütle. Class product; owner the server's
enrolment ordering (31.7, `takePhrase`/`finishScript` in server/asrSession.ts). A small lane after this merge.

**FAIL: the bar shows vesta's sentence (3/3 at the overlap, 0 in the control).** His final reads "Ütle, mine
Youtube, ei otsi lastelauda. Mul on vaja vanaemale helistada." and is verified as his (0.696 to 0.699), so her
words reach the strip and the model. The gap sweep (below) shows the recogniser joins her sentence into his final
whenever she starts within 300 ms of his last word, and splits from 600 ms; the control (2 s) never leaked. Class
product; owner the speaker gate's per-segment decision (31.2, #3) or the endpointer; issue-size. His message was
never touched: in the dictation scene the room was rejected every time (0.12 to 0.47).

**FAIL: the results for "lastelaulud" (v-1, v-2).** Two causes. First (finding 5, new): the model's plan opened
youtube.com and then ran `siteSearch` while the consent covered the page; the field is in the stand-in's DOM, but
`searchField()` (page.ts) only takes a `visible()` field, so the search answered `not_found` and the strip said
"Sellel lehel ei ole otsingut. Ütle „otsi googlest“." (3/3 at 129948, 130895, 129197 ms). That advice is wrong: the
page has a search, the consent is in front of it. After "Ütle, nõustu kõigiga" the model searched again in v-2 and
v-3, not in v-1 (youtube.com reloaded at 134830 ms and nothing else). The control escaped because the model went
straight to `/results?search_query=lastelaulud`. Class product, page side: the command path's answer to a search
under an open dialog (strings.ts `siteSearch` failure line; keep the search until the dialog closes, or say to
answer the dialog first). Not fixed here. Second (finding 3): v-2 searched "lastelauda". Every final under the
overlap ends "lastelauda" (6/6), both control finals end "lastelaulud"; the model corrected it in v-1 and v-3, not
in v-2. Owner the speech model and the gate.

**Finding 6 (new): his first saying fails every time (4/4, the control too).** The first final reads "Ütlemine
juhtub, ei otsi lastelau..."; the model answers "Ei saanud aru", "Ei saa helistada" or a Google search. The same
audio a second time reads "Ütle, mine Youtube..." (4/4). Offline, his clip alone gives "Ütlemine Youtubei otsi
lastelaulud" and the scene after kalev gives "Ütle mine Youtubey": the recogniser merges "Ütle mine" depending on
what came before. It costs him a repeat: here about 35 s from his first final to YouTube opening, most of it the
script's 30 s wait for a tab. Owner the speech model and the wake word (a spotter on
the audio, PR #11, would not depend on the text).

The gap sweep (`artifacts/exit/gap.ts` writes the scene with vesta's first word at each gap after his last;
`scripts/asr-file.ts` with the speech detector, Idle priority, no lock; `artifacts/exit/gap/table.txt`):

| gap (ms) | finals after kalev's | his final |
|---|---|---|
| -800 | 1 | "Ütle mine Youtubey otsi lastelaulud. Mul on vaja vanaemale helistada." |
| -300 (the runs) | 1 | "Ütle mine Youtubey ja otsi lastelaulu? Mul on vaja vanaemale helistada." |
| 0 | 1 | "... otsi lastelaulud. Ei tule. Mul on vaja vanaemale helistada." |
| 300 | 1 | "... otsi lastelaulud. Ei tule, mul on vaja vanaemale helistada" |
| 600 | 2 | "Ütle mine Youtubey ja otsi lastelaulud" / ". Ei tule, mul on vaja vanaemale helistada." |
| 1000 | 2 | "Ütle mine Youtubey ja otsi lastelaulud" / "Ei tule, mul on vaja vanaemale helistada." |
| 1500 | 2 | the same split |
| 2000 (the control) | 3 | the same split, plus a "." final |

The 1k-REALPAGES check (the strip leaves the consent's "Nõustu kõigiga" clickable) passed on the stand-in in every
run; on the real youtube.com it is unverified.

Gates on r10-exit (under the lock, 2026-11-03 14:10 to 14:14): `npm run check` 60 files, 4238 tests, exit 0;
`run.ts` 330 PASS, ALL PASS (docs/proof restored after).

**Review round 1: hermetic, and finding 5 fixed.** control-1 drove the real google.com: the model's first answer
opened `https://www.google.com/search?q=lastelaulud`, Google answered with `/sorry/index` and reCAPTCHA. Hosts per
earlier run: control-1 www.google.com (5 navigations), www.youtube.com, web.whatsapp.com; dbg2-1, r-1, r-3, v-1,
v-2, v-3 only www.youtube.com and web.whatsapp.com (stand-ins); r-2 only web.whatsapp.com; dbg-1 none. exit.ts now
routes every request: localhost passes, YouTube and WhatsApp get their stand-ins, any google.* host gets a minimal
results stand-in, anything else is aborted; the new check "hermetic: every navigation is to a stand-in or an
extension page" names any other URL. Finding 5: when the search field is on the page but an open dialog covers it,
page.ts `siteSearch` now answers `not_found` with `behindDialog(buttons)` (protocol.ts; the dialog's visible
buttons), and the strip says "Otsing on lehe akna taga. Vasta enne aknale, näiteks „keeldu kõigist“ või „nõustu
kõigiga“, siis ütle otsing uuesti." instead of "Sellel lehel ei ole otsingut. Ütle „otsi googlest“." Chosen: tell
him, not hold the search (a held search needs a pending command across the dialog's close, engine work). Red first:
`src/core/searchBehindDialog.test.ts` 3 failed, 2 passed before the fix; 5 passed after.

Runs w-1, w-2, w-3 (overlap) and control2-1 (CPU 16 to 29 %, 5.8 to 6.6 GB free): steps 1 to 9 and 11 to 13 pass in
all four; hermetic PASS 4/4 (control2-1 reached the google stand-in at 86315 ms, nothing live). Results for
"lastelaulud" FAIL 4/4: w-1 and w-2 searched "lastelauda" (finding 3); w-3 and control2-1 got the new line (the old
one 0/4), but the scripted person only says "Ütle, nõustu kõigiga" and never the search again, and the exit set has
no "otsi lastelaulud" clip. So with this fix the step needs one more human sentence; holding the search would not.
WhatsApp 8953/9759/9258/6824 ms, dictation 1199/1702/1301/1203 ms, "saada" 1894/2660/1978/2087 ms after his last
word; machine time 195.1/242.2/209.4/205.8 s; the bar leaks in the overlap runs (finding 2), none in the control;
the enrolment phrase 4/4 (finding 1). Gates after the fix: `npm run check` 61 files, 4243 tests; `run.ts` 330 PASS.

**Review round 2: the ruling, the person follows the bar, run.ts cases.** Ruling (orchestrator): keep "tell him",
do not hold the search. The consent comes once per profile, and a command held across a page reload could fire
later when he no longer expects it, worse for a person who cannot stop it by hand; reversible later. The exit set
has a new owner clip `owner-search` ("Ütle, otsi lastelaulud.", voice mari, `UTLE_EXIT_ONLY=owner-search npx tsx
scripts/exit-set.ts` writes only it), and exit.ts's person, when the bar has said "Otsing on lehe akna taga", answers
the consent and then says it (logged as a reaction). run.ts has three cases on stand-ins: (i) the YouTube stand-in
with its consent open: the search's line says to answer the window and names „keeldu kõigist“ and „nõustu
kõigiga“; (ii) a page with a small dialog that covers nothing and no search field: the old line; (iii) the YouTube
stand-in after the consent is answered: the search runs (results for lastelaulud). Red first, run.ts on page.ts
without the `fieldBehindDialog` call: "FAIL siteSearch EXIT 5 (i) ... not_found: This page has no search field.
line="Sellel lehel ei ole otsingut. Ütle „otsi googlest“." consent=true", (ii) and (iii) PASS, "1 FAILED" in the
whole suite (`artifacts/exit/suite-red-1.log`). Typecheck and lint pass on this tree. Not yet run here: the green
run.ts, `npm run check`, and the three overlap runs and the control with the new clip; the batch was stopped by
the session's low-memory reap at 15:08 (machine at about 4 GB free while Ralf uses the product on port 5173).

On merged main (orchestrator, 2026-11-03, the code of 6070983, the merge worktree, under the lock):
`npm run check` 62 files, 4251 tests; run.ts 333 PASS, ALL PASS (EXIT 5 i to iii included); `UTLE_REAL=1 voice.ts`
56 PASS, ALL PASS (started at 75 % CPU: under load, the owner's own dev server was up). Four rehearsals, every one
hermetic, finding 1 (the last enrolment phrase as speech) in every one:
| run | steps | bar samples with three room words | why a step failed |
|---|---|---|---|
| x-1 | 12/13 | 302 of 2078 | results for "lastelauda" (finding 3) |
| x-2 (under load, 62 %) | 13/13 | 549 of 1939 | none |
| x-3 | 10/11 | 624 of 1992 | WhatsApp: the recogniser fell 17 to 30 s behind real time (`[asr] final ... audio=87400 wall=117417`) with a second speech server decoding on the machine; the command's final came after the step's window. Environment, not product |
| control (nobody over him) | 13/13 | 0 of 1470 | none |
In x-3 the finding 5 fix worked end to end: the bar said the search is behind the window, he answered the consent and
said "Ütle, otsi lastelaulud", and the results for "lastelaulud" opened. Logs: `artifacts/integ/` in the merge worktree
(not committed).

## 1w. Round 11, lane WORDS (2026-11-03)

Findings F4 and F6 of `docs/plans/2026-11-03-round-11-demo-brief.md` (ARCHITECTURE 23.4 "His own words", 32.3
"After a read-back").

**F4, his words for the core commands are rules.** `src/core/replay.test.ts` replays his 45 gate-verified
utterances of the demo (the brief says 48; the log has 45 rows labelled owner) through `inpageStep` with the box
he had (`src/core/fixtures/demo-2026-11-03.ts`: recognised text only, his friend's address replaced by a stand-in).
Before (origin/main 242547a): 42 of 45 went to the model. After: 37 of 45. Run it with `--silent=false` to see the
per-utterance verdicts (vitest hides a passing test's output).

| Form | Maps to | From |
|---|---|---|
| mine tagasi eelmisele lehele (also with its first word misheard by one letter) | history back | replay rows 9, 10; brief |
| tagasi eelmisele lehele, mine tagasi eelmisele leheküljele | history back | brief |
| mine järgmisele lehele | history forward | the mirror of "mine eelmisele lehele" |
| mine uuele vahelehele, uuele vahelehele | newTab | replay row 19; the gate-rejected tries before it |
| mine uuele lehele | newTab | brief |
| ma tahan X-i minna, tahan minna X-i (a known site) | goTo | brief (töötukassa, youtube, gmail) |
| a known site's name alone ("Töötukassa", "Youtube") | goTo, only with no armed box | replay rows 6, 7 |
| mine töötukassasse, mine gmaili, ava uus vaheleht | goTo / newTab (already rules; now on the help page) | brief |

Still asked, rightly: English and Estonian talk to himself or the room, his corrections of the address in the To
field, page clicks ("Mobiil-ID-ga sisselogimine", "logi mobiil-ID-ga sisse"), "sinna kus ma olin enne
töötukassat" (34.2: the model knows the tab he came from; the rules see no tabs), "kirjuta enda sõbrale e-maili"
(a careful plan), and words the recogniser broke. Side effect by design (33.3): "tagasi" and "mine
tagasi" now wait for their final, because a longer command starts with them.

**F6, the sentence after a read-back is addressed.** The addressee request carries `readBack` (the last step typed
into a one-line field and the strip read it back); the prompt treats the next sentence, while the field is armed,
as a command or dictation, never ignore. The three sentences as the recogniser wrote them that day were ignore 3
of 3 runs each on main's prompt and command 3 of 3 with the change (`artifacts/words/eval-readback*.log` in the
worktree). Eval: 90/90 intent cases and 22/22 addressee verdicts (16 before, plus five read-back cases and one
guard), 112/112 on Sonnet 5.5, $0.571 for the run; the YouTube recovery case ("not on the page, scroll once, then
search") passed this run (it searched at once, then said it saw no results). Gate: `npm run check` 4276 tests.

Not verified: a real voice; the real Gmail To field returning `box.single` after a typing (the flag needs it;
only indirectly shown, by the demo's read-back line); the latency effect of "tagasi" waiting for its final.

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

## 2. What Ralf must do

1. After a pull: `git pull` on `main`, `npm ci`, `npm run ext`, reload the extension on
   `chrome://extensions`, reload open tabs. Restart `npm run dev` and look for
   `[asr] model loaded on a worker thread`.
2. The Anthropic key's one place is `.env.local` in the repository folder (git-ignored; `npm run dev`
   and `npm run serve` load it), not the terminal's environment. A Windows user variable
   `ANTHROPIC_API_KEY` outranks the file: delete it, open a new terminal, `npm run dev`; the `[key]`
   line at start must say `sk-ant-usr... from .env.local` (#8 then closes). Without a key everything
   except the free-form understanding works, and the bar shows one amber line saying so.
   `curl localhost:5173/api/status` must say `"intent":"live"`.
3. The eval with the key: `npx tsx scripts/intent-eval.ts` (Estonian and English utterances against
   stand-in pages through the real model: pass or fail, latency, p50/p95, $ per completed task). Run by
   Ralf on 2026-10-05 (1a), in round 9 (1k-MODEL) and in round 10 prompt 3 (1p: 105/106 and 106/106 on
   Sonnet, the default model). Run it again after a change to the prompt or the model.
4. Real sites: YouTube's and Google's search selectors were verified on the real pages on 2026-10-27
   (1k-REALPAGES, read only). The player shortcuts and a voice search there have not been tried; try the
   path on the real sites and note what misses.
5. Your voice: onboarding starts with it (1m): phrases are checked one by one and the profile is kept
   only if the last two pass. Settings keep test, delete, re-enrol and **Kuula ainult mind**. The
   threshold is one measured value, `OWNER_THRESHOLD` 0.54 in `server/speaker.ts`, picked on synthetic
   voices; recalibrating it needs real recordings (#4).
6. Review and merge #2's PR (#11, the keyword spotter and its real-voice measurement).
7. The consent text (#9), then the 20-minute recording with two partners (#4).

## 3. Not verified by anyone

- The model's answers on real pages: the eval runs the real model against stand-in pages (1p), and
  real pages were only opened read only (1k-REALPAGES). The server, the validation, the engine and
  the page side are each tested with fakes; the join is tested end to end only without a model.
- His voice, a real eye tracker, real WhatsApp with the M7 build, Messenger. Real YouTube and Google
  were seen read only on 2026-10-27 (1k-REALPAGES); a voice search there was not tried.
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
- Round 5 review (`docs/REVIEW-R5.md`), two items it left open: "katkesta" after held words is the
  cancel but arrives at the end of the 2.5 s hold, not at once; the 25 s watchdog restarts per goal,
  not after each step, so a slow three-step goal can be given up between steps (its proposal: watch
  after every perform in `runGoal`).
- Dictation into a chat box in the toggle and always-on modes: nothing is previewed into the box
  while he speaks (32.3: the addressee check answers first, so a voice in the room never appears in
  his message); his live words are on the strip, and the sentence lands in the box about 2.75 s after
  he stops (p50; 2.4 to 3.8 s over five runs, 1u). The check is asked when the final arrives; the check
  itself (1.6 s p50 on Sonnet) is what stops 2.0 s, and no reply shape or warm-up made it faster (1u).
  Round 9 typed the words as he spoke. Wake mode ACTIVE still previews.
- The earlier faults stand: the command word can flash in the box when he keeps talking after a
  quick command (where the box is previewed); the "Sain aru" line is replaced by the result line a
  moment later; live words come in bursts of about 0.6 s; Chrome's own pages (settings, Web Store)
  cannot show the bar, and no extension can change Chrome's settings. Ütle's own settings page is
  the answer to that.
- On youtube.com and ilmateenistus.ee the strip covered the page's own consent button at the bottom
  (1k-REALPAGES). On the YouTube consent stand-in trimmed from the real page (1v) the bar folds to the
  pill and the buttons stay clickable; not re-checked on the real pages. A postimees headline is read
  with its comment count, "(11)" (not fixed).
- A click whose only effect is a network request with no DOM change for 400 ms gets a second
  activation (Enter) by the click fallback; on an element that handles both it could toggle twice.
- The cookie-banner rule covers overlays; YouTube's own consent is a separate page (a form), which
  the model handles as any page with buttons. Nobody accepts cookies for him: a search behind the
  consent now says to answer the window first and names its buttons, then to say the search again
  (1v, finding 5, fixed); before, it said the page had no search.
- From the exit-test rehearsal (1v; `UTLE_REAL=1 npx tsx extension/test/exit.ts`, synthetic voices):
  - His last enrolment phrase runs as speech once enrolment ends: the server sends `enrolled` about
    45 ms before that phrase's final, so the engine judges "Värskenda lehte: mine edasi ja vaigista
    heli ..." as said to Ütle (4 of 4 runs). Product, server enrolment ordering (31.7).
  - A room voice that starts within about 0.5 s of his last word is joined into his final and passes
    only-my-voice as his (10 of 11 overlap runs; the recogniser splits from about 0.6 s of silence).
    Her words reach the bar and the model. The speaker gate decides per segment (31.2); issue #3.
  - Speech over his last word garbles it ("lastelaulud" heard as "lastelauda"), so the search runs on
    the wrong word (speech model).
  - His first "Ütle, mine youtube'i ..." of a session is heard as "Ütlemine ..." (4 of 4, synthetic
    voice; the second saying is right): one repeat (issue #2; the spotter of PR #11 may remove it).
  - A misheard send word goes to the model: "Et saada" (for "saada") is judged "ignore" by the
    addressee check, 5 of 5 on main, and the message is not sent (1u).
  - For the helper's sheet: on YouTube's consent say "Ütle, nõustu kõigiga", then the search again;
    say "saada sõnum": a one-word "saada" is often too short to verify under only-my-voice (31).

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
