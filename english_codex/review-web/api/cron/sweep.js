import { sweepJobs, loadAll } from "../../lib/core.js";
import { getJSON } from "../../lib/store.js";
import { json } from "../../lib/http.js";
// Daily safety net: retries approved scripts whose audio job failed or stalled. Never approves anything.
// Also logs a status summary (ids, statuses, audio totals — never script text) for operators.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);
  const results = await sweepJobs({ actor: "cron-sweep", budgetMs: 240 * 1000 });
  for (const x of results) console.log(`[sweep] job ${x.id}: ${x.ok ? "ok" : "FAILED " + String(x.error).slice(0, 200)}`);
  const { scripts, state } = await loadAll();
  const ids = Object.keys(scripts).sort();
  const counts = {};
  for (const id of ids) { const s = state[id]?.status || "REVIEW_REQUIRED"; counts[s] = (counts[s] || 0) + 1; }
  console.log(`[status] total=${ids.length} ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  for (const id of ids) {
    const st = state[id] || {}; const a = st.audio;
    console.log(`[status] ${id} v${scripts[id].version} ${st.status || "REVIEW_REQUIRED"} job=${st.job?.status || "-"}/${st.job?.attempts || 0}` +
      (a ? ` audio: turns=${a.turns} dur=${a.durationSec}s zip=${a.zipBytes}B pkg=${a.packageName}` : ""));
    if (a) {
      const { data: res } = await getJSON(`resources/${id}/resource.json`, null);
      if (res) console.log(`[status] ${id} perTurn ${(res.turns || []).map((t) => `${t.key || t.id}:${t.speaker}:${t.durationSec}s/${t.bytes}B:${String(t.textHash || "").slice(0, 8)}`).join(" ")}`);
    }
  }
  return json({ ok: true, results, counts });
}
