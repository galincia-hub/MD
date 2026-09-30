import { loadAll, summarize } from "../lib/core.js";
import { json } from "../lib/http.js";
export async function GET() {
  const { scripts, state } = await loadAll();
  return json({ ...summarize(scripts, state), serverTime: new Date().toISOString() });
}
