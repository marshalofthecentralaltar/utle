# Round 13 prompt: make Ütle read as if a senior team had built it

Written 2026-11-03 after round 12 from a measurement of the tree at `b17e956`, not from a style guide. Paste
the block below as the session's first message. The numbers in it are the baseline the lanes are judged
against.

---

## Task

Ütle is a Chrome extension plus a local server (TalTech speech model, Claude for intents) for people who
cannot use their hands. It works and is tested (4,089 unit tests, 339 browser commands). Round 12 removed
what nothing reached and split the three largest files. This round changes how the code is shaped so that
a second engineer can own a part of it without reading all of it, and so that a defect cannot reach `main`
unseen. No feature changes. Every lane proves "no behaviour change" with the existing suites unchanged.

Treat this as the top of your range: the obvious version (rename things, add comments) is not it.

## What the measurement found (the brief is built on these; re-measure before you start)

| Finding | Evidence at b17e956 | What a senior team does instead |
|---|---|---|
| The product's state machines live inside closure factories | `createEngine` 804 lines, 204 branches; `createAsrSession` 510/130; `createLocalRecognizer` 500/115; `mountStrip` 372/78; `createGoals` 323/92; `createSpeakerGate` 187/66; `startOffscreen` 260/44. 45 functions with 25+ branches | An explicit machine per concern: a typed `State`, a typed `Event`, one pure `step(state, event, now) → { state, effects }`, and a thin shell that runs effects (timers, sockets, DOM, chrome.*). `src/core/listen.ts` already does this (`listenFinal(state, word, utterance, now)` returns the next state and an event): copy that shape |
| Import cycles | madge: 17 cycles (11 inside `extension/src/page/`, 4 inside `extension/src/engine/`, `src/core/saved ↔ strings`, `server/asrSession ↔ capture ↔ speaker`) | Dependency direction is a rule the gate enforces: `madge --circular` is in `npm run check` and must print 0 |
| Lint has no rules | `.oxlintrc.json` lists plugins only; the `src/core` purity rule exists only as prose in CLAUDE.md; 65 `as` casts in product code | Rules that encode the architecture: no-restricted-imports for `src/core`, max-lines-per-function, complexity, no-explicit-any already; `noUncheckedIndexedAccess` on; casts justified or removed |
| Nothing runs the gate but a person | no `.github/`, no hooks; main was 17 commits ahead of GitHub for a day; a 0-width Chromium window failed the suite once with no record | GitHub Actions on push and PR: `npm run check`, then `run.ts` headless; the voice suite and the eval stay manual but their last run is recorded in one place |
| Settings are read raw everywhere | `chrome.storage` at 79 sites in 10 files; no settings module | One `extension/src/settings.ts`: typed keys, defaults, read, write, `onChange`; the only file that names `chrome.storage` |
| Language logic is duplicated | `browserDoing` is 67 branches in `strings/et.ts` and again in `strings/en.ts` | Text is data, logic is one function: the tables hold the lines, one `browserDoing(command, lines)` picks them |
| Errors vanish | 0 `console.*` in the extension; `catch {` with an empty reason in `background.ts` at 51, 98, 194, 205, 229; the server's error type is still `InterpretError` (34 uses) for a route removed in round 12 | A `Failure` result type at boundaries; one `report(where, error)` that keeps the last 50 in memory and shows them on the help page's "Mis juhtus" section; `ApiError` on the server |
| Page scripts are global state | `options.ts` has 12 module-level `let`s, `welcome.ts` 11 | One state object per page, built in `main()`, passed down |
| Tests are organised by file, not by behaviour | `engine.test.ts` 3,556 lines; `inpage.test.ts` 2,696; `run.ts` 2,240 in one file | A folder per behaviour with shared builders; the machine tests are transition tables (state, event → state, effects) a reader can scan; `run.ts` becomes a runner plus one file per command family |
| The spec is a 3,277-line history | `docs/ARCHITECTURE.md` sections 1 to 20 are history by its own rule; 33 sections of changes in round order | `docs/ARCHITECTURE.md` is the current system in under 1,200 lines; the rounds move to `docs/history/`; each decision that still binds (speaker gate line, type-first-verify-after, rules-before-model) becomes one ADR under `docs/adr/` |

## Context files (read fully before any change)

- `CLAUDE.md`: the rules; `HANDOFF.md` "State now": what is true today; `docs/plans/2026-11-03-round-12-structure.md`: how round 12 proved a move with git's move detection.
- `src/core/listen.ts` and `src/core/listen.test.ts`: the reference shape for a machine and its tests.
- `extension/src/engine.ts`, `extension/src/engine/*.ts`: the engine today; `extension/src/engine.test.ts` is its proof and must not change.
- `server/asrSession.ts`, `src/speech/local.ts`, `server/speaker.ts`: the speech side; their tests likewise.
- `extension/src/messages.ts`: the typed message unions (keep this shape; it is already right).
- `extension/README.md` "Test": how the suites run; `docs/ARCHITECTURE.md` 21 to 33: the live spec you will later shorten.

## Lanes (one worktree, one branch, one Opus agent each; dispatched with the lane-dispatch skill)

Run GATES first alone; the other three start from its merge so every lane is judged by the new gate.

