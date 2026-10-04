# Ütle

A document editor for people who cannot use their hands. Say what to change, see what was
understood, fix it in one word. Hackathon prototype: NewWorkTech, TalTech Mektory, 5 and 6 October 2026.

The design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The plans this build followed are in
[docs/plans/](docs/plans/).

## Run it

```
npm install
npm run rehearse   # scripted answers for the demo lines: no key, no network
npm run dev        # the real thing: needs a working ANTHROPIC_API_KEY in the environment
```

Open the address Vite prints, in Chrome.

| Address | What it does |
|---|---|
| `/` | The editor. Turn the microphone on once; after that it starts by itself. |
| `/?voice=demo` | The demo plays itself, hands off. Nobody needs to speak. |
| `/#check` | Voice check: read the lines aloud and get a recognition score per language. |
| `/?voice=demo#check` | The voice check played by the script, to see what it looks like. |

Typed input goes through exactly the same path as speech.

## What works without a model

Yes, no, a number, undo, stop, help, stop listening, wake up. Go to budget, next, previous, top,
bottom, paragraph six. Read paragraph four, read the summary, read it. Delete paragraph two.
All of these in Estonian too. Everything else needs the model, or rehearsal mode for the demo lines.

## The demo script

1. Change the budget deadline to Friday.
2. Yes.
3. Move risks above next steps.
4. Yes.
5. Shorten the sentence about the supplier.
6. Two.
7. Yes.
8. Add a next step: Marten sends the contract by Wednesday.
9. Not Wednesday. Tuesday.
10. Yes.
11. Read paragraph four. Stop.
12. Go to budget.
13. Undo.
14. Stop listening.

Space is yes and escape is no, for anyone who has one switch. The three counters beside the
sheet are the measurements for the pitch.

## Checks

```
npm run check      # typecheck, lint, 269 tests, build
npm run smoke      # the demo script through the real model; spends a few cents
```

## What is proven and what is not (5 October 2026)

- Proven by tests: document operations, preview, quick replies and local commands in English
  and Estonian, the whole conversation as a state machine, reading aloud never producing an
  edit without yes, the server's validation and single retry, pause joining, word error rate.
- Proven in the browser: the interface in rehearsal mode with typed input, the demo playing
  itself hands-off to the end, the voice check in scripted mode.
- Not proven: the real model (`npm run smoke` fails because the API key on this machine is
  rejected), a real voice, real Estonian recognition, the light theme, timing at real speed.
