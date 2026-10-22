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

Not verified: no Railway deploy (the CLI is not logged in), no real voice over the internet, the
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
hotwords pull ordinary dictation toward command words over a day of use, and the server actually
writing `models/hotwords.txt` at start (the lane's `models/` was read only; the eval writes the
files to a temporary folder through the same `hotwordsConfig`). After merging, run `npm run model`
once (or just start the server) so the files exist. Google Docs gluing (M5) is still open: the fix is
in `extension/src/page.ts` and needs a browser test, more than the 20 lines the lane was allowed.

## 1j. Round 8 (2026-10-22 night, overnight, unattended): seek by amount, document mode, mail, wake word and places, reading aloud, the dictation-cleaning measurement

Plan: `docs/plans/2026-10-22-round-8-plan.md`. Spec: `docs/ARCHITECTURE.md` section 29 (29.1 to 29.6, one
per lane). Six lanes on Opus 5.5 in their own worktrees, reviewed by the orchestrator with the full diff and
every proof re-run, merged into `main` in the order MEDIA, FLOW, DOCS, MAIL, WAKE, READ. Push to origin is
disabled in this checkout, so `main` is local only. The two gates only Ralf can pass were both unmet when the
round started and are still unmet: no Railway project (`railway whoami`: Unauthorized) and no calibration line
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
uks oli lahti") is asked of the model, which usually answers dictate; a textarea over 500 characters anywhere (a
long forum comment) is a document, so "saada" there says "Dokumendis ei saadeta." (click Send, or say "vajuta
saada"); the wake word is matched on the first one or two words only, so "Ütle" said before a breath that the
recogniser split off becomes its own final (the bare word opens the dictation window, which is the intended way
to say it); in wake mode a woken command never opens the dictation window, only dictation does.

**Ralf's thirty minutes stay as in the plan, section 2:** the Railway deploy (`docs/DEPLOY.md`), the ten-minute
calibration with a friend (1g), and the read-backs on `fixtures/login.html`. Three new things to try first, in
this order: on any news page say "loe ette" in Edge (network voices on in Edge's settings) and in Chrome (the
bar must say there is no Estonian voice); on YouTube "keri edasi üks minut"; in Gmail "kirjuta meil <nimi>",
"teema: proov", dictate, "saada".

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
