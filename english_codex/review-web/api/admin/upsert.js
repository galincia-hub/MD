import { upsertScripts } from "../../lib/core.js";
import { json, isAdmin } from "../../lib/http.js";
export async function POST(request) {
  if (!isAdmin(request)) return json({ error: "unauthorized" }, 401);
  const body = await request.json();
  if (!Array.isArray(body?.scripts)) return json({ error: "scripts[] required" }, 400);
  for (const s of body.scripts) if (!/^S\d{2,3}$/.test(s.id || "") || !Array.isArray(s.turns)) return json({ error: `invalid script ${s.id}` }, 400);
  return json({ ok: true, ...(await upsertScripts(body.scripts, body.note, body.actor || "writing-agent")) });
}
