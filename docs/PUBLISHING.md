# Publishing Ütle

For Ralf. Written 5 October 2026. Nothing here has been done: the repository has no remote and has
not been published. Publishing is your decision.

## What "public" can mean today

Today "public" can only mean **public source code**: a public GitHub repository that anyone can
read, copy and install by following `README.md`. Installing takes a terminal, Node.js, Git, about
350 MB of disk and ten minutes, so in practice it reaches developers and helpers, not the people Ütle
is for.

It cannot mean a download from the Chrome Web Store yet. The extension does not recognise speech
itself; it sends the microphone audio to a speech server on the same computer, which you start with
`npm run dev`. A Web Store listing would install only the extension, which would then say "the
speech model is not reachable" on every page. Google would also want a privacy policy, a reason for
the "read and change all your data on all websites" permission, and a single clear purpose; those are
doable, the missing speech server is not.

## Two realistic routes to a real download later

1. **A packaged speech program with an installer.** The speech server and the 156 MB model are
   bundled into one Windows (and later Mac) program that starts with the computer; the extension
   goes on the Web Store and talks to it. Audio still never leaves the machine. Cost: a few weeks of
   work, plus a code-signing certificate (roughly 100 to 400 euros a year) so Windows does not warn
   people off the installer.
2. **A hosted speech service.** The same model runs on a server on the internet and the extension
   streams audio to it, so the Web Store extension is the whole install. Cost: a server that can run
   the model for every listening user (tens to hundreds of euros a month, growing with users), and
   the promise that audio never leaves the machine is gone, which needs a privacy policy and
   probably a data processing agreement under GDPR, since this is health-related audio.

Route 1 keeps the product's main privacy promise; route 2 is faster to ship and easier to install.

## Decide these first

The audit below was run on 5 October 2026 over the whole history, not only the current files (58
commits on all branches at the time). Nothing in the history has been changed. Ordered by how badly
each would hurt if published as it is. Work merged after the audit has not been checked, so the
secret search and the image check should be run once more on the final `main` before pushing.

