import { runAudioJob, loadAll } from "../../lib/core.js";
import { json, isAdmin } from "../../lib/http.js";
// Admin retry / diagnostics. Never approves anything: only runs a job for a script the owner already approved.
export async function POST(request) {
  if (!isAdmin(request)) return json({ error: "unauthorized" }, 401);
  const { id } = await request.json();
  return json(await runAudioJob(id, { actor: "admin-retry" }));
}
export async function GET(request) {
  if (!isAdmin(request)) return json({ error: "unauthorized" }, 401);
  const { state } = await loadAll();
  return json(state);
}
