# Ütle: handoff

Written 2026-10-05 about 01:30, for a fresh session with no context. Read this first, then
`docs/ARCHITECTURE.md`. Everything stated as fact here was observed in the session that wrote it;
what was not observed is marked.

## 1. The two problems to solve first

**Ralf's verdict on the current state: he cannot use voice at all, and the design is the ugliest
he has seen Claude produce.** Start here. Do not start by adding features.

### 1a. Voice does not work for him

He sees "Speech recognition needs an internet connection. Type instead." on localhost.

- That text is this app's wording for the browser's `network` error from `SpeechRecognition`
  (`src/speech/webSpeech.ts`, the `ERRORS` map). It means the browser could not reach its speech
  service. It does not necessarily mean he is offline.
- Most likely cause, NOT verified: the page is open in something other than Google Chrome.
  VS Code's built-in browser, Brave, and other Chromium builds have no access to Google's speech
  service and fail with exactly this error. Ask him which browser he used before anything else.
- If it is real Google Chrome with working internet, the next suspects are a VPN, a firewall or
  a network that blocks Google's speech endpoint. Not investigated.
- Known bug that makes this worse: `network` is not in the `FATAL` set in `webSpeech.ts`, so after
  the error the recogniser keeps restarting every 250 ms and failing again, while the interface
  already shows the microphone as off. Fix: stop on `network`, or back off.
- Voice has never been tested by a person in this project. Every "voice works" claim so far
  rests on unit tests and on a scripted recogniser, not on a microphone.
- The app depends on Chrome's cloud recognition by design decision D6. If that cannot be made to
  work for him, the `Recognizer` interface (`src/speech/recognizer.ts`) is the seam for another
  recogniser. Candidates researched but not tried: ElevenLabs Scribe realtime, Deepgram Nova-3
  streaming (both support Estonian), TalTech's own tekstiks.ee. Each needs an account and a key,
  which only Ralf can create.

### 1b. The design was rejected, twice

- First design (dark teal, Bricolage Grotesque): "super ugly", "need good non-AI looking design
  and branding".
- Second design (what is in the repo now): "genuinely never seen Claude design something this ugly".
- What is in the repo now, so you know what failed: Atkinson Hyperlegible Next for everything; a
  white sheet that stays white on a dark desk in the dark theme; red strikethrough for removed
  text, blue underline for added text, a yellow highlighter for "which one" candidates; a black
  caption strip fixed to the bottom with "You" and "Ütle" lines; the wordmark "ütle" whose two
  dots are a red listening light. He only ever saw it in the dark theme. The light theme was
  never looked at by anyone.
- He has not said what he wants instead. Do not guess a third time. Ask him for one or two
  references he likes, then show two or three clearly different directions as a mock and let him
  pick BEFORE touching app code. His standing rule is plan, then mock he approves, then implement.
- The design lives almost entirely in `src/index.css` (tokens, wordmark) and the Tailwind classes
  in `src/ui/*.tsx`. No logic depends on it, so it can be replaced freely.

## 2. What this is

A document editor for people who cannot use their hands. You say what you mean, the editor
shows what it understood, and you repair it in one word. Working name Ütle, Estonian for "say".

It is a hackathon prototype for the **NewWorkTech Inclusive Digital Innovation Hackathon**,
TalTech Mektory, room MEK-011, Raja 15, Tallinn, **5 and 6 October 2026**. Ralf attends alone and
joins a team formed on site.

Challenge 2, verbatim: "People with limited hand or arm dexterity may rely on speech-to-text,
while speech recognition and voice-based editing do not always work effectively. Prototype a
more accessible way to create, navigate and edit workplace documents using speech and voice
commands. Based on NewWorkTech fieldwork in Denmark."

### The event

- Six teams of four or five, two teams per challenge. Teams form Monday 11:30. He may not get
  challenge 2. The rules on pre-built code are not published; he should say openly what he brought.
- Output: clickable mock-up or proof of concept, plus a pitch to a jury Tuesday 14:30.
- Monday: 9:30 registration, 10:00 to 11:30 talks, 11:30 team formation, 13:30 to 16:30 teamwork.
  Tuesday: 10:00 three-minute recap per team, 10:30 to 12:30 teamwork, 13:30 pitch preparation.
- Challenge 2 is introduced at 10:45 by Ilmari Jyskä (Tampere University). The fieldwork behind it
  is unpublished. Questions worth asking him: which software and language the Danish participants
  used; where editing breaks (accuracy, moving around, correcting, formatting); whether they have
  typical speech; what they do when recognition fails.