**GATES** (small). Add `scripts/shape.ts` (function length, branch count, nesting; the round 12 scratchpad script is the start) and `madge` to `npm run check` with thresholds: 0 cycles; no function over 150 lines or 40 branches except a listed allowance that shrinks per lane; `.oxlintrc.json` gains `no-restricted-imports` for `src/core` (no `speech`, `api`, `ui`, `server`, DOM globals), `max-lines-per-function` 150, `complexity` 40, `no-restricted-syntax` for `as` outside a `// cast:` justification; `tsconfig` gains `noUncheckedIndexedAccess` with the resulting errors fixed by narrowing, not casts. `.github/workflows/check.yml`: `npm ci`, `npm run check`, `npx tsx extension/test/run.ts` with Playwright's Chromium, on push to main and on PRs, 20-minute limit. Proof: the workflow green on its own branch before merge (link the run); `npm run check` prints the shape table and `madge` 0.

**MACHINES** (large). Rewrite the engine as `extension/src/engine/machine.ts` (pure: `EngineState`, `EngineEvent`, `step`) plus `extension/src/engine.ts` as the shell that owns timers, the recogniser, the page bridge and `deps.publish`, and translates effects. `createEngine(deps)` keeps its signature and every export, so `engine.test.ts` stays byte-identical and green. Same for `mountStrip` (`strip/machine.ts` + DOM shell) if it fits the budget; say so if not. Proof: `git diff main --stat -- extension/src/engine.test.ts` empty; shape table shows no engine function over 150 lines; a new `engine/machine.test.ts` of transition rows covering every event; `run.ts` 339; `UTLE_REAL=1 voice.ts` all sections with the real model (this lane changes timing paths, so the owed run is this lane's proof, on an idle machine).

**SPEECH** (large). The same shape for `server/asrSession.ts` (`asrSession/machine.ts`: endpointing, holds, the final's cut; the decoder thread stays a shell), `src/speech/local.ts` (reconnects, continuation, the hold) and `server/speaker.ts` (`createSpeakerGate` → a pure decision over scores and durations). Break `asrSession ↔ capture ↔ speaker` by moving the shared types down. Tests for those three files unchanged and green; `voice.ts` sections 1, 2, 6, 7, 8 with the real model; `intent-eval.ts` 112/112 (the prompt is untouched, this proves the join).

**EDGES** (medium). `extension/src/settings.ts` (the one `chrome.storage` file; 79 sites become calls on it); `extension/src/report.ts` (the failure channel; the five empty catches in `background.ts` name their reason; the help page shows the last 50); `InterpretError` → `ApiError`; `browserDoing` and any other per-language logic → one function over data (the string tables lose their functions; a type test proves `et` and `en` have the same keys); the page cycles in `extension/src/page/` broken by moving shared lookups into `page/common.ts` or by passing a function in; `options.ts` and `welcome.ts` state into one object each. Proof: `grep -rl chrome.storage extension/src` prints one file; madge 0; shape table; `run.ts` 339; the settings page and the help page exercised in `run.ts` (existing cases) plus two new cases for the report list.

**TESTS AND DOCS** (medium, after MACHINES and SPEECH merge). Split `engine.test.ts`, `inpage.test.ts`, `asrSession.test.ts`, `local.test.ts` into folders by behaviour with shared builders in `test/builders/`; the Chromium suite into `extension/test/run/` with one file per command family and a 60-line runner; same counts after (4,089 plus the machine tests; 339). ARCHITECTURE.md to under 1,200 lines of current system; the removed text to `docs/history/rounds.md` verbatim; `docs/adr/0001-rules-before-model.md` and the others, one page each, with the date and the measurement that decided them. HANDOFF "State now" updated; the rest of HANDOFF moves to `docs/history/handoff-rounds.md`.

## Rules for every lane

- No behaviour change; the existing test files for the code you touch are byte-identical (`git diff main --stat -- <test files>` empty) and green. New tests are added beside them.
- No new runtime dependency. `madge` and Playwright's Chromium are dev-only.
- The shell/machine split is the design; a machine never imports a timer, a socket, the DOM or `chrome.*`, and the gate's `no-restricted-imports` proves it.
- Each criterion has a command and its expected output; paste the actual output in the report. A proof the agent did not write (the unchanged suites, madge, the shape table, the workflow run) stands beside every proof it did.
- Quiet gates: logs to a file, read only the failing step. Report under 2,000 tokens, long output under `artifacts/`.
- The orchestrator reviews every lane with the lane-review skill before merge (move-aware diff where a move is claimed, a transition-table read for a machine), merges in the order GATES, EDGES, MACHINES, SPEECH, TESTS AND DOCS, re-runs the gate and `run.ts` on each merged tree, pushes, and confirms the Actions run green for the pushed SHA.

## Done when

- `npm run check` includes madge (0 cycles) and the shape table, and is green at 4,089 tests plus the new transition tests, each named.
- `run.ts` 339 PASS on the final main; `UTLE_REAL=1 voice.ts` all sections and `intent-eval.ts` 112/112 on the final main, on an idle machine, logged in HANDOFF "State now".
- The Actions workflow is green for the final SHA.
- No function in product code over 150 lines or 40 branches without a listed allowance; `chrome.storage` in one file; `InterpretError` gone; ARCHITECTURE under 1,200 lines with the history and ADRs in place.

## Out of scope

Any new command, phrase, model or setting; the measurement scripts under `scripts/` beyond `shape.ts`; the store packet; `relay.js` (stays until the suite drives commands another way); the site.

## Checkpoint rule

Pause only for a destructive action outside the worktree, a scope change, or a question only the owner can answer (there should be none: the design is decided above). Otherwise run end to end and never end a turn on a promise.
