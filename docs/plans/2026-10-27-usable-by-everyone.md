# Round 9: usable by everyone (2026-10-27, overnight, unattended)

Source: Ralf's brief of 2026-10-26, scheduled for 03:00: "Plan first what needs to be done and
implemented to make this Ütle application totally usable by everyone (everything outside testing and
what needs to be done regarding it, refine the existing features further and so on). Then execute
according to plan with agents and so on."

"Everyone" is read as: a person who cannot use their hands, with a helper who is not a developer,
on a computer where the speech server is either local or the hosted one at Railway. The round builds
what such a pair hits between "I heard of Ütle" and "I sent my first message", and fixes the faults
that a day of use would hit next. Testing infrastructure is out of scope except as proof.

## 0. State the plan starts from (measured 03:05)

- `main` ef3bab3 = `origin/main`, clean. Round 8 merged (1394b91), Railway deployed 2026-10-23.
- Origin also holds `claude/round-9-model-provider-plan` (b2a48bb): one file, Ralf's cloud session's
  plan of 2026-10-25 for a model abstraction layer, cost per task and a tested fallback. Not merged.
- This machine: Node 22.20, all three models in `models/`, `ANTHROPIC_API_KEY` set in this terminal,
  Playwright Chromium present, no dev server running, port 5193 free, Railway CLI logged in,
  `https://utle-server-production.up.railway.app/healthz` 200 in 0.46 s, `/api/status` 401 bare.
- Gate on main: `npm run check` running at plan time (result in section 7).
- Ten old lane worktrees from rounds 7 and 8 still exist beside the checkout (pruned at close).

## 1. The gap list, from evidence

Every item names where it was read. Nothing here is imagined.

### 1.1 First run as a hands-free user with a helper (walked through the code and the README)