- Judging criteria, prizes and pitch length are not published.

### The idea in one paragraph

Voice tools make people describe hand movements out loud. Ütle works like two colleagues when one
has the keyboard: **refer** (point by meaning, or by the number every paragraph carries), **show
understanding** (the proposed change appears before anything changes), **repair** (yes, no, a
number, or only the corrected word). Edits need a yes; moving and reading do not.

### Why it should matter to the jury (research done on 4 October)

- Studies of hands-free dictation (Sears and colleagues, 2001 to 2003): about two thirds of the
  time went on correction, one third on navigation alone, and navigation commands failed about
  15 percent of the time. A 2026 study (VoiceAlign) names the same failures in today's built-in
  voice control: rigid phrasing, timeouts on pauses, poor feedback.
- What does not exist: natural-language voice control from Apple and Microsoft is English only;
  Word and Google Docs run their full voice command sets only in English; Windows Voice Access
  has no Danish, Estonian or Finnish; Dictus Classic, the Danish voice-control program, is not
  supported on current Windows 11; AI dictation apps (Wispr Flow, Aqua Voice) need a held hotkey
  or a highlighted passage, so a hand.
- The project's own method is conversation analysis, where "repair" is a central concept.
- Product claims come from vendor pages and reviews, not from testing.

Full research with sources, as private pages Ralf owns:
- Brief for all three challenges: https://claude.ai/artifact/1Tjk9iY8QSgvHXciXRok3a
- Concept report and the first clickable mock-up: https://claude.ai/artifact/V84UaVNkbmtPPMea8oyqMX

## 3. Where everything is

Project: `C:\Users\you\utle`. Local git repository, branch `main`, no remote, clean tree at
commit `05d8c1b` plus the commit that adds this file. It is NOT part of the EFS platform repository
and must not touch it.

| Path | What |
|---|---|
| `docs/ARCHITECTURE.md` | The spec: principles, data model, state machine tables, decisions, state of the build (section 17), voice tiers (18), design (19, rejected) |
| `docs/plans/` | The two plans the build followed, with their status |
| `CLAUDE.md` | Rules for sessions in this repo |
| `src/core/` | Pure logic, no DOM or network: `document`, `ops`, `preview`, `candidates`, `intent`, `quickReply`, `localIntent`, `session` (the state machine), `wer` |
| `src/speech/` | `recognizer` (interface), `webSpeech` (Chrome), `assembler` (joins pauses), `scripted` (replays a script), `synth` (read aloud), `level` (microphone level), `lines` (demo and voice-check lines) |
| `src/api/interpretClient.ts` | Browser to server |
| `src/ui/` | `App`, `DocumentView`, `CaptionStrip`, `Margin`, `VoiceCheck`, `Wordmark`, `useSession` (the only place effects run) |
| `server/` | `interpret` (asks the model for one validated tool call), `tools`, `prompt`, `rehearsal` (scripted answers, no model), `vitePlugin` (hosts `/api/interpret` and `/api/status` on the dev server) |
| `scripts/smoke.ts` | Plays the demo through the real model |

Stack: React 19, Vite 8, TypeScript strict, Tailwind 4, Vitest, zod 4, `@anthropic-ai/sdk`. Node 22.

## 4. How to run it

```
cd C:\Users\you\utle
npm run rehearse   # scripted answers for the demo lines: no key, no network needed for the logic
npm run dev        # real model: needs a working ANTHROPIC_API_KEY in the environment
npm run check      # typecheck, lint, 263 tests, build
npm run smoke      # the demo through the real model; a few cents; currently fails on the key
```

| Address | What it does |
|---|---|
| `/` | The editor. Typed input in the bottom strip goes through the same path as speech. |
| `/?voice=demo` | The demo plays itself with a scripted recogniser. No microphone involved. |
| `/#check` | Voice check: read lines aloud, get the share of words recognised wrong, per language. |

To leave a running dev server in a terminal: Ctrl+C.

## 5. How it works, in five lines

