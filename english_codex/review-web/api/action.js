import { waitUntil } from "@vercel/functions";
import { ownerAction, runAudioJob } from "../lib/core.js";
import { json, sameOrigin } from "../lib/http.js";
export async function POST(request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const { id, action, comment, expectedVersion } = body || {};
  const actor = String(body?.actor || "owner (review web)").slice(0, 80);
  if (!id || !["revise", "approve", "retry"].includes(action)) return json({ ok: false, error: "bad request" }, 400);
  if (action === "revise" && !String(comment || "").trim()) return json({ ok: false, error: "수정할 내용을 적어 주세요." }, 400);
  const r = await ownerAction({ id, action, comment: String(comment || "").slice(0, 4000), actor, expectedVersion });
  if (!r.ok) return json(r, r.code || 400);
  if (r.startJob) waitUntil(runAudioJob(id, { actor }).catch(() => {}));
  return json(r);
}
