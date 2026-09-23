# Business English Listening PWA

Static mobile-first PWA for a personal business English listening library.

## MVP

- Paste Markdown/Text dialogue resources.
- Parse title, speaker turns, English dialogue, Korean meaning, and operation notes.
- Preview warnings without blocking import.
- Store scripts in IndexedDB.
- Prefer pre-generated MP3 audio via `audioUrl`.
- Fall back to browser/device TTS only when no MP3 exists.
- Work under GitHub Pages subdirectory paths such as `/MD/english_codex/`.

## Audio Generation

The app prefers pre-generated MP3 files and uses browser SpeechSynthesis only as a fallback.

Generate sample MP3 files:

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

Current sample voices:

- Hyun: `en-US-BrianNeural`
- Emma: `en-US-EmmaNeural`
- Ashlee: `en-US-AvaNeural`

## Public Repository Rule

Do not commit raw KakaoTalk exports, real emails, contacts, internal prices, contracts, or private negotiation material. Put private source references under:

```text
english_codex/private-references/
```

That folder is ignored by `english_codex/.gitignore`.