- [ ] **1. A real person's disability is described in a way that can identify him.** The man the
  team interviewed is described as "a man with a motor disability the team spoke to on 5 October 2026"
  who "types very slowly, and points with a Tobii eye tracker". With the event, the date and the
  venue in the same files, anyone who was at the hackathon can tell who he is. Where it is now:
  `HANDOFF.md` (section 2, "His voice (the man with a motor disability)", and section 6, "the user with
  a motor disability and his Tobii"), `docs/ARCHITECTURE.md` section 20 ("Decided after talking to a
  user with a motor disability"), and the earlier text of `docs/PRODUCT.md` in the git history.
  `README.md` and `docs/PRODUCT.md` now say only "an eye-tracker user with a motor disability". Either
  ask him whether he minds, or generalise the other two files to the same words before publishing.
  The old wording stays in the git history unless the history is replaced (see the steps below).
- [ ] **2. Your email address becomes public.** Every commit is by
  `marshalofthecentralaltar <195171080+marshalofthecentralaltar@users.noreply.github.com>`, and `docs/plans/2026-10-05-m1-m2-core-loop.md` line 30
  names the same address. Publishing the history publishes the address. If you would rather not,
  the history has to be replaced (see the steps below), and future commits can use GitHub's
  private no-reply address.
- [ ] **3. The test recordings' licence is not confirmed.** The five files in `scripts/fixtures/`
  are synthetic Estonian speech made with the TartuNLP text-to-speech service (voice "mari"). Its
  code is MIT, but no licence or terms for the audio it produces were found. Ask TartuNLP (University
  of Tartu) whether test recordings may be redistributed, or replace them with recordings of a team
  member who agrees.
- [ ] **4. Internal working notes are in the repository.** `HANDOFF.md` is a note between work
  sessions: it names you, says the Anthropic key on your machine is rejected, and links a private
  claude.ai page. `docs/ARCHITECTURE.md` line 11 links another private claude.ai page. None of this
  is secret, but it reads as internal. Keep it (it shows how the work was done), or move
  `HANDOFF.md` out before publishing.
- [ ] **5. AI co-authorship is visible.** All commit messages but one end with "Co-Authored-By:
  Claude". That is honest and common, and nothing needs doing unless you would rather it were not
  public.
- [ ] **6. Names in the screenshots and sample data.** `docs/proof/` and the test pages show the
  names Kadri Tamm, Marten Kask, Liis Org, Mari Maasikas, Jaan Tamm, Kalle Kuusk, Mariann Kask, Märt
  Tamm and Peeter Kask, and the message "Tere! Jõuan homme kell kolm". They were invented for the
  sample document and the stand-in chat pages. If any of them is a real teammate, say so and they
  will be replaced.

What the audit found clean:

- **No secrets anywhere in the history.** Searched every line of `git log -p --all` for `sk-`,
  `sk-ant-`, `AKIA`, `ghp_`, `eyJ`, `-----BEGIN`, `password`, `token`, `secret`, `apikey` and other
  key shapes. Every hit is ordinary code (a password field type in a test page, the word "token" in
  the model's `tokens.txt` and in API parameters, a base64 package checksum, an SVG path). No `.env`
  file was ever committed. The Anthropic key is only ever read from the environment.
- **No real chats in the screenshots.** All 26 images ever committed (25 in `docs/proof/` now, plus
  one deleted one still in the history, `docs/proof/ext-dock-utle.png`) were opened one by one. They
  show the test pages, the stand-in WhatsApp and Messenger pages, the new-tab page and the old
  document editor, with invented names only. No real WhatsApp or Messenger, no phone numbers, no
  profile pictures. `extension/test/fixtures/` holds HTML pages only, no images.
- **No large or stray files.** Nothing tracked is over 1 MB, and no file ever committed is over
  500 KB (the largest are the test recordings, 110 to 430 KB). The speech model (`models/`) and the
  built extension (`extension/dist/`) are ignored and were never committed. The scratch files
  `t.cjs`, `tts.wav` and a `model/` folder are not in this repository and never were: they sit in a
  separate folder next to it (`utle-shared`). `t.cjs` is a throwaway test script, `tts.wav` is a
  TartuNLP recording (point 3 applies to it), and `model/` is a copy of TalTech's model; none is
  needed.
- **Licences.** Ütle's code is now under MIT (`LICENSE`). Everything that is not ours is in
  `THIRD-PARTY.md` with its licence checked at the source: TalTech's model (MIT), sherpa-onnx
  (Apache-2.0), ONNX Runtime, React, ws, zod, the Anthropic SDK and the bundled Lexical test library
  (all MIT), and the Atkinson Hyperlegible Next font (SIL Open Font License, loaded from Google
  Fonts, not shipped). The only unconfirmed item is point 3.

## How to publish the source on GitHub, when you say yes

Decide points 1 to 6 first. Then choose one of two ways.

**A. Publish with the full history** (keeps every commit, publishes everything listed above):

1. On github.com, signed in as marshalofthecentralaltar: **New repository**, name `utle`, **Public**, and
   leave "Add a README", ".gitignore" and "license" all unticked (the repository already has them).
2. In a terminal, in the `utle` folder on `main`:

   ```
   git status
   git remote add origin https://github.com/marshalofthecentralaltar/utle.git
   git push -u origin main
   ```

   `git status` must say the working tree is clean first. Only `main` is pushed; the old work
   branches stay on your computer.
3. On the repository page: **About** (the gear), add a one-line description ("Estonian voice control
   for Chrome, for people who cannot use their hands. Hackathon prototype.") and the topics
   `accessibility`, `estonian`, `speech-recognition`, `chrome-extension`.
4. Open the repository page while signed out (or in a private window) and read the README once.

**B. Publish without the history** (one starting commit; removes your email address from the
published commits and the old wording of point 1, but the commit-by-commit story is lost):

1. Make the changes for points 1, 4 and 6 first, and commit them on `main`.
2. Set the address the new commit will carry, for example GitHub's no-reply address (shown under
   Settings, Emails on github.com):

   ```
   git config user.email "<your no-reply address>"
   ```

3. Create the single commit on a new branch and push it as `main`:

   ```
   git checkout --orphan public
   git commit -m "Ütle: hackathon prototype"
   git remote add origin https://github.com/marshalofthecentralaltar/utle.git
   git push -u origin public:main
   ```

   Your local `main` keeps the full history; only the new single commit goes to GitHub.
4. Steps 1, 3 and 4 of route A apply too (create the empty repository before pushing).

Once it is public, anything pushed is copied by others within minutes and cannot be taken back.
Check point 1 before either route.