| # | What happens today | Where read | Gap |
|---|---|---|---|
| G1 | Install opens `permission.html` only; nothing tells the helper what to do next (server, test, voice). The server address lives under **Server** on the settings page, after Minu andmed and Minu kohad. | `background.ts` onInstalled, `options.html`, README "Install" | No first-run page. A hosted-server user has no path from "installed" to "working". |
| G2 | When the server is down the strip says "Server ei vasta. Käivita see käsuga npm run dev." | `strings.ts` noticeServerDown | Meaningless to a non-developer; wrong when the address is the hosted server. |
| G3 | The settings page's **Proovi ühendust** exists, but the strip itself never says which server it uses or whether the key works until a command fails. | `options.ts` 641-735, `connection.ts` | No standing "connected / not connected / wrong token" state a helper can read at a glance. |
| G4 | The toolbar button only toggles listening; right-click → Options is the only way to the settings without the strip. | `manifest.json` action, `background.ts` | A user whose page cannot show the strip (chrome://) has no voice way in; a helper has no obvious one. Minor. |
| G5 | The READMEs are English and for developers; `docs/PRIVACY.md` is the only Estonian page for the user. | README, extension/README | No Estonian help for the user or the helper inside the product. |
| G6 | "Ei saanud aru. Ütle teisiti, näiteks „ava youtube“ või „keri alla“." is the only hint when a command is not understood; the phrase list is in a 620-line English README. | `strings.ts` notUnderstood, extension/README "What to say" | No in-product "what can I say" page or command. |
| G7 | Numbering by voice does not cover the settings page (`näita numbreid` on options.html). | extension/README line 207, `background.ts` 228 | Settings cannot be driven fully by voice; dwell only. |

### 1.2 Store and hosted install (what "no developer needed" needs)

| # | Evidence | Gap |
|---|---|---|
| G8 | `npm run ext:pack` writes `extension/out/utle-0.3.0.zip`; the listing text, screenshots (1280×800) and the privacy URL are described in extension/README "The store zip" but none exists in the repo. | No listing copy (ET + EN), no screenshots, no checklist Ralf can follow in ten minutes. |
| G9 | `extension/README.md` "Install on a locked computer" step 1 reads "*(store link once published, unlisted)*". | The one path that needs no developer is a placeholder. |
| G10 | Manifest 0.3.0, description in English only; `default_title` English. | Store listing shows English to an Estonian user. |
| G11 | The Web Store upload needs Ralf's developer account (one-time fee) and his click. | Only Ralf: money and an outward-facing act. Prepared, not done. |

### 1.3 Known faults and latent defects (HANDOFF 4, 1j; round 9 plan §0)

| # | Fault | Where |
|---|---|---|
| F1 | "Kirjuta siis mulle" opens a conversation with "Siis Mul" (two-word name rule excludes single-word pronouns only). | HANDOFF 4; `src/core/message.ts` |
| F2 | A textarea over 500 characters anywhere (a long forum comment) is a document, so "saada" says "Dokumendis ei saadeta." | HANDOFF 1j known faults; `src/core/documentMode.ts` |
| F3 | A search whose Enter navigates within 600 ms loses the page's answer; the bar says the command did not answer although it ran. | HANDOFF 4; `extension/src/page.ts` siteSearch |
| F4 | `server/interpret.ts` sends `tool_choice: { type: 'any' }`, which Opus 5.5 and Sonnet 5.5 reject with 400 (`npm run smoke` path). | round 9 plan §0 |
| F5 | Whether the server writes `models/hotwords.txt` at start was never seen (the lane's `models/` was read-only). | HANDOFF 1i |
| F6 | The command word can flash in the box when he keeps talking after a quick command; "Sain aru" is replaced by the result line a moment later. | HANDOFF 4 (standing) |
| F7 | In wake mode a woken command never opens the dictation window, only dictation does; "Ütle" split off by a breath becomes its own final (by design, documented). | HANDOFF 1j |
| F8 | A click whose only effect is a network request gets a second activation (Enter) after 400 ms; on an element that handles both it could toggle twice. | HANDOFF 4 |

### 1.4 Everything marked UNVERIFIED that can be verified tonight without a login

`extension/src/sites.ts` has 70 selectors marked UNVERIFIED (WhatsApp, Messenger, Gmail, YouTube,
Google). WhatsApp, Messenger and Gmail need a logged-in person: parked for Ralf. Verifiable now with
Playwright on the public pages: YouTube's search field and `#movie_player`, Google's search field,
the cookie banners of youtube.com, google.ee, postimees.ee, delfi.ee, err.ee, ilmateenistus.ee, what
`readPage` lists on those pages, what `loe ette` extracts as the article, and whether the strip makes
room on them. None of this has been done on a real page (extension/README "Unverified").

### 1.5 Refinement of what exists

- The model behind `/api/intent` is one vendor with no fallback and no cost figure (round 9 plan on
  origin, lanes A and B are code; lane C needs a DeepSeek key only Ralf has).
- The hosted server's profile is per token; the settings page says so after **Proovi ühendust** only.
- Edge is the only browser with an Estonian voice; the README says so, the product does not.

### 1.6 Parked (unchanged from round 8 §5, plus)

Speech impairments, video calls, people who cannot write, real WhatsApp/Messenger/Gmail selectors,
the calibration with a friend, the Web Store upload itself, a DeepSeek key.

## 2. Lanes, ranked by what they do for a new user

Six lanes, Opus 5.5, one worktree each, dispatched with `lane-dispatch`, reviewed with
`lane-review`, merged in the order FAULTS, MODEL, REALPAGES, ONBOARD, HELP, SHIP (SHIP last: it
bumps the version and takes the screenshots of the finished product). Every lane: tests first in
`src/core/*.test.ts` where the core changes; `npm run check` and `npx tsx extension/test/run.ts`
green on the lane before it reports; spec in `docs/ARCHITECTURE.md` section 30 (one subsection per
lane, written before the code); `extension/README.md` and `HANDOFF.md` updated by the lane for its
own feature.

### Lane ONBOARD (G1, G2, G3, G4): the first run, in Estonian, for a helper

Build:
- `extension/welcome.html` + `extension/src/welcome.ts`: opens on install (after the microphone
  page, or instead of it with the microphone as step 1). Steps, each a large dwellable card with a
  green tick when done: 1 Mikrofon (asks, shows granted), 2 Server (two choices: "Samas arvutis" /
  "Teises arvutis": address + võti fields, **Proovi ühendust** inline, result in plain Estonian),
  3 Proovi (an armed demo box on the page itself: "Vajuta mikrofoni ja ütle: tere"; the words
  appear; "Töötab." when a final lands), 4 Hääl (optional, links to Õpeta mu hääl lausetega),
  5 Valmis (three example phrases, a link to the help page from lane HELP if present, else to the
  README's address). English under each Estonian line, dim, as the options page does.
- "ava juhend" / "ava alustamine" / "setup" reopen it by voice; the toolbar button's context menu
  (`chrome.contextMenus`, permission added) gets "Alustamine", "Seaded", "Abi".
- Server-down lines by situation (`strings.ts`): a local address → "Kõneserver ei vasta. Palu
  abilisel see käivitada (npm run dev)."; a hosted address → "Kõneserver ei vasta. Kontrolli
  internetiühendust või palu abilisel vaadata serverit."; wrong token → the existing line. The strip
  says it once per outage and "Server vastab jälle." once when it comes back (`src/speech/local.ts`
  already retries; the engine must surface the transition, not every retry).
- A standing connection dot on the strip's microphone square: green connected, amber connecting,
  red no server, with the Estonian word under it on hover/dwell.

Acceptance criteria and proof:
1. On a fresh profile `chrome.runtime.onInstalled` opens welcome.html; the five cards render in
   Estonian with English under; every card is reachable by dwell and by `näita numbreid` + number.
   Proof: browser suite case `welcome` (`extension/test/run.ts`), screenshot `docs/proof/r9-welcome.png`.
2. Step 2 with the Railway address and a wrong token shows "Vale võti."; with the right token
   (`UTLE_TEST_TOKEN` env, else the stand-in server) shows "Ühendus töötab" and the profile line.
   Proof: suite case against the test server's `/api/status` fake (401 and 200), screenshot
   `docs/proof/r9-welcome-server.png`.
3. Step 3: a recorded utterance through the stand-in types "tere" into the demo box and the card
   ticks. Proof: suite case; `UTLE_REAL=1 npx tsx extension/test/voice.ts` still ALL PASS.
4. With the dev server stopped the strip shows the local-address line once; started again, "Server
   vastab jälle." once; with a `wss://` address set, the hosted line. Proof: `npx vitest run
   extension/src/engine.test.ts src/speech/local.test.ts -t "server down|server back|hosted"`;
   `npx tsx extension/test/voice.ts down` output pasted.
5. The connection dot's three states. Proof: suite assertions on the strip's `data-connection`
   attribute, screenshot `docs/proof/r9-strip-connection.png`.
6. Spec first: ARCHITECTURE 30.1; extension/README "Load" rewritten around the welcome page;
   README.md "Install" step 5 updated. Proof: the diff.

### Lane HELP (G5, G6, G7): what can I say, inside the product

Build:
- `extension/help.html` + `src/help.ts`: the phrase list in Estonian, grouped as the README's
  "What to say" (Sõnumid, Parandamine, Tekstis liikumine, Vormid, Kerimine, Vahelehed ja saidid,
  Video, Meil, Dokument, Lugemine, Minu andmed, Minu kohad, Hääl), each group a dwellable card that
  opens; the strip mounted on it; `loe ette` reads the open group. The list is generated at build
  time from one source (`src/core/phrases.ts`, exporting the groups with Estonian and English
  forms) so it cannot drift from the rules; `extension/README.md` "What to say" cites it.
- Commands: "abi", "mida ma öelda saan", "näita käske", "help", "what can I say" open it; "abi
  kerimine" opens the group. Rules only, never the model.
- `notUnderstood` gains the hint: "… või ütle „abi“." The newtab's rotating examples come from the
  same source.
- `näita numbreid` works on options.html and help.html (background.ts treats them like newtab).

Acceptance criteria and proof:
1. `src/core/phrases.test.ts`: every Estonian example in the groups is matched by the rules
   (`inpage`/`browserIntent`/`localIntent`) as the command the group claims; the test enumerates the
   source, so a phrase that drifts fails the gate.
2. "abi" opens help.html; "abi kerimine" opens with the Kerimine group open. Proof: suite case
   `help`, screenshot `docs/proof/r9-help.png`.
3. `näita numbreid` on options.html labels the choice buttons; "kolm" presses the third. Proof:
   suite case on options.html, screenshot `docs/proof/r9-options-numbers.png`.
4. `loe ette` on help.html reads the open group through the reader (fake `speechSynthesis` in the
   suite). Proof: suite assertion on the fake's sentence list.
5. Spec ARCHITECTURE 30.2; README "What to say" table regenerated from the source.

### Lane FAULTS (F1 to F5): the known faults that a day of use hits

Build, each test-first in core:
- F1: the two-word name rule rejects a name whose first word is a conjunction or adverb (siis, ja,
  aga, nüüd, palun, kohe, ka) and whose second is a pronoun or verb; "Kirjuta siis mulle" is
  dictation. `src/core/message.test.ts`.
- F2: a textarea with a send/post/comment/reply button in its form or within 200 px is never a
  document whatever its length (the composer rule already knows the button); the document test for
  length applies only to a box with no such button. `src/core/inpage.test.ts` (document mode block),
  `extension/src/box.ts` passes `hasSend` already or gains it.
- F3: `siteSearch` resolves as `ok` when the navigation starts within the wait (listen for
  `beforeunload`/`pagehide` or the address change) instead of `failed`. `extension/test/run.ts`
  fixture with a form that navigates on Enter at 100 ms.
- F4: `server/interpret.ts` uses `tool_choice: auto` with the prompt asking for the tool;
  `server/interpret.test.ts`.
- F5: start the real server once (`npm run dev` with `models/hotwords.txt` moved aside), observe the
  file written and the log line; keep the observation in HANDOFF 1i. No code unless it fails.

Acceptance criteria and proof:
1. F1: `npx vitest run src/core/message.test.ts -t "siis mulle"`; eval case added
   ("kirjuta siis mulle et tulen" on the WhatsApp fake is dictation).
2. F2: `npx vitest run src/core/inpage.test.ts -t "long textarea with a send button"`; the suite's
   essay textarea with a Send button beside it accepts "saada".
3. F3: suite case `search-navigates` passes with the fixture; HANDOFF 4 line removed.
4. F4: `npx vitest run server/interpret.test.ts`; `npm run smoke` runs one line end to end with the
   key (output pasted, no document text).
5. F5: the log line `[asr] hotwords …` or equivalent and `ls -la models/hotwords.txt` after start.
6. Spec: ARCHITECTURE 30.3 lists each fault, its fix and its test; HANDOFF 4 and 1j pruned.

### Lane REALPAGES (§1.4): what the product sees on real Estonian pages

Build:
- `scripts/real-pages.ts`: Playwright, headed, loads the built extension, opens each of
  youtube.com, google.ee, postimees.ee, delfi.ee, err.ee, ilmateenistus.ee, otse.err.ee, and on
  each records: the cookie banner `readPage` lists first (or not), the number of items, the
  search field found by `SEARCH_FIELDS` (youtube, google), `#movie_player` present on a watch page,
  the article `loe ette` would read (first 3 sentences, count) on the three news sites, the strip's
  bottom clearance (does the page's fixed footer cover it). Writes `docs/proof/r9-real-pages.md`
  (a table) and one screenshot per site to `docs/proof/r9-real-<site>.png`. No login, no typing
  into real sites, no sending.
- Fix what the table shows wrong: cookie banner not first, article extraction taking the nav,
  search field selector wrong, strip covered. Each fix test-first on a fixture that reproduces the
  real markup (copy the relevant DOM into `extension/test/fixtures/real-<site>.html`).
- Update `sites.ts` comments from UNVERIFIED to VERIFIED <date> for what was seen.

Acceptance criteria and proof:
1. The table exists with all seven sites and every column filled or "n/a" with the reason.
2. Each fix has a fixture case in the suite and a before/after line in the table.
3. `sites.ts` YouTube and Google lines carry VERIFIED 2026-10-27 or the corrected selector.
4. On each news site the extracted article's first sentence is the headline and no nav text appears
   in the first three sentences (asserted by the script, pasted in the table).
5. Spec ARCHITECTURE 30.4 (the measurement and what changed); extension/README "Unverified" pruned.

### Lane MODEL (round 9 plan on origin, lanes A and B): one door to any model, cost per task

Build exactly `docs/plans/2026-10-25-round-9-model-provider.md` §2 lanes A and B (the plan is
merged into main first by the orchestrator as the lane's spec). Lane C (the drill on a real
DeepSeek key) is Ralf's and is left ticked-empty in the checklist. Default model unchanged.

Acceptance criteria and proof (from the plan):
1. `server/model/*.test.ts` cover the Anthropic adapter (exactly what `intent.test.ts` asserts
   today), the OpenAI-compatible adapter (tool call, text, cut, 429, connection error, malformed
   arguments), the fallback (fast failures only, never a timeout), the config (every form, unknown
   provider rejected), `/api/status` model fields. `npx vitest run server/`.
2. `server/intent.test.ts` passes against a fake `Model`.
3. `IntentAnswer.usage` optional in the schema; the engine tallies per job and emits one record per
   ending with the `rules` outcome; ring of 200 in `chrome.storage.local`, never words.
   `npx vitest run src/core/pageIntent.test.ts extension/src/engine.test.ts -t "usage|spend"`.
4. `npx tsx scripts/intent-eval.ts` prints the table with tokens and $ per completed task on
   `anthropic:claude-sonnet-5-5` (run with the key tonight; numbers into the plan's checklist row 1).
5. `UTLE_MODEL=anthropic:claude-sonnet-5-5` and bare `claude-sonnet-5-5` both work; `deepseek:…`
   without a key fails at start with a clear message. Pasted output.
6. CLAUDE.md, extension/README "Hosted server", docs/DEPLOY.md name the new variables.

### Lane SHIP (G8 to G11): everything for the store that is not Ralf's click

Build:
- `docs/STORE.md`: the listing, ET first then EN: name, summary (132 chars), description, single
  purpose, the `<all_urls>` justification, data declarations, category, the privacy URL
  (`https://utle.ee/privaatsus` once DNS lands; the GitHub `docs/PRIVACY.md` page until then, both
  written), and Ralf's ten-minute checklist with the developer-account step marked as his (fee).
- `scripts/store-shots.ts`: five 1280×800 screenshots from the stand-in pages and the finished
  welcome/help/settings pages into `extension/store/`: the strip on the WhatsApp stand-in with a
  message typed, the numbers on the video stand-in, the welcome page, the settings page, the help
  page. Committed.
- Manifest: version 0.4.0, Estonian `description` with English after, `default_title` Estonian;
  `npm run ext:pack` output name follows; the zip's contents listed in the doc.
- `extension/README.md` "Install on a locked computer" step 1 rewritten: the zip can be loaded
  unpacked by a helper today; the store link line stays with "once Ralf uploads".
- The `site/` landing page: an "Paigaldamine" section pointing at the same two routes. Not deployed
  (utle.ee deploys by hand, memory).

Acceptance criteria and proof:
1. `npm run ext:pack` exits 0 and `unzip -l extension/out/utle-0.4.0.zip` lists manifest, pages,
   dist, relay.js, icons, nothing else (pasted).
2. The five PNGs exist at 1280×800 (`file` or the script's own check pasted).
3. `docs/STORE.md` has every listing field the README names, in both languages.
4. The zip loads unpacked in the suite's Chromium and the welcome page opens (suite case `pack`).
5. ARCHITECTURE 30.6 is the store section; PUBLISHING.md "What public can mean today" updated
   (the hosted server exists now, so the store route is open).

## 3. Orchestrator's own work, in order

1. Register the run, launch the monitor, record it.
2. Merge the round 9 plan file from origin into main (docs only) so MODEL has its spec on main.
3. Write ARCHITECTURE section 30's heading and the six subsection stubs (one commit), so lanes
   append without conflicts.
4. Dispatch FAULTS, MODEL, REALPAGES, ONBOARD, HELP at once; SHIP when ONBOARD and HELP have merged.
5. Review each report with `lane-review`: full diff, every proof re-run here, screenshots opened.
6. Merge in order; after each merge run `npm run check` and the suite; after MODEL also the eval
   with the key; after ONBOARD also the voice test.
7. HANDOFF 1k, NEXT-SESSION round 9 log, the owner message, self-assessment, prune worktrees, close.

## 4. Exit test for the round

- `main` green on `npm run check` and `npx tsx extension/test/run.ts`, pushed to origin.
- A fresh Chromium profile with the zip loaded unpacked: the welcome page opens, the server step
  connects to the Railway server with a test token, "abi" opens the help page. Screenshot.
- Every lane's criteria proven by the named artifact, listed in HANDOFF 1k.

## 5. Only Ralf can do

- The Chrome Web Store developer account and the upload (money, outward-facing).
- A DeepSeek key for the round 9 lane C drill.
- A real voice through everything; the friend calibration (1g); logged-in WhatsApp, Gmail, Messenger.
- Deploy the utle.ee site changes by hand.

## 6. Dispositions

| Item | Disposition |
|---|---|
| G1 to G4 | Lane ONBOARD |
| G5 to G7 | Lane HELP |
| G8 to G10 | Lane SHIP |
| G11 | Ralf; prepared by SHIP |
| F1 to F5 | Lane FAULTS |
| F6 | Standing fault, cosmetic; not this round (needs the preview path rework, risk to dictation) |
| F7 | By design, documented; no change |
| F8 | Not reproduced on any page; left in HANDOFF 4 |
| §1.4 public pages | Lane REALPAGES |
| §1.4 logged-in sites | Ralf |
| Round 9 plan A, B | Lane MODEL |
| Round 9 plan C | Ralf (key) |

## 7. Results (filled at close)

(see HANDOFF.md 1k)
