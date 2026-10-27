# Round 10, lane MEASURE: the measurement tools (issue #4)

Tooling only. Every table below comes from the **synthetic** set in `scripts/fixtures/`
(TartuNLP text-to-speech voices: "mari" plays the owner, six other voices and a pitch-shifted "mari"
play other people). No real recordings exist yet. Nothing here picks a speaker model or threshold, and
no number here may be cited as how Ütle does with people: that waits for the recordings described in
"How Ralf records" at the end. The scripts run unchanged on any folder of labelled 16 kHz wavs.

Labels for the fixtures: `scripts/fixtures/labels.tsv` (29 clips, references typed from the texts the
fixtures were made from: `scripts/speaker-set.ts` LINES and `scripts/asr-hotwords-eval.ts` SPOKEN).

Measured 2026-10-27 on Ralf's Windows machine, worktree `r10-measure`, dev server on port 5393.

## 1. Recording and labelling (M1)

| Script | What it does |
|---|---|
| `scripts/record.ts` | Prompts 31 phrases per person (10 commands, 10 dictations, 8 wake cases from #2, "saada", "jah", "üks" from #3), records each from the microphone as the extension takes it (echo cancellation, noise suppression, gain control, 16 kHz AudioContext) in a Chromium window served from 127.0.0.1, writes `<out>/<person>/<id>.wav` and appends `<out>/labels.tsv`. Refuses an `--out` inside the repository (exit 3). Without `--consent` it prints the consent text and stops. `--crosstalk` records the commands with kind `crosstalk`. |
| `scripts/label.ts --import` | Adds a folder's wavs to `<out>/labels.tsv`. An `UTLE_CAPTURE` folder is read through its `log.tsv`: the gate's speaker verdict is not copied (speaker stays blank unless `--speaker` names the one person recorded), and the recognised text goes to `heard.tsv` as a typing hint, never into `reference`. |
| `scripts/label.ts --edit` | Walks the clips with a blank speaker or reference; Enter keeps, text replaces, `p` plays the clip, `q` saves and stops. |

`labels.tsv` columns: `file, speaker, reference, addressee (ütle/not/blank), kind (command, dictation, wake, short, crosstalk, other), duration_s`.

Proof, SYNTHETIC (Chromium's fake microphone playing `et-jah-16k.wav`, out folder in the session scratchpad):

```
$ npx tsx scripts/record.ts --person fake --out <scratch>/rec --consent --set short --auto 2 --fake-mic scripts/fixtures/et-jah-16k.wav --headless
fake/short-saada.wav  1.77 s  "Saada."
fake/short-jah.wav  2.01 s  "Jah."
fake/short-yks.wav  2.02 s  "Üks."
3 clips written
$ npx tsx scripts/record.ts --person test --out scripts/out
refused: ...\scripts\out is inside the repository ... (exit 3)
$ npx tsx scripts/label.ts --import scripts/fixtures --out <scratch>/lab
6 clips added from ...\scripts\fixtures; 0 were there
$ npx tsx scripts/label.ts --import <scratch>/cap --out <scratch>/lab      (a one-line capture log saying "owner")
1 clips added ... (capture log: gate verdicts not copied)
   -> labels.tsv row: speaker blank, reference blank; heard.tsv: "jah"
```

Unit tests (`scripts/measure.test.ts`, run by `npm run check`): the refusal of a path inside the
repository (either slash, any case), the capture import leaving speaker and reference blank, the
labels round trip, the phrase list.

## 2. Speech recognition: WER, CER, latency, cost (M2), SYNTHETIC

`npx tsx scripts/wer.ts --labels scripts/fixtures/labels.tsv --engine taltech,soniox` (with `SONIOX_API_KEY`).

Normalisation, both sides (`normaliseEt`): NFC, Estonian lower case, apostrophes dropped inside a word
("youtube'i" = "youtubei"), every other punctuation mark and quote becomes a space, **digits spelled
one by one in Estonian** ("3" = "kolm", "5551234" = "viis viis viis üks kaks kolm neli"). A number said
as one word ("kaksteist") must be typed as that word in the reference. Totals are summed errors over
summed reference words. End-of-utterance latency: wall time from sending the 100 ms frame holding the
clip's last speech (-40 dBFS) to the engine's last final, streaming in real time; it includes each
engine's own endpoint silence rule.

**SYNTHETIC**, n = 29 clips, 126 reference words, 9 owner-voice and 20 other-voice clips:

| Engine | Clips | Ref words | Word errors | WER | CER | Median end-of-utterance | Cost per hour | Spent |
|---|---|---|---|---|---|---|---|---|
| TalTech (local) | 29 | 126 | 1 | 0.8 % | 0.2 % | 1856 ms | $0 (this machine) | $0 |
| Soniox stt-rt-v5 | 29 | 126 | 0 | 0.0 % | 0.0 % | 862 ms | $0.12 (soniox.com/pricing, real-time, read 2026-10-27) | $0.0041 (124.3 s streamed) |

TalTech's one miss: `owner-numbers-one-1` "Näita numbrid" for "Näita numbreid". Soniox wrote "kell 3"
for "kell kolm", which the digit rule counts as right. Text-to-speech is far cleaner than a person in a
room: these rates say the tool works, not how the engines hear people. ElevenLabs is a slot in
`ENGINES` (no key), not implemented.

## 3. Speaker gate: four models by length (M3), SYNTHETIC

`npx tsx scripts/speaker-calibrate.ts --labels scripts/fixtures/labels.tsv --owner-speaker mari --models all`

Trials as the calibration always made them: an owner clip against the mean of the other owner clips
(leave one out), an other clip against the mean of all owner clips; each clip embedded as the gate
embeds it. Bucket = the trial clip's length. 0.54 is `OWNER_THRESHOLD`, set on TitaNet's scale; on the
other three models it is shown for comparison only. Cells: rate [Wilson 95 % interval].

**SYNTHETIC**: 9 owner trials, 20 other trials. There are **no clips of 0.7 s or less** in this set
(the shortest is 1.15 s), so that bucket is empty (n = 0) for every model, and 0.7 to 1 s is empty too.

| Model | Bucket | n own | n oth | EER | Best t | FAR @0.54 | FRR @0.54 | FAR @best | FRR @best |
|---|---|---|---|---|---|---|---|---|---|
| TitaNet-small | all | 9 | 20 | 34.2 % | 0.577 | 0.0 % [0-16] | 33.3 % [12-65] | 0.0 % [0-16] | 33.3 % [12-65] |
| TitaNet-small | <=0.7 s | 0 | 0 | - | - | - | - | - | - |
| TitaNet-small | 1-2 s | 7 | 12 | 42.3 % | 0.577 | 0.0 % [0-24] | 42.9 % [16-75] | 0.0 % [0-24] | 42.9 % [16-75] |
| TitaNet-small | >2 s | 2 | 8 | 0.0 % | 0.691 | 0.0 % [0-32] | 0.0 % [0-66] | 0.0 % [0-32] | 0.0 % [0-66] |
| CAM++ en | all | 9 | 20 | 34.2 % | 0.879 | 55.0 % [34-74] | 11.1 % [2-44] | 0.0 % [0-16] | 77.8 % [45-94] |
| CAM++ en | <=0.7 s | 0 | 0 | - | - | - | - | - | - |
| CAM++ en | 1-2 s | 7 | 12 | 42.3 % | 0.879 | 66.7 % [39-86] | 0.0 % [0-35] | 0.0 % [0-24] | 71.4 % [36-92] |
| CAM++ en | >2 s | 2 | 8 | 50.0 % | 0.626 | 37.5 % [14-69] | 50.0 % [9-91] | 0.0 % [0-32] | 100.0 % [34-100] |
| ERes2Net en | all | 9 | 20 | 34.2 % | 0.618 | 0.0 % [0-16] | 44.4 % [19-73] | 0.0 % [0-16] | 44.4 % [19-73] |
| ERes2Net en | <=0.7 s | 0 | 0 | - | - | - | - | - | - |
| ERes2Net en | 1-2 s | 7 | 12 | 31.0 % | 0.618 | 0.0 % [0-24] | 57.1 % [25-84] | 0.0 % [0-24] | 57.1 % [25-84] |
| ERes2Net en | >2 s | 2 | 8 | 0.0 % | 0.798 | 0.0 % [0-32] | 0.0 % [0-66] | 0.0 % [0-32] | 0.0 % [0-66] |
| ResNet34 en | all | 9 | 20 | 34.2 % | 0.815 | 80.0 % [58-92] | 11.1 % [2-44] | 0.0 % [0-16] | 44.4 % [19-73] |
| ResNet34 en | <=0.7 s | 0 | 0 | - | - | - | - | - | - |
| ResNet34 en | 1-2 s | 7 | 12 | 31.0 % | 0.789 | 83.3 % [55-95] | 14.3 % [3-51] | 0.0 % [0-24] | 42.9 % [16-75] |
| ResNet34 en | >2 s | 2 | 8 | 0.0 % | 0.839 | 75.0 % [41-93] | 0.0 % [0-66] | 0.0 % [0-32] | 0.0 % [0-66] |

(0.7-1 s rows, all n = 0, are in the JSON and the printed table.) The equal 34.2 % "all" EER of all four
models is the coarseness of the set, not agreement: with 9 owner trials FRR moves in steps of 11 points
and with 20 other trials FAR in steps of 5, and on every model the FAR/FRR crossing falls at 7 of 20
against 3 of 9. With 9 and 20 trials the intervals are 30 to 60 points wide: this set cannot rank the models.

Default behaviour unchanged: `npx tsx scripts/speaker-calibrate.ts scripts/fixtures/speaker-set`
rewrote `scores.json` with every field equal to the committed file except the per-clip `ms` timings
and the `stored` block (the committed file was made with `--profile`, the rerun without it); the
committed file was restored.

Models: `npx tsx scripts/speaker-models.ts` adds the two missing ones to `models/speaker/` (sizes
checked against GitHub's listing):

| Model | File | Bytes | Source |
|---|---|---|---|
| ERes2Net en voxceleb | `3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx` | 26 485 263 | github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/ |
| ResNet34 en voxceleb | `wespeaker_en_voxceleb_resnet34.onnx` | 26 534 365 | same release |

## 4. Command latency by stage (M4), SYNTHETIC

`npx vite --port 5393 --strictPort` (with `ANTHROPIC_API_KEY`), then
`UTLE_PORT=5393 npx tsx scripts/latency.ts --labels scripts/fixtures/labels.tsv` (kinds command and short).

What each stage is measured from: (1) the wall time the frame holding the clip's last speech is sent
to `/api/asr` (streamed in real time as the extension streams) to the clip's last final; includes the
recogniser's endpoint silence. (2) handing the final to the real `inpageStep` to having the page
commands; for words the rules give to the model, also `readPage`, `POST /api/intent` (Sonnet 5.5),
`pageIntentFrom` and `applyIntent`. (3) the extension's own page script (`extension/dist/page.js`)
running those commands in headless Chromium on `chat.html` (3000 px more in its message list so it
scrolls, "Tere" already in the composer so "saada" sends; set up before the clock). Not measured: the
engine's holds between stages (final assembler, quick-reply hold), a hosted server's network, the
service worker hop. "Järgmine vaheleht" (switchTab) runs in the service worker and has no stage 3.

**SYNTHETIC**, 18 clips (7 "saada", 7 "keri (natuke) alla", "näita numbreid", "järgmine vaheleht", "jah", "üks"):

| Stage | n | p50 | p95 |
|---|---|---|---|
| speech end -> final | 18 | 1780 ms | 2139 ms |
| final -> intent, rules | 16 | 5 ms | 27 ms |
| final -> intent, model | 2 | 2296 ms | 2457 ms |
| intent -> action, in the page | 17 | 166 ms | 425 ms |

"jah" and "üks" on a chat page went to the model and came back as dictation (setText); with n = 2 the
model row's p95 is the larger of two values.

## How Ralf records

Consent first: before anyone is recorded, read them the text `record.ts` prints without `--consent`
(what is recorded, that it stays on this computer, what it is for, that it is deleted after, that they
can stop). Record only after a yes.

1. Folders, outside the repository: `C:\temp\utle-voice` (the scripts refuse a folder inside it).
2. Each person alone, about 5 minutes each, in a normal room with the microphone you use for Ütle:
   ```
   npx tsx scripts/record.ts --person ralf --out C:/temp/utle-voice --consent
   npx tsx scripts/record.ts --person partner1 --out C:/temp/utle-voice --consent
   npx tsx scripts/record.ts --person partner2 --out C:/temp/utle-voice --consent
   ```
   A Chromium window shows each phrase: Space starts, Space stops, Backspace redoes the last, Escape ends.
3. All three talking at once while Ralf reads the commands:
   `npx tsx scripts/record.ts --person ralf --crosstalk --out C:/temp/utle-voice --consent`
4. Optional, real use: run the dev server with `UTLE_CAPTURE=C:\temp\utle-voice\capture-<person>`, use
   Ütle, then `npx tsx scripts/label.ts --import C:/temp/utle-voice/capture-<person> --out C:/temp/utle-voice --speaker <person>`
   (only when that folder is one person; otherwise leave `--speaker` off and type it per clip).
5. Check and correct: `npx tsx scripts/label.ts --edit C:/temp/utle-voice/labels.tsv --all`. The
   reference is what was actually said, numbers as said ("kaksteist", not "12").
6. The four tables:
   ```
   node --env-file=.env.local --import tsx scripts/wer.ts --labels C:/temp/utle-voice/labels.tsv --engine taltech,soniox
   npx tsx scripts/speaker-calibrate.ts --labels C:/temp/utle-voice/labels.tsv --owner-speaker ralf --models all
   npx vite --port 5393 --strictPort        (another shell, ANTHROPIC_API_KEY set)
   UTLE_PORT=5393 npx tsx scripts/latency.ts --labels C:/temp/utle-voice/labels.tsv
   ```
   Each writes its JSON next to `labels.tsv` (wer.json, speaker-sweep.json, latency.json). Copy only the
   counts and rates into the proof file; the JSON files hold what people said and stay in the folder.
7. When the tables are written down: delete `C:\temp\utle-voice` entirely (recordings, labels, JSON,
   capture folders). Soniox spend for the whole set is about $0.01 (about 5 minutes of audio per
   person at $0.12 per hour).
