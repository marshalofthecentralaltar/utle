# Ütle, round 11, session 2: dispatch the three lanes from Ralf's demo

Paste this unchanged into a fresh session in `C:\Users\ralfs\utle-cloud`. Pasting it is Ralf's go for the
three lanes below; ask nothing before dispatch except what this file marks open.

## Read fully before acting

- `CLAUDE.md`; `docs/plans/2026-11-03-round-11-prompt.md` (the round's frame and rules; its Phases 0, 1
  and 3 are done or in flight as stated here, Phase 2 is this session).
- `docs/plans/2026-11-03-round-11-demo-brief.md`: the six findings F1 to F6 from Ralf's own demo
  (2026-11-03 15:20 to 15:29), with the timeline, evidence and the lane table. This is the brief's source.
- `docs/plans/2026-11-03-round-11-audit.md`: round 10's claims against proof; its re-runs are still owed.
- `HANDOFF.md` sections 1u, 1v, 2, 3, 4 on `origin/main`; `docs/ARCHITECTURE.md` 31 to 35.

## State at 15:50 on 2026-11-03 (measured, not remembered)

- `origin/main` is 0921400 or later: EXIT part 1 (873a024), QUICK (64d718e), EXIT part 2 (6070983), a
  HANDOFF 4 docs commit (0921400). Local `main` in the primary checkout is behind: `git pull` first.
- Session `utle-cloud-19` still owns run `2026-11-02-utle-r10-quick-exit`: its integration batch (two
  rehearsals, the control, full `UTLE_REAL=1 voice.ts`) runs under the suite lock
  `C:\Users\ralfs\utle-suite.lock` in `C:\Users\ralfs\utle-cloud-r10-merge`. It sends a close message
  with the final gate counts. `ListAgents` first; if it is gone and the run is still open in the ledger,
  adopt and close it per `ORCHESTRATOR-STEPS.md` 2b. Nothing heavy runs here until that lock is free.
- Run `2026-11-02-utle-r10-live-realwake` is closed. PR #11 (wake word in audio) waits for Ralf.
- Three untracked files in the primary checkout, written by session 1, not committed:
  `docs/plans/2026-11-03-round-11-prompt.md`, `-audit.md`, `-demo-brief.md`. Commit them to main
  after the pull (docs only, one commit), then push.
- Ralf's demo capture: `C:\temp\utle-demo` (103 wav plus `log.tsv`; his voice, a YouTube video's speech,
  a friend's e-mail address; never into git). Labelled set: `C:\temp\utle-demo-labels\labels.tsv`,
  `label.ts --check --owner ralf` says ready (owner enrol 7, owner trials 68, other trials 9; 19 clips
  of his own recording played back through the speakers were removed). The dev server with capture may
  still be running on 5173 from session 1 (`curl localhost:5173/api/status`); leave it if Ralf is using it,
  stop it before any timed run.
- ffmpeg is installed (winget, Gyan.FFmpeg) for the recording at
  `C:\Users\ralfs\Videos\Screen Recordings\Screen Recording 2026-11-03 152746.mp4` (starts 15:20:18).
- The machine is shared: timed or real-model runs only at CPU under 60 % over 10 s and 4.5 GB free, under
  the lock; a timed run under load is void. Every worktree gets `models/` as a junction
  (`cmd //c mklink //J <wt>\models C:\Users\ralfs\utle\models`); unlink before removal.

## Lanes (three, Opus 5.5 each, `lane-dispatch` briefs, `lane-review` after every report)

| Lane | Findings | Owns | Done when |
|---|---|---|---|
| VOICE2 | F3 (the sweep on the real set, the threshold policy, short words), F2 (no backlog drop inside an enrolment phrase) | `server/speaker.ts`, `server/asrSession.ts`, `scripts/speaker-calibrate.ts`, ARCHITECTURE 31 | the sweep table on `C:\temp\utle-demo-labels` for four models with EER per speech-length bucket is in HANDOFF; the chosen policy's false-reject rate on his 68 clips and false-accept on the 9 video clips are stated; `asrSession.test.ts` proves a slow decoder drops nothing inside a phrase; voice.ts section 7 green |
| WORDS | F4 (rules for his phrasings; replay of the session's 48 verified utterances through `inpageStep`, count model asks before and after), F6 (addressee treats the sentence after a read-back as addressed) | `src/core/inpage.ts`, `src/core/phonetic.ts`, `server/addressee.ts`, `server/intentPrompt.ts`, `scripts/intent-eval.ts` | the replay fixture is a test; the model-ask count on it falls and is stated; two eval cases built from his exact correction sentences pass; eval 106+ cases at or above today's pass rate |
| FIRSTRUN | F1 (the profile-missing lines say "teach your voice first"; only-my-voice never on with no profile after the welcome), F5 (contacts in Minu andmed: name plus address, "kirjuta Nadimile"; "vale" in a read-back clears and spells letter by letter) | `extension/src/offscreenMain.ts`, `welcome.ts`, `options.ts`, `src/core/saved.ts`, `strings.ts` | an engine test names the line per gate reason; `run.ts` has the welcome path and a contact case; a `saved.test.ts` case for a contact; an eval case on the Gmail stand-in |

Rules binding all three: the sweep (VOICE2) runs first under the lock and before any threshold change;
WORDS and FIRSTRUN start at once from `origin/main` in their own worktrees (ports 5188, 5189, 5190); no
lane edits another's files (a finding goes to the orchestrator); test first in `src/core`; the server
never logs words or audio; `npm run check` quiet, read only failing steps; two to four review rounds
per lane; nothing merged before a lane exits; after every merge, `run.ts` and `UTLE_REAL=1 voice.ts` on
the merged tree under the lock; push only green; HANDOFF 1w per lane with the numbers.

## Open for Ralf (ask once, at the start, one line each; defaults in brackets)

1. The threshold policy from the sweep, if it trades false rejects for false accepts [keep today's line
   until the sweep's table is in front of him].
2. Whether the capture folder may be kept for the round [kept until the three lanes close, then deleted].

## Dispositions

| Item | Class | Status | Evidence |
|---|---|---|---|
| F1, F2, F4, F5, F6 | defect / missing | marked-unresolved, each owned by a lane above | `docs/plans/2026-11-03-round-11-demo-brief.md` Dispositions table: frames, server log lines, code lines per finding |
| F3 threshold line | method-choice | choice-for-ralf only after the sweep's table exists | `C:\temp\utle-demo-labels\labels.tsv` ready (`label.ts --check --owner ralf`); the overlap 0.35 to 0.46 in `C:\temp\utle-demo\log.tsv` |
| Keeping the capture folder | method-choice | choice-for-ralf (personal data) | the folder holds his voice and a third party's address; `docs/PRIVACY.md` |
| Round 10 re-runs on merged main | unverified | marked-unresolved until the peer's lock is free | `C:\Users\ralfs\utle-suite.lock` held by the peer's integration batch since 15:32 |

## At the end

Audit's owed re-runs on the merged main (`run.ts`, `UTLE_REAL=1 voice.ts`, `intent-eval.ts`), their
counts into HANDOFF 3 and the audit file; the two stale HANDOFF lines (1l "PR #10 open", 1m "r10-voice
not merged") corrected; the run closed with its self-assessment; `git status` clean, `main` =
`origin/main`; a four-line hand-off for session 3 at the top of this file's successor.
