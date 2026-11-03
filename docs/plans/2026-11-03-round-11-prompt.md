# Ütle, round 11: make round 10 true, then make it hold up for a day of real use

## Frame

Ütle is for people who cannot use their hands. The next testers are care-home residents who are
younger and used to phones and computers: they will open WhatsApp, YouTube, mail, news and a login,
say things in their own words, and give up fast when it is slow or when it types what someone else
said. Round 10 built the pieces (fail-closed speaker gate, wake word, addressee check, faster finals,
ambiguity). Nothing has been run end to end, and two orchestrated runs are still open in the ledger.
This round makes the built thing true first, then stronger. Hard problem; do not undersell it.

Read fully before acting: `CLAUDE.md`, `HANDOFF.md` sections 1l to 1s, 2, 3 and 4,
`docs/plans/2026-11-05-round-10-prompt-6.md`, `docs/ARCHITECTURE.md` sections 31 to 35,
GitHub issues #2, #3, #4, #8, #9 and PR #11.

## Phase 0: reconcile (no new work before this is done)

State on disk at 10:36Z on 2026-11-03: `main` 5e4b9f1 equals `origin/main`. Session `utle-cloud-19`
was busy, having resumed lanes QUICK, EXIT and REALWAKE at 10:28Z after the overnight API outage.
Branch `r10-quick` is 4 commits ahead of main, unmerged (the addressee check asked on the stable
words). The `r10-exit` worktree holds uncommitted `extension/test/exit.ts`, a YouTube fixture and
`scripts/exit-set.ts`. Branch `r10-realwake` is 6 ahead and 8 behind, on PR #11.

1. `ListAgents`, then message `utle-cloud-19`: does it still own runs
   `2026-11-02-utle-r10-quick-exit` and `2026-11-02-utle-r10-live-realwake`? If yes, let it finish
   and touch none of its worktrees. If no answer in ten minutes, or it says it is done, adopt both
   runs per `ORCHESTRATOR-STEPS.md` and close each with its true status.
2. Done when: both runs are closed or owned by one live session; every `r10-*` branch is merged, on
   a PR for Ralf, or named in HANDOFF with why it is not; the gate is green on the merged SHA with
   the three commands below and their counts written into HANDOFF.

```
npm run check
npx tsx extension/test/run.ts
UTLE_REAL=1 npx tsx extension/test/voice.ts
```

## Phase 1: claims against proof

For every HANDOFF section 1l to 1s, list each claim and the artifact that proves it (test name,
log line, screenshot, eval table). Run the proof again on `main`; reading an old log is not proof.
Sort into three columns: proven on main today; built but never met a real voice or a real page;
claimed with no artifact. Fix what the re-run finds red before anything else; a found defect is
fixed, not sent to Ralf as a choice. Output: `docs/plans/2026-11-03-round-11-audit.md` with one
table, and HANDOFF sections 3 and 4 corrected to match.

## Phase 2: the weak spots, ranked for a tester day

From the audit and HANDOFF 4, rank what breaks a ten-minute session for a younger resident with a
helper beside them. Known candidates: the round's exit test (#9) has never run end to end, not even
on stand-ins; a dictated sentence lands in the box 2.7 to 3.3 s after the speaker stops; the strip
covers the consent button on youtube.com and ilmateenistus.ee; the speaker threshold 0.54 was
calibrated on synthetic voices only; recogniser errors on ordinary speech (P7 in the round 10 plan);
the wake word in audio exists only on PR #11; the intent eval's YouTube recovery case scrolled twice
in 2 of 7 runs. Rank by three things: how often a tester meets it, whether a fix needs Ralf or a real
voice, and what proves the fix. Then write a brief plan: at most three lanes, each criterion paired
with the command or screenshot that proves it, nothing that needs Ralf's recordings or a real voice.
Wait for Ralf's go before dispatching.

## Phase 3: after Ralf's demo recording

After his EIS meeting Ralf records about five minutes of his own use. Inputs: the recording, the dev
server log, `UTLE_CAPTURE`'s `log.tsv` (words and gate verdicts; audio never enters the repo), and
the strip's lines. Method: build a timeline, one row per utterance: what was said, what the
recogniser wrote, what the engine did, what he meant, seconds between. Every miss gets a class
(recogniser, gate, addressee, intent, page, latency) and a reproduction on a stand-in page before
any fix is proposed. Output: a defect table and the next prompt's plan. The capture folder holds
personal data and stays out of git.

## Rules

- Orchestrator Fable 5.1; every dispatched agent, the monitor included, Opus 5.5.
- `lane-dispatch` to brief, `lane-review` after every report; two to four review rounds is normal,
  one round means nobody looked. Ledger registration before any dispatch.
- Each worktree gets `models/` as a junction; unlink it before the worktree is removed.
- The machine is shared: check free memory and CPU before a timed run; a timed run under load is void.
- Behaviour changes start as a test in `src/core`. The server never logs document text, utterances
  or audio. `npm run check` before anything is called done.
- Push only green work; confirm the pushed SHA.
- Stop for Ralf only on: product direction (who the testers are, what to drop), money, PR #11's
  merge, the consent text, the cloud decision. Everything else: decide as the engineer who owns the
  outcome and say so in one line.
- Report with the outcome first. Every claim of green ties to a command output from this session;
  what was not run is named as not run.