1. An utterance (spoken or typed) goes to `step(session, event)` in `src/core/session.ts`, a pure reducer.
2. Tier 1, `quickReply`: yes, no, a number, undo, stop, help, sleep, wake. No network.
3. Tier 2, `localIntent`: go to a heading or paragraph, next, previous, read aloud, delete paragraph N. No network. English and Estonian.
4. Tier 3: the reducer emits an `interpret` effect; the server asks Claude (default `claude-haiku-4-5`, env `UTLE_MODEL`) for exactly one of four strict tool calls, checks it against the document, retries once with the error, else answers "not understood".
5. Every tier yields the same `Intent`. An edit becomes a preview (`buildPreview`) and is applied only on yes. Undo is a stack of whole documents.

The model returns operations (`replace_text`, `set_text`, `insert_block`, `delete_block`,
`move_blocks`), never a rewritten document. `replace_text.find` must occur exactly once in its block.

## 6. State, honestly

| Thing | State |
|---|---|
| Unit tests | 263 pass (`npm run check` exit 0 at 01:14 on 5 October). |
| Interface logic in a browser | Walked with typed input in rehearsal mode: preview, yes, no, keys, move, which-one, repair, insert, navigation, undo, sleep, read aloud, stop, help. |
| Scripted demo | Played hands-off to the end once. Observed through the DOM, in a hidden automation tab with throttled timers, so real pacing was never seen. |
| Real model | NEVER run. The Windows user-level `ANTHROPIC_API_KEY` is rejected: `401 authentication_error: API key is invalid`. Ralf said to leave the key alone; he is looking into it. The prompt (`server/prompt.ts`) and tool schemas (`server/tools.ts`) are therefore unproven. `npm run smoke` is the first thing to run once a key works. A key exists in the EFS project's `.env.local`; it was deliberately not used and must not be without his say. |
| Real voice | NEVER tested. See 1a. |
| Estonian | Quick replies and local commands are unit-tested in Estonian. The Estonian was written by a non-native; Ralf is native and should check `src/core/quickReply.ts`, `src/core/localIntent.ts` and `src/speech/lines.ts`. Recognition quality in Estonian is unknown. |
| Design | Rejected. See 1b. |
| Light theme | Never looked at. |
| Word import and export, tables, formatting, persistence, deployment, Word add-in | Not built. Out of scope by decision. |

## 7. How Ralf works (follow this)

- Plan first, in writing, before any code. "Nothing done on vibes." The spec and the plans were
  written and committed before the code each time.
- Visible changes: a mock he approves before app code changes.
- A question from him is not an instruction. Answer it, name the act, then act only if it is
  clearly what he asked for and reversible.
- He decides money, credentials and product direction. Ask one plain question with a
  recommendation first. Never propose spending or topping up API credit.
- Evidence, not assertion: every "works" carries the command and its output or a screenshot
  that was actually looked at. Say what was not verified.
- Short, direct answers. No filler. If something is bad, say so.
- Stage explicit paths in git. Local commits only here. Co-author line on commits.
- He is 18, a solo developer and first-year TalTech informatics and AI student, native Estonian.

## 8. Traps found the hard way

- **Shell quoting.** Never put backticks or multi-line text into a `node -e "..."` or any
  double-quoted shell string. One such command executed pieces of markdown as shell commands and
  stripped the code spans out of the spec. Write content with the file tool, or put a script in a file.
- **Hidden tab.** The browser automation tab is hidden, so Chrome throttles timers and screenshots
  can be stale or time out. Read the DOM to confirm state, and do not claim timing was observed.
- **Unlayered CSS beats Tailwind utilities.** Element rules in `index.css` must sit in `@layer base`
  or they override utility classes (this hid the text of the selected language button).
- **Reading aloud is real.** `read paragraph four` makes the machine speak. Mute or use `stop`.
- **Imports carry the `.ts` extension** and types use `import type`; the server project compiles
  with `nodenext` and `verbatimModuleSyntax`.
- **Effects are a union now** (`interpret`, `speak`, `hush`). Use `effects.find((e) => e.type === 'interpret')`, not `effects[0]`.
- **Rehearsal mode only knows the demo lines** on the sample document. It is a stand-in, clearly
  labelled in the interface, not a model.

## 9. What a sensible next session does, in order

1. Ask which browser he used, and get voice working for him in real Google Chrome, or decide on
   another recogniser. Fix the `network` restart loop.
2. Ask what he wants the product to look like, mock two or three directions, get one approved,
   then replace the design.
3. When he has a working key: `npm run smoke`, then tune `server/prompt.ts` against what the
   model actually does.
4. Have him run the voice check in English and Estonian and record the scores.
5. Only then anything new.

The hackathon starts Monday 5 October at 9:30. Time matters more than completeness.
