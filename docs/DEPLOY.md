# Deploying the server to Railway

This takes about fifteen minutes the first time, most of it Railway building the image. Run every
command from the repository root (`C:\Users\ralfs\utle-cloud`) on `main`, in PowerShell. Design:
`docs/ARCHITECTURE.md` 27. Nothing below has been run against Railway yet. The image was built
and run locally first (section 27.7 has the numbers).

## What it costs and what it needs

- **Memory:** __MEMORY__. Railway's Hobby plan allows up to **48 GB of RAM and 48 vCPU per service**
  ("Depending on the plan you are on, you are allowed to use up these resources per service", the
  plan table at https://docs.railway.com/reference/pricing/plans, read 2026-10-21). So the plan's
  limit is no constraint, and there is no memory setting to change.
- **Money:** memory is billed at $10 per GB per month (same page), so about __COST__ a month for memory
  if the service runs all the time, plus a little CPU for each utterance. Hobby is $5 a month and
  includes $5 of usage.
- **Volume:** Hobby allows 5 GB of volume storage. A voice profile is about 11 KB.
- **Image:** __IMAGE__ (Hobby allows images up to 100 GB).

## The steps

1. Log in (opens the browser):

   ```powershell
   railway login
   ```

2. Make the project and the service, and link this folder to them:

   ```powershell
   railway init -n utle
   railway add --service utle-server
   railway service link utle-server
   ```

3. Make a token for each person. Run it once per person and keep each line:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

4. Set the variables. `UTLE_TOKEN` is a comma-separated list of `name:token`, one per person; the
   name is what that person's settings page shows ("Profiil: ralf"), and each token has its own
   voice profile. The token is read from the prompt so it never lands in the shell's history:

   ```powershell
   railway variable set "ANTHROPIC_API_KEY=sk-ant-..." "UTLE_DATA_DIR=/data" --skip-deploys
   "ralf:<token 1>,kasutaja:<token 2>" | railway variable set UTLE_TOKEN --stdin --skip-deploys
   ```

   Optional: `SONIOX_API_KEY` (the second recogniser), `UTLE_MODEL` (the Claude model). Do not set
   `PORT`: Railway sets it.

5. Add the volume where the profiles live, so a redeploy keeps everyone's voice:

   ```powershell
   railway volume add --mount-path /data
   ```

6. Build and deploy from this folder (uploads the source; Railway builds the `Dockerfile`, which
   downloads both models into the image). `--ci` streams the build log and returns when it is done:

   ```powershell
   railway up --ci -m "Ütle server"
   ```

   The deploy log must then show `[asr] model loaded on a worker thread in N ms` and
   `[asr] speaker model loaded`:

   ```powershell
   railway logs
   ```

7. Give it an address (prints `https://<name>.up.railway.app`):

   ```powershell
   railway domain
   ```

## The three checks after the deploy

Put the address and one token in two variables first:

```powershell
$h = "<name>.up.railway.app"; $t = "<token 1>"
```

1. The health check answers 200 without a token:

   ```powershell
   curl.exe -s -o NUL -w "%{http_code}`n" "https://$h/healthz"
   ```

2. The status needs the token, and names the token's profile:

   ```powershell
   curl.exe -s -o NUL -w "%{http_code}`n" "https://$h/api/status"
   curl.exe -s "https://$h/api/status" -H "Authorization: Bearer $t"
   ```

   The first prints `401`; the second prints `"auth":"on"`, `"speech":{"local":true,...}` and
   `"profile":{"name":"ralf","enrolled":false}`.

3. Recorded speech goes through the hosted recogniser and comes back as text:

   ```powershell
   npx tsx scripts/asr-client.ts "wss://$h/api/asr?token=$t" scripts/fixtures/et-dictate-send-16k.wav
   ```

   It must end with `final text: "Tere Mari ma jõuan homme kell kolm. Saada."` (the same text the
   local server gives) and print the time from the last speech to the last final. That time minus
   the local figure in ARCHITECTURE 27.7 is what the internet adds.

## On each person's computer

The Ütle settings page, **Server**: address `wss://<name>.up.railway.app/api/asr`, their own token,
then **Proovi ühendust**. It says "Ühendus töötab: …. Profiil: ralf, hääl õpetamata." Then
"Õpeta mu hääl" teaches that person's voice into their own profile on the volume.

## Afterwards

A new version is `railway up --ci` again. The profiles stay on the volume. To remove a person, take
their `name:token` out of `UTLE_TOKEN`. Their profile file stays on the volume under
`/data/profiles/` until it is deleted.
