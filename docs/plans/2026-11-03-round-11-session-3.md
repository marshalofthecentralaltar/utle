# Ütle, round 11, session 3: prove the merged main on an idle machine, push, close the run

Hand-off from session 2 (2026-11-03, 15:50 to 18:10), four lines:

1. Local `main` is 39b4a4a plus one docs commit (HANDOFF 1l/1m corrected, 1w ×3, 2.5, 3, 4; the audit's re-run
   section), AHEAD of `origin/main` (bfa8994) and NOT pushed: `UTLE_REAL=1 voice.ts` sections 7 and 8 and
   `intent-eval.ts` never completed on the merged tree (two runs stopped by the harness for low memory; the
   machine held Chrome at 4.4 GB, the owner's dev server on 5173 and two orphaned vite processes, pids 39200 and
   36544, which this session was not allowed to kill).
2. All three lanes exited and are merged: WORDS (F4, F6; 2d7c5cc), FIRSTRUN (F1, F5; 43dbdf7), VOICE2 (F2, F3;
   39b4a4a). Proven on 39b4a4a: check 4340, run.ts 339, voice.ts sections 1, 2, 6. Proven on the lanes' own
   SHAs: section 7 (r11-voice2 133ae8b, 20 PASS), eval 112/112 (r11-words c2883a8).
3. Run `2026-11-03-utle-r11-demo-lanes` is OPEN in the ledger (monitor agent alive in session 2 only; a new
   session adopts the run per ORCHESTRATOR-STEPS 2b and relaunches the monitor as resuming).
4. Open for Ralf (defaults taken): the threshold stays 0.54 until he rules (the table is in HANDOFF 1w VOICE2 and
   ARCHITECTURE 31.8: 0.50 would reject about 24 % of his utterances instead of 28 %, margin 0.037 to the video's
   loudest clip); `C:\temp\utle-demo*` kept, to be deleted when he says the round is done; the friend's real
   address is in git history (7677f58 on main, 708acd8 on r11-firstrun): a history rewrite is his call.

## Do, in order

1. `ListAgents`; adopt the run: `node C:/Users/ralfs/orchestration-ledger/scripts/run.mjs adopt 2026-11-03-utle-r11-demo-lanes --session <uuid>`;
   relaunch the monitor (template `orchestration-ledger/templates/MONITOR-PROMPT.md`, "RESUMING", read the run
   directory first); `run.mjs monitor <run> --agent <id>`.
2. Machine first: CPU under 60 % over 10 s and 4.5 GB free (`Get-Counter`, `Win32_OperatingSystem`); if the two
   orphaned vite pids above still exist, ask Ralf to end them (or `taskkill //F //PID 39200 //PID 36544`
   if the permission is granted); leave pid 11132 (his dev server on 5173) unless he says otherwise.
3. Under the lock (`C:\Users\ralfs\utle-suite.lock`, one line "r11-s3 <what> <time> pid <n>"), in the primary checkout
   on local main: `UTLE_PORT=5194 npx vite --port 5194 --strictPort` then `UTLE_PORT=5194 UTLE_REAL=1 npx tsx extension/test/voice.ts`
   (expect ALL PASS, sections 1, 2, 6, 7, 8); `git checkout -- docs/proof`; then `npx tsx scripts/intent-eval.ts`
   (expect 112/112; note the YouTube recovery case). Write the counts into HANDOFF 3 and the audit's re-run table.
4. Green: `git push origin main`, confirm the SHA on origin. Red: the owning lane's files (server gate: VOICE2;
   addressee or rules: WORDS; strip, welcome, saved: FIRSTRUN) get a fresh Opus agent from a written hand-off.
5. Remove the three worktrees: `cmd //c rmdir <wt>\models` (unlink the junction first) then `git worktree remove
   <wt>`; prune per `scripts/prune-worktrees.sh`.
6. Close the run: self-assessment (five lines) in `runs/<run>/self-assessment.md`, `SendMessage` `closed` to
   the monitor, `run.mjs close <run> --status shipped` (partial if the suites stay red).

## Not in this session, for the next prompt (owners named in HANDOFF 4)

- His last enrolment phrase runs as a command after enrolment (server `enrolled` 45 ms before that final; 1v).
- A room voice that starts within 0.5 s of his last word is joined into his final (1v, issue #3).
- Short owner utterances (0.5 to 1 s) scored under the line get "not your voice" instead of "say it longer";
  quiet speech (RMS under 0.04) should say "come closer" (1w VOICE2).
- The YouTube recovery eval flake (2 of 7 runs scroll twice, 1p) and the hiss decode on a starved machine (1q).
