# Third-party material

Ütle's own code is under the MIT licence in `LICENSE`. This file lists everything Ütle ships,
downloads or depends on at run time that is not ours. Each licence below was read at the source
named in the row on 5 October 2026. Where it could not be confirmed, the row says so.

## Estonian speech recognition is not ours

The speech recognition in Ütle is TalTech's work, not this project's. The model
`streaming-zipformer-large.et-en` was made by the Laboratory of Language Technology at Tallinn
University of Technology (TalTech), led by Tanel Alumäe. Ütle only runs it.

## What is downloaded or installed

| What | Where it comes from | Licence | Checked at (the line that states the licence) |
|---|---|---|---|
| Speech model `streaming-zipformer-large.et-en` (`encoder.int8.onnx`, `decoder.int8.onnx`, `joiner.int8.onnx`, `tokens.txt`; downloaded by `npm run model` into `models/`, never committed) | TalTechNLP on Hugging Face | MIT | https://huggingface.co/TalTechNLP/streaming-zipformer-large.et-en/raw/main/README.md, front matter: `license: mit`. The repository has no separate licence file and names no copyright holder. |
| `sherpa-onnx-node` 1.13.8 and its native package for the platform (for example `sherpa-onnx-win-x64`) | k2-fsa, npm | Apache-2.0 | https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/LICENSE: "Apache License, Version 2.0". The npm packages declare `"license": "Apache-2.0"`. |
| ONNX Runtime (`onnxruntime.dll` and its counterparts, inside the sherpa-onnx native package) | Microsoft | MIT | https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE: "MIT License, Copyright (c) Microsoft Corporation" |
| `react`, `react-dom` 19 | Meta, npm | MIT | https://raw.githubusercontent.com/facebook/react/main/LICENSE: "MIT License, Copyright (c) Meta Platforms, Inc. and affiliates." |
| `ws` 8 | npm | MIT | https://raw.githubusercontent.com/websockets/ws/master/LICENSE: "Copyright (c) 2011 Einar Otto Stangvik", followed by the MIT permission text. npm declares `"license": "MIT"`. |
| `zod` 4 | npm | MIT | https://raw.githubusercontent.com/colinhacks/zod/main/LICENSE: "MIT License, Copyright (c) 2025 Colin McDonnell" |
| `@anthropic-ai/sdk` (used only by the development page at localhost, not by the extension) | Anthropic, npm | MIT | https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/LICENSE: "Copyright 2023 Anthropic, PBC.", followed by the MIT permission text. npm declares `"license": "MIT"`. |
| Font Atkinson Hyperlegible Next (loaded from Google Fonts by the development page's `index.html`; not shipped in this repository; the extension uses the system font) | The Atkinson Hyperlegible Next Project Authors, via Google Fonts | SIL Open Font License 1.1 | https://raw.githubusercontent.com/google/fonts/main/ofl/atkinsonhyperlegiblenext/OFL.txt: "This Font Software is licensed under the SIL Open Font License, Version 1.1." |

The development tools in `devDependencies` (Vite, TypeScript, Vitest, Playwright, esbuild,
Tailwind CSS, oxlint, tsx and type packages) are installed by `npm ci` but are not part of what
runs. Each carries its own licence in `node_modules/<name>/`; they were not checked one by one.

## What is in this repository and not ours

| File | What it is | Licence | Checked at |
|---|---|---|---|
| `extension/test/vendor/lexical.js` | Lexical 0.52.0 with `@lexical/plain-text`, bundled for one test page only (a stand-in for WhatsApp's editor) | MIT | https://raw.githubusercontent.com/facebook/lexical/main/LICENSE: "MIT License, Copyright (c) Meta Platforms, Inc. and affiliates." The notice is reproduced below because the bundled file carries only a one-line credit. |
| `scripts/fixtures/*.wav` (five short Estonian recordings used by the tests) | Synthetic speech made with the TartuNLP text-to-speech service (`https://api.tartunlp.ai/text-to-speech/v2`, voice "mari"), then resampled by `scripts/fixture.ts` | **Not confirmed.** The TartuNLP service's code is MIT (https://raw.githubusercontent.com/TartuNLP/text-to-speech-api/main/LICENSE: "MIT License, Copyright (c) 2021 University of Tartu"), but no licence or terms of use for the audio the service produces, or for the voice, was found. | See `docs/PUBLISHING.md`, item 4 of the checklist. |

`public/favicon.svg` is ours (drawn for Ütle). The screenshots in `docs/proof/` are ours and show
only test pages and invented names.

## Lexical licence notice

```
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
