# Ütle

A document editor for people who cannot use their hands. Say what to change, see what was
understood, fix it in one word. Hackathon prototype: NewWorkTech, TalTech Mektory, 5 and 6 October 2026.

The design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The plan this build followed is in
[docs/plans/](docs/plans/).

## Run it

```
npm install
npm run dev        # the real thing: needs a working ANTHROPIC_API_KEY in the environment
npm run rehearse   # scripted answers for the demo lines: no key, no network
```

Open the address Vite prints, in Chrome. Turn the microphone on, or type in the box. Typed
input goes through exactly the same path as speech.

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
11. Mine kokkuvõtte juurde ja loe see ette.
12. Stop listening.

Also worth showing: say a paragraph number to jump to it, say undo, press space for yes or
escape for no. The three counters on the right are the measurements for the pitch.

## Checks

```
npm run check      # typecheck, lint, 177 tests, build
npm run smoke      # the demo script through the real model; spends a few cents
```

## What is proven and what is not (5 October 2026)

- Proven by tests: document operations, preview, quick replies in English and Estonian, the
  whole conversation as a state machine, the server's validation and single retry, pause joining.
- Proven in the browser: the interface in rehearsal mode with typed input.
- Not proven: the real model (`npm run smoke` fails because the API key on this machine is
  rejected), voice input, Estonian recognition. Reading aloud is not built.
