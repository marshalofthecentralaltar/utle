# Prompt for the next cloud session

Paste everything below the line into a fresh Claude Code cloud session on the repository
`marshalofthecentralaltar/utle`. It carries the standing rules, the loop to run, and where to look.
Keep this file current: whoever closes a round edits "Where things stand" at the bottom.

---

You are continuing Ütle, a Chrome extension that lets a person with a motor disability write, repair
and send messages and move around the web by speaking Estonian. Read, in this order: `CLAUDE.md`,
`HANDOFF.md`, `docs/NEXT-SESSION.md` (this file, for the round log), `docs/ARCHITECTURE.md` sections
21 to 23, `docs/REVIEW-M7.md`. GitHub is the one true copy: `main` is the product; the laptop only
pulls and tests with a real voice and reports what misses. Nothing on the laptop is yours to merge.

Standing rules, in addition to `CLAUDE.md`:
- Never name the user's medical condition anywhere: write "a motor disability". A private project
  name the owner mentioned to the first session must never appear either; it is not written here
  on purpose, so a fresh session cannot repeat it. No `.env` files; keys live only in the environment of the terminal that runs
  `npm run dev`.
- The owner cannot run commands for you, cannot read code, and will test tomorrow morning by voice.
  Everything you ship must be green on `npm run check` and on
  `xvfb-run -a -s "-screen 0 1600x1000x24" npx tsx extension/test/run.ts` (the Messenger stand-in
  is skipped where there is no IPv6). The voice test needs the model files and a key you do not have.
- Work in lanes: write the shared contract first (types, schema, strings, routing), commit it, then
  one agent per lane in its own `git worktree` (symlink `node_modules`), merge each lane as it lands,
  run the gate and the browser suite on the merged branch, push. After every round run an
  adversarial review lane over the round's diff and fix what it finds. Then look at the whole
  product again and pick the next round yourself: refine what exists until it is flawless before
  adding more.
- Commit messages end with the two trailer lines
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and the `Claude-Session:` link of the
  session doing the work.
- When a round is green, merge the working branch into `main` (fast-forward or merge commit, never a
  force-push) and keep building from `main`. The owner decided this on 2026-10-05 evening.

What the owner asked for, in his words, ranked (keep this list; strike what is done):
1. Speed. "At the start it worked super well, at the end it reacted to 'open WhatsApp' four or five
   minutes later." A spoken command must act within about a second for rules and within about three
   seconds with the model, and never drift.
2. Push-to-talk by gaze: listen while the eye tracker's pointer rests on the button, stop and deliver
   the words when it leaves; a setting to make the whole bar the button so he can watch the words
   while speaking; toggle mode stays available.
3. It mishears a lot: match commands by sound ("juutuba", "aga whatsapp", "saadake"); try Soniox as
   an alternative Estonian recogniser.
4. Editing text properly: move between sentences and words, erase letters, insert in the middle,
   undo; an essay, not only a chat message; Google Docs as far as a canvas editor allows.
5. Smooth and slow scrolling, "stop".
6. "Anything a person with no hands might need": take these as a base and expand. Cat videos on
   YouTube, a perfect message, an essay, forms, mail.

The loop for each round:
1. Read `HANDOFF.md` "Known faults" and the owner's latest report (he writes it in the chat; copy it
   into `HANDOFF.md` section 1a with the date).
2. Decide the round: at most six lanes, each with one clear deliverable and its own tests. Write the
   contract. Dispatch. Merge. Gate. Review lane. Fix. Push. Update `HANDOFF.md`, `ARCHITECTURE.md`
   (sections 22 onward describe what is built), this file's round log, and `extension/README.md`.
3. Merge into `main` when green. Tell the owner in a few plain sentences what changed and what he
   should try first; ask nothing that blocks you.
4. Repeat while there is anything on the list above, or anything in "Known faults", that you can
   make better without a real voice. Stop only when every item is done or needs the owner.

---

## Where things stand

### Round 9 (2026-10-27 night, overnight and unattended): done, merged into main, pushed

