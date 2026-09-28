# Script Review Web

Generic reviewer for business-English dialogue. The private deployment is a separate Vercel project protected by Vercel Authentication. Do not deploy this copy from the public repository, and do not change GitHub Pages for it.

Seed data is supplied only on that private deploy:

- `seed/md/Sxx_*.md`
- `seed/meta.json`
- `seed/requests.json` (optional)

`seed/*` is gitignored except this folder's `seed/README.md`. Never commit scripts, contacts, prices, contract terms, resource-pack zips, or MP3s that came from real correspondence.

## Statuses

`REVIEW_REQUIRED` → `REVISION_REQUIRED` or `APPROVED_FOR_AUDIO` → `AUDIO_READY`, plus `ARCHIVED`.

Only an owner approval starts audio generation. Admin and cron jobs can retry a script that is already `APPROVED_FOR_AUDIO`. They do not approve anything.

## Turn-level diff

Each turn's text hash is `sha256("<voice>|<trimmed english>")`. The audio file is `audio/T01_<speaker>_<hash8>.mp3`. A later run reuses a turn when that hash still matches a stored MP3 that passes frame and duration checks. Any other turn is synthesized again (up to 5 validation attempts). The `AUDIO_READY` zip (`<package>/resource.json` and `audio/*.mp3`) is what the listening app imports as a Private Resource Pack.
