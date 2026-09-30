import { getStream, getJSON } from "../lib/store.js";
import { loadAll, packageName } from "../lib/core.js";
import { json } from "../lib/http.js";
export async function GET(request) {
  const u = new URL(request.url);
  const id = u.searchParams.get("id") || "";
  const p = u.searchParams.get("path") || "";
  if (!/^S\d{2,3}$/.test(id)) return json({ error: "bad id" }, 400);
  let key; let type; let name;
  if (/^turn\/T\d{2,3}$/.test(p)) {
    const { data: res } = await getJSON(`resources/${id}/resource.json`, null);
    const t = res?.turns?.find((x) => x.key === p.slice(5));
    if (!t) return json({ error: "not found" }, 404);
    key = `resources/${id}/${t.audio}`; type = "audio/mpeg"; name = t.audio.split("/").pop();
  } else if (p === "package") {
    const { scripts } = await loadAll();
    if (!scripts[id]) return json({ error: "not found" }, 404);
    name = `${packageName(scripts[id])}.zip`; key = `packages/${name}`; type = "application/zip";
  } else if (/^(audio\/[A-Za-z0-9_.-]+\.mp3|resource\.json|SCRIPT\.md|SOURCE_BRIEF\.md|COACHING\.md|CHANGELOG\.md)$/.test(p)) {
    key = `resources/${id}/${p}`; name = p.split("/").pop();
    type = p.endsWith(".mp3") ? "audio/mpeg" : p.endsWith(".json") ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8";
  } else return json({ error: "bad path" }, 400);
  const s = await getStream(key);
  if (!s) return json({ error: "not found" }, 404);
  const headers = { "content-type": type, "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (s.size) headers["content-length"] = String(s.size);
  if (p === "package") headers["content-disposition"] = `attachment; filename="${name}"`;
  return new Response(s.body, { headers });
}
