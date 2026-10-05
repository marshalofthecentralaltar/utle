# Ütle: handoff

Written 2026-10-05 about 22:30 (Tallinn), after milestones M7 and M7.2, for a fresh session with no context.
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

- Branch `claude/utla-voice-command-access-4ftxk4` on GitHub, gate green (`npm run check`: 1856
  tests), browser suite green (`xvfb-run -a npx tsx extension/test/run.ts`: every command kind,
  Messenger stand-in skipped where there is no IPv6).
- Speech: TalTech's model in the dev server (`ws://localhost:5173/api/asr`), unchanged.
- The default model for `/api/intent` is `claude-opus-5-5` at low effort; `UTLE_MODEL` overrides it
  (`claude-haiku-4-5` if a command feels slow).

## 2. What Ralf must do before the demo

1. `git pull`, `npm ci` (zod is already a dependency; nothing new to install), `npm run ext`,
   reload the extension on `chrome://extensions`, reload open tabs.
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

## 3. Not verified by anyone

- The model's answers on real pages (no key here). The server, the validation, the engine and the
  page side are each tested with fakes; the join is tested end to end only without a model.
- His voice, a real eye tracker, real WhatsApp with the M7 build, real YouTube and Google, Messenger.
- Whether `requestFullscreen` works from an injected script (it may need a user gesture; then the
  command answers "See ei õnnestunud").
- Latency of a model answer in his network. The engine waits at most 7 s and shows "Mõtlen…".

## 4. Known faults

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
| When the engine asks the model | `extension/src/engine.ts` (`LONG_UTTERANCE_WORDS`, `ASK_TIMEOUT_MS`) |
| Page commands, the armed element | `extension/src/page.ts`, `extension/src/box.ts` |
| Strip, pill, settings | `extension/src/strip.ts`, `extension/src/options.ts` |
| Screenshots | `docs/proof/m7-*.png` |

## 6. People and time

Hackathon: NewWorkTech, TalTech Mektory. Tuesday 6 October: 10:00 three-minute recap, teamwork to
12:30, pitch preparation 13:30, pitch to the jury 14:30. Tanel Alumäe (TalTech) made the speech
model; it is not ours and must not be pitched as ours.