Ralf's brief of 2026-10-26: make Ütle usable by everyone, plan first, then execute with agents. Plan
`docs/plans/2026-10-27-usable-by-everyone.md`; spec ARCHITECTURE 30; `HANDOFF.md` 1k has what works, by what it is
proven, and what only Ralf can do. Six lanes (REALPAGES, ONBOARD, FAULTS, HELP, SHIP, MODEL), each reviewed with the
full diff and the proofs re-run; defect rounds on ONBOARD (the strip under a page's cookie bar, found by REALPAGES)
and MODEL (the default model failed 15 of 78 eval cases; now 77). The internet was down for about five hours in the
night and every agent was resumed from disk. Final `main` 91867cf: gate 3884 tests, suite ALL PASS, voice test ALL
PASS, pack check PASS, eval 77/78 on Sonnet 5.5, pushed to origin.

Next round candidates: the store upload (Ralf), the real-voice pass over the new pages, the round 9 plan's lane C
(DeepSeek drill, needs a key), the three faults left in HANDOFF 4 (F6 to F8), the postimees comment count read as
"(11)", "suur a" in an e-mail field typing "a".

### Round 8 (2026-10-22 night, overnight and unattended): done, merged into main, not pushed

Ralf's list of 2026-10-22 (17 items), triaged in `docs/plans/2026-10-22-round-8-plan.md`; `HANDOFF.md` 1j has
what works and by what it is proven; `docs/ARCHITECTURE.md` section 29 is the spec. Six lanes, each an Opus 5.5
agent in its own worktree, reviewed by the orchestrator against the full diff with every proof re-run: MEDIA
(29.1, seek by an amount, one round), FLOW (29.6, dictation cleaning measured on a stand-in set, two rounds: the
ee/ei negation hazard was added in review), DOCS (29.2, document mode and formatting, one round), MAIL (29.3,
mail by voice and addresses off the page, two rounds: "teema …" swallowed dictation everywhere), WAKE (29.4,
wake word and Minu kohad, two rounds: a place could not be added without hands, a weak suite check, the strip
covered the form), READ (29.5, two checkpoints: the measurement found an Estonian voice only in Edge, then the
reader was built; two rounds on the build: the microphone was muted for the whole article so "stopp" could not
be spoken, and `read` dropped the box undo). Merged in that order; WAKE and READ conflicted with the earlier
lanes in 10 and 17 files, all "both appended here", resolved keep-both (the `BrowserCommand` union needed its
members reordered by hand).

Final `main` 1394b91: `npm run check` green (44 files, 3499 tests); `npx tsx extension/test/run.ts` ALL PASS
twice (282 checks); `UTLE_REAL=1 npx tsx extension/test/voice.ts` ALL PASS twice (30 checks, dev server on port
5194); one live `/api/intent` ask with a page address logged `[intent] kind=command done=true plan=0 care=quick
ms=2185` and nothing else. Push to origin is disabled in this checkout: `main` is ahead of `origin/main` by the
whole round and the hosted server was not redeployed (no Railway project; `railway whoami` Unauthorized).

Still only Ralf can do: the Railway deploy, the calibration with a friend (1g), the read-backs, and everything
listed under "Not verified" in 1j. Parked with kill tests in the plan's section 5: speech impairments, video
calls, people who cannot write. The one question (plan section 6, "Linear"): nothing was created in Linear.

### Round 5 (2026-10-06): done

The owner's words after the demo with the real user, five of them: an e-mail, a phone number or an ID
code is very hard to put in (numbers come as words); a long prompt should be thought about before
acting, without slowing short commands; it got stuck thinking for minutes once; correcting a form
field was a hassle and a Smart-ID login needs "valmis" and "kinnita"; he could not zoom. Lanes on
branch `r5`: `fields` (`src/core/spelling.ts`, `BoxState.single` and `fieldKind` from `box.ts`, the
spell modes "numbritena" / "tavaliselt", "kirjuta kood X", the form keys, no preview and wait-first
in a one-line field, the read-back line, implicit submission on Enter, `fixtures/login.html`),
`brain` (`IntentRequest.care` with effort high, 800 tokens and 12 / 14 s for eight words or more, a
connective or a chain, the 25 s watchdog per job and goal, the seconds on the strip from 3 s, every
page command cut at 20 s, "katkesta", the M7 long-sentence guard and the M8 continuation window),
`zoom` (`zoom{in, out, reset}` through Chrome's tab zoom, 50 to 300 %), then `docs`. Nothing tried
with a real voice, on the real Smart-ID page or on a bank form. What the owner should try first: a
Smart-ID login on `fixtures/login.html` and then the real one (digits one by one, "valmis",
"kinnita"); a long chain with "Mõtlen pikemalt…" and the seconds, and a short command beside it;
"katkesta" mid-chain; "suurenda" twice. Next round candidates: the review's open items
(`docs/REVIEW-R5.md`); the field kinds measured against the real Smart-ID and bank pages; the
careful latency read from the eval; the round 3 and 4 leftovers still open in `HANDOFF.md`.

### Round 4 (2026-10-06): done

The owner's words after the demo morning: several things in one breath, the microphone hears other
people, and what he refers to on a page must be something the model can act on. Lanes dispatched
from the contract commit `9073ad1` on branch `r4`: `chain` (connectives and the 2.5 s hold in
`src/core/chain.ts` and the assembler, `onUtteranceContinued`, the model's `plan`, the chain of goals
in the engine with its caps, the chain line on the strip), `voice` (the speaker model fetched by
`npm run model`, enrolment from the settings page, `speaker` on every final, "Kuula ainult mind"),
`page` (text items `[sõnum]`, headings and paragraphs in `readPage`; `hover`, `contextMenu`,
`scrollTo`; every click starts with the hover sequence; the WhatsApp stand-in's delete-for-everyone
chain in the browser suite), then `docs`. `LONG_UTTERANCE_WORDS` is 60, so almost every dictation
is verified after typing. Nothing of it tried with a real voice or on a real site; the WhatsApp
message selectors are guesses marked UNVERIFIED. What the owner should try first: a chain on
YouTube ("mine youtube'i, siis otsi kassivideod, siis mängi esimene", watching the "2/3 · …" line);
`npm run model`, then **Õpeta mu hääl** on the settings page and **Kuula ainult mind** with someone
else talking; the WhatsApp chain "ava Karini viimane sõnum, siis kustuta see kõigi jaoks" on a chat
where that is harmless, and if no `[sõnum]` items or no `sõnumi menüü` appear, the four selector
lines in `extension/src/sites.ts`. Next round candidates: the review's open items; the round 3
leftovers (M3 barge-in on queued jobs, M6 "kustuta see" as undo, M5 Docs gluing); the other voice's
partials typed as a preview before its final is judged; the thresholds measured on his voice.

### Round 3 (2026-10-05 night): done, merged into main

Lanes dispatched from commit `5889326` on branch `claude/utla-voice-command-access-4ftxk4`:
`speech` (bounded backlog on the ASR server, lag message, flush, client-side guard, worker thread if
the addon allows), `engine` (stale utterances skip the model, barge-in cancels a loop, verification
off the critical path, lag on the strip), `ptt` (gaze push-to-talk, whole-bar target, settings,
speech-engine setting), `edit` (caret, select, typeText, keys; essay fixture; Docs best effort),
`nav` (phonetic matching, sound-alike site names, saadake, slow and little scroll, stop), `soniox`
(a second recogniser backend behind `SONIOX_API_KEY` and `?engine=soniox`). The default intent model
is now `claude-sonnet-5-5` (Opus 5.5 measured p50 2.7 s). Review lane (`docs/REVIEW-R3.md`) and docs lane merged; the whole round is on `main`. What the owner should try first: the speed under a screen recording, gaze mode with the whole bar, "kustuta sõna X" and "mine lause algusesse" in WhatsApp, "keri aeglaselt alla" then "stopp". Next round candidates: the review's open proposals (M3 barge-in on queued jobs, M6 "kustuta see" as undo, M5 Docs gluing), a Soniox run with a key, the eval again on Sonnet 5.5 with the editing cases, and whatever the morning's voice test reports.

### Rounds 1 and 2 (2026-10-05 evening): done, on GitHub

M7 (understanding by meaning, the armed box, the restyled strip, voice-usable settings) and M7.2
(type first and verify after, bounded multi-step loop, accessibility-tree readPage, trusted-click
arming, the review's fixes). Eval by the owner: 61 of 62 after dropping strict mode; the one miss
fixed in the engine. Details in `HANDOFF.md`.
