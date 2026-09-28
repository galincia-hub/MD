# Business English Listening PWA

Static mobile-first PWA for a personal business English listening library.

## MVP

- Paste Markdown/Text dialogue resources.
- Parse title, speaker turns, English dialogue, Korean meaning, and operation notes.
- Preview warnings without blocking import.
- Store scripts in IndexedDB.
- Play English turns continuously with browser/device TTS.
- Keep `audioUrl` on each turn for future pre-generated audio.
- Work under GitHub Pages subdirectory paths such as `/MD/english_codex/`.

## Audio Generation

The app prefers pre-generated MP3 files and uses browser SpeechSynthesis only as a fallback.

Generate the sample MP3 files:

```powershell
$env:HTTP_PROXY=''
$env:HTTPS_PROXY=''
$env:ALL_PROXY=''
node english_codex\tools\generate-audio.mjs
```

List available English Edge voices:

```powershell
$env:HTTP_PROXY=''
$env:HTTPS_PROXY=''
$env:ALL_PROXY=''
node english_codex\tools\generate-audio.mjs --list-voices
```

Check the sample files already on disk without calling Edge TTS:

```powershell
node english_codex\tools\generate-audio.mjs --check
```

Current sample voices:

- Hyun: `en-US-BrianNeural`
- Emma: `en-US-EmmaNeural`
- Ashlee: `en-US-AvaNeural`
- Lydia: `en-US-JennyNeural`
- Joyce: `en-US-AriaNeural`

Edge TTS sometimes returns a truncated MP3. `generate-audio.mjs` parses each file (`english_codex/review-web/lib/mp3.js`: frame walk, duration versus word count) and retries up to 5 times. An existing file that already passes is left in place. A file that fails is replaced only after a valid take. Pack-style names, when a turn has no stable sample path, are `T01_<speaker>_<hash8>.mp3`. The hash is `sha256("<voice>|<trimmed english>")`, the same value the review web stores per turn.

## Private Resource Pack

On the import screen, **Private Resource Pack (.zip) 불러오기** reads a zip produced by the private Script Review web when a script is `AUDIO_READY`. The archive layout is `<package>/resource.json` plus `<package>/audio/*.mp3`. Stored and deflate zips are both accepted. Each turn is stored on the Library script and gets an `audioKey`. The MP3 bytes are saved in IndexedDB as Blobs. Importing the same pack again replaces that pack. Deleting the script deletes its Blobs.

Playback order is pack audio, then `audioUrl`, then browser speech.

Do not commit these zips, the MP3s inside them, or any script they were built from. The download stays on the private deployment.

## Script Review Web

Generic code for the private reviewer is in `english_codex/review-web/`. The running site is a separate Vercel project behind Vercel Authentication. This repository does not deploy it.

Seed files (`seed/md/`, `seed/meta.json`, `seed/requests.json`) are supplied only at deploy time. `review-web/seed/*` is gitignored except `seed/README.md`.

Statuses: `REVIEW_REQUIRED`, `REVISION_REQUIRED`, `APPROVED_FOR_AUDIO`, `AUDIO_READY`, `ARCHIVED`.

Turn-level diff uses a per-turn text hash, `sha256("<voice>|<english>")`. Unchanged turns reuse a previously validated MP3. Changed turns are synthesized again. Audio files use the `T01_<speaker>_<hash8>.mp3` name. The `AUDIO_READY` package download is the zip this listening app imports.

## Public Repository Rule

Do not commit raw KakaoTalk exports, real emails, contacts, internal prices, contracts, or private negotiation material. Put private source references under:

```text
english_codex/private-references/
```

That folder is ignored by `english_codex/.gitignore`.
