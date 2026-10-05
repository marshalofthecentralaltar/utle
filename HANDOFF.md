# Ütle: handoff

Written 2026-10-05 about 15:30 (Tallinn), for a fresh session with no context. The earlier handoff
(01:30 the same day) is in git history and is obsolete: the product changed shape twice since.
Read this, then `docs/PRODUCT.md` (what the product is, in plain words), then
`docs/ARCHITECTURE.md` section 21 onward (what is built). Sections 1 to 20 of the spec are history.

Everything stated as fact here was observed in the session that wrote it. What was not is marked.

## 1. What exists and works

Ütle is now a Chrome extension. The user stays on the site he is writing in (WhatsApp Web first).
A black bar at the bottom of every page has one large button; while it listens, his Estonian
speech is typed into the site's own message box as he speaks, repaired by voice, and sent with
"saada". The same voice moves the browser.

- `main` is at `b2772b9`, clean, gate green (`npm run check`: 1270 tests). Nothing is pushed:
  the repository has no remote.
- Speech: TalTech's `streaming-zipformer-large.et-en` runs inside the dev server
  (`ws://localhost:5173/api/asr`). Model files are in `models/` (gitignored; `npm run model`
  fetches them).
- The extension is built into `extension/dist/` by `npm run ext` (gitignored) and loaded unpacked
  from `extension/`. Ralf has it loaded in his Chrome and has used it on real WhatsApp Web.
- A dev server is running on port 5173 (started 12:14, not by an agent; probably Ralf's terminal).
  The extension needs it. Do not stop it; test servers use other ports.

What the last merge added, proven by the automated voice test on `main` with the real logic
(`UTLE_REAL=1 npx tsx extension/test/voice.ts`, needs `npx vite --port 5193 --strictPort`):
words appear in the box while he speaks (first words 0.3 s before the sentence ends, final text
1.5 s after; it was 2.8 s); commands never show in the box; the extension supplies Chrome's
new-tab page with the same bar and large site tiles; the bar survives navigation.

**Ralf has NOT yet reloaded the extension since that merge.** To update: `npm run ext` is already
done on `main`; on `chrome://extensions` press the reload arrow on Ütle, reload open tabs, and if
Chrome asks about the changed new-tab page choose "Keep it".

## 2. Not verified by anyone

- His voice (the man with a motor disability). Only recorded synthetic speech and one team member.
- A real Tobii eye tracker on the dwell button.
- The live-typing and new-tab changes on real WhatsApp and in branded Google Chrome (only
  Playwright's Chromium). The first version did work on real WhatsApp Web, so the WhatsApp
  selectors in `extension/src/sites.ts` marked unverified (composer, send) are in fact working.
- Real Messenger: never tried.
- The extension lane's last two rounds of code were reviewed by re-running tests and reading the
  engine and message-box files, not by reading all of it (about 2,500 lines).

## 3. Known faults

- The Anthropic key in the environment is rejected (401, confirmed). Nothing in the extension
  needs it. The old localhost page's document edits do. Ralf said the key waits.
- If he keeps talking straight after a quick command ("saada ja siis…"), the command word can
  show in the box for a moment. Fix belongs in `src/speech/local.ts`. Not fixed.
- The "Sain aru: …" line (shown when a misheard command was corrected) is replaced by the result
  line a moment later.
- The model updates its guess about every 0.6 s, so live words arrive in bursts. A model exported
  with smaller chunks would fix it; ask Tanel Alumäe.
- Chrome's own pages (settings, web store) cannot show the bar.
- `README.md` and `CLAUDE.md` still describe the old document editor and "no remote".
- There are two product descriptions: `docs/PRODUCT.md` (written by this session, committed) and
  an untracked `PRODUCT.md` in the root (created 14:58 by someone else; not read in full, not
  touched). Merge them or delete one.

## 4. What Ralf asked for next (NOT started; he asked that none of it be done in the old chat)

In his words: "A settings page to change where the button is, how big it is (the entire bottom
row can be it) and make the button like a push to talk button, so you look at it and you can type
meanwhile. The worst part is navigating the page right now, we cant properly search anything, we
cant open videos on youtube and so on."

And: "How do I make it public so everyone can download?"

The previous session's reading of these, as a starting point and not a ruling:

1. Navigation (he called it the worst part):
   - search on the site in front ("otsi kassivideod" on YouTube searches YouTube; "otsi googlest …",
     "otsi youtube'ist …" from anywhere);
   - open by position ("ava esimene video", "ava kolmas tulemus");
   - click by name ("vajuta logi sisse") without the numbers step;
   - video control ("mängi", "paus", "täisekraan", "vaigista").
   This needs new commands in `src/browser/protocol.ts` (suggested: `search`, `clickText`,
   `clickResult`, `media`), phrases in `src/core/inpage.ts` / `browserIntent.ts`, and the page side
   in `extension/src/page.ts`. Adding a command kind breaks two exhaustive switches
   (`browserDoing` in `src/core/strings.ts`, `execute` in `extension/src/background.ts`); add the
   cases in the same commit.
2. Settings page: button position and size (up to the whole bottom row), and push-to-talk: it
   listens only while the pointer rests on the button. Leaving mid-utterance must not lose the
   words, so the server needs a way to finalise at once (a `flush` message on the `/api/asr` wire).
3. Making it public. Today "public" can only mean a public source repository: the extension depends
   on the local speech server, so it cannot go on the Chrome Web Store as it is. Before publishing:
   add a licence, rewrite `README.md` for the extension (the steps are in `extension/README.md`),
   fix `CLAUDE.md` ("no remote"). A scan of tracked files for keys found none; no `.env` is tracked.
   Publishing is Ralf's act or needs his explicit yes.

Ask him which he wants first, and for the exact things he tried and could not do, before building.
His standing rule is a mock he approves before anything visible is implemented; the first run of
the day was cancelled because that was skipped.

## 5. How this was built (orchestration state)

- Ledger run `2026-10-05-utle-m4`: closed, partial, rated 2 (wrong product shape).
- Ledger run `2026-10-05-utle-inpage`: closed, shipped. Its monitor's close-out and rating block
  were requested at close; the rating page is https://claude.ai/artifact/C9xUMRrmT2pSMdno89i4id.
- No agent is in flight. All lane worktrees are removed; branches `m4-*`, `m5-*`, `m6-*` are merged
  and can be deleted.
- A new piece of work is a new run: `run.mjs open`, monitor, lanes, as in the global instructions.

## 6. People and time

- Hackathon: NewWorkTech, TalTech Mektory. Tuesday 6 October: 10:00 three-minute recap, teamwork to
  12:30, pitch preparation 13:30, pitch to the jury 14:30.
- Three teammates had little to do. Suggested jobs (given to Ralf, not confirmed taken): a tester
  logging failures on real sites and proofreading the Estonian in `src/core/strings.ts`; an evidence
  person getting the user with a motor disability and his Tobii in front of it, timing typing against
  voice, filming, and writing to Tanel Alumäe; a pitch owner.
- Tanel Alumäe (TalTech, head of the Laboratory of Language Technology) made the speech model; the
  team was offered a personal introduction.
