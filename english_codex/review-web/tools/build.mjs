// Vercel build step (production only): sync the bundled private seed into the private Blob store,
// apply explicit approval requests recorded in seed/requests.json (idempotent), and run pending audio jobs.
// Logs contain ids and counts only — never script text.
// Exit codes (visible in the deployment errorMessage even when build logs are not):
//   2 seed integrity failed (no sync) | 3 approval request skipped (content changed)
//   4 audio job failed: TTS | 7 MP3 validation | 8 max attempts | 5 other job error
//   10*phase + class for exceptions: phase 1 upsert, 2 request, 3 sweep, 4 other;
//   class 0 unknown, 1 BlobAccessError, 2 store not found, 3 store suspended, 4 HTTP 4xx, 5 HTTP 5xx,
//   6 "Could not update" (etag conflicts), 7 Type/ReferenceError (code bug), 8 SyntaxError (JSON), 9 other BlobError/network
import fs from "node:fs";
import { upsertScripts, ownerAction, sweepJobs, loadAll, contentHash } from "../lib/core.js";
import { loadSeed } from "./seed.mjs";
import { getJSON, updateJSON } from "../lib/store.js";

const env = process.env.VERCEL_ENV || "local";
if (env !== "production" && !process.env.FORCE_SYNC) { console.log(`[build] VERCEL_ENV=${env}: skip sync`); process.exit(0); }
if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.FORCE_SYNC) { console.log("[build] no Blob token: skip sync"); process.exit(0); }

let phase = 4;
function classify(e) {
  const name = String(e && (e.name || e.constructor?.name) || "");
  const msg = String(e && (e.message || e) || "");
  if (/BlobAccessError/.test(name) || /Access denied/i.test(msg)) return 1;
  if (/StoreNotFound/.test(name) || /store does not exist/i.test(msg)) return 2;
  if (/Suspended/.test(name) || /suspended/i.test(msg)) return 3;
  if (/Could not update/.test(msg)) return 6;
  if (/\b4\d\d\b/.test(msg)) return 4;
  if (/\b5\d\d\b/.test(msg)) return 5;
  if (e instanceof TypeError || e instanceof ReferenceError) return 7;
  if (e instanceof SyntaxError) return 8;
  if (/Blob|fetch failed|ECONN|ENOTFOUND|ETIMEDOUT/i.test(name + " " + msg)) return 9;
  return 0;
}
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
try {
  const meta = read("seed/meta.json") || {};
  const seedScripts = loadSeed();
  for (const s of seedScripts) console.log(`[build] seed ${s.id} hash=${contentHash(s).slice(0, 12)} turns=${s.turns.length}`);
  if (meta.expectedHashes) {
    const bad = seedScripts.filter((s) => !contentHash(s).startsWith(meta.expectedHashes[s.id] || "\u0000")).map((s) => s.id);
    const missing = Object.keys(meta.expectedHashes).filter((id) => !seedScripts.some((s) => s.id === id));
    if (bad.length || missing.length) { console.log(`[build] seed integrity FAILED mismatch=${bad.join(",")} missing=${missing.join(",")} -> no sync`); process.exit(2); }
    console.log(`[build] seed integrity ok (${seedScripts.length})`);
  }
  phase = 1;
  if (seedScripts.length) {
    const r = await upsertScripts(seedScripts, meta.note || "", meta.actor || "writing-agent (deploy)");
    console.log(`[build] upsert: ${r.changed.length} changed of ${r.count}`, r.changed.map((c) => `${c.id}@v${c.version}`).join(" "));
  }
  phase = 2;
  const reqs = read("seed/requests.json")?.requests || [];
  for (const q of reqs) {
    const key = `${q.id}:${q.action}:${q.contentHash}`;
    const { data: applied } = await getJSON("db/requests-applied.json", {});
    if (applied[key]) { console.log(`[build] request ${key.slice(0, 24)} already applied`); continue; }
    const { scripts } = await loadAll();
    if (!scripts[q.id] || scripts[q.id].contentHash !== q.contentHash) { console.log(`[build] request for ${q.id} skipped: content changed since request`); if (meta.failBuildOnJobError) process.exitCode = 3; continue; }
    const r = await ownerAction({ id: q.id, action: q.action, comment: q.comment || "", actor: q.actor, expectedVersion: scripts[q.id].version });
    await updateJSON("db/requests-applied.json", {}, (a) => { a[key] = { at: new Date().toISOString(), result: r.ok ? "ok" : r.error }; return a; });
    console.log(`[build] request ${q.action} ${q.id}: ${r.ok ? "ok" : r.error}`);
  }
  phase = 3;
  const results = await sweepJobs({ actor: "deploy-sweep", budgetMs: 20 * 60 * 1000 });
  for (const x of results) console.log(`[build] job ${x.id}: ${x.ok ? `ok turns=${x.turns ?? "-"} generated=${x.generated ?? "-"} reused=${x.reused ?? "-"} dur=${x.durationSec ?? "-"}s perTurn=${(x.perTurn || []).join(",")}` : `FAILED ${String(x.error).slice(0, 200)}`}${x.noop ? ` (${x.noop})` : ""}`);
  const failed = results.filter((x) => !x.ok);
  if (meta.failBuildOnJobError && failed.length) {
    const errs = failed.map((x) => String(x.error));
    const tts = errs.some((e) => /TTS/.test(e));
    const mp3 = errs.some((e) => /MP3/.test(e));
    const maxed = errs.some((e) => /max attempts/.test(e));
    console.log("[build] job failure -> failing build (meta.failBuildOnJobError)");
    process.exitCode = tts ? 4 : mp3 ? 7 : maxed ? 8 : 5;
  }
} catch (e) {
  console.log(`[build] sync error phase=${phase} ${e && e.name}: ${String(e && e.message || e).slice(0, 300)}`);
  if (read("seed/meta.json")?.failBuildOnJobError) process.exitCode = 10 * phase + classify(e);
}
