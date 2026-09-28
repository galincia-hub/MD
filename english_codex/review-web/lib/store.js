// Storage adapter: Vercel Blob (private) in production, local FS for tests.
import fs from "node:fs/promises";
import path from "node:path";

const LOCAL = !process.env.BLOB_READ_WRITE_TOKEN;
const ROOT = process.env.LOCAL_STORE_DIR || "/tmp/ci-review-store";
let blob = null;
async function sdk() {
  if (!blob) blob = await import("@vercel/blob");
  return blob;
}

export class ConflictError extends Error {}

export async function getBuf(p) {
  if (LOCAL) {
    try { return { buf: await fs.readFile(path.join(ROOT, p)), etag: null }; } catch { return null; }
  }
  const { get } = await sdk();
  const r = await get(p, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return { buf: Buffer.from(await new Response(r.stream).arrayBuffer()), etag: r.blob.etag, contentType: r.blob.contentType };
}

export async function getStream(p) {
  if (LOCAL) {
    const g = await getBuf(p);
    return g ? { body: g.buf, size: g.buf.length } : null;
  }
  const { get } = await sdk();
  const r = await get(p, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return { body: r.stream, size: r.blob.size, contentType: r.blob.contentType };
}

export async function putBuf(p, body, contentType, ifMatch) {
  if (LOCAL) {
    const f = path.join(ROOT, p);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, body);
    return;
  }
  const { put } = await sdk();
  const opts = { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType, cacheControlMaxAge: 60 };
  if (ifMatch) opts.ifMatch = ifMatch;
  try {
    await put(p, body, opts);
  } catch (e) {
    if (ifMatch && /precondition|412|etag|match/i.test(String(e && (e.message || e)))) throw new ConflictError(String(e.message || e));
    throw e;
  }
}

// ETag for conditional writes: taken from the Blob API (head) BEFORE reading, so it is in the
// format put({ ifMatch }) expects and can only be older (never newer) than the data we read.
async function apiEtag(p) {
  if (LOCAL) return null;
  const { head } = await sdk();
  try { return (await head(p)).etag || null; } catch { return null; }
}

export async function getJSON(p, fallback) {
  const etag = await apiEtag(p);
  const g = await getBuf(p);
  if (!g) return { data: fallback, etag: null };
  return { data: JSON.parse(g.buf.toString("utf8")), etag: etag || g.etag };
}

export async function putJSON(p, data, ifMatch) {
  await putBuf(p, Buffer.from(JSON.stringify(data, null, 2)), "application/json; charset=utf-8", ifMatch);
}

export async function exists(p) {
  if (LOCAL) { try { await fs.access(path.join(ROOT, p)); return true; } catch { return false; } }
  const { head } = await sdk();
  try { await head(p); return true; } catch { return false; }
}

export async function remove(p) {
  if (LOCAL) { await fs.rm(path.join(ROOT, p), { force: true }); return; }
  const { del, head } = await sdk();
  try { const h = await head(p); await del(h.url); } catch { /* already gone */ }
}

// Read-modify-write with optimistic concurrency (ETag) and retries.
// If the precondition keeps failing although the stored document did not change between reads,
// the conflict is not a real concurrent writer (e.g. ETag format mismatch): write unconditionally.
export async function updateJSON(p, fallback, mutate) {
  let lastSeen = null;
  let stableConflicts = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, etag } = await getJSON(p, fallback);
    const seen = JSON.stringify(data);
    const next = await mutate(structuredClone(data));
    if (next === undefined) return data; // no change
    const unconditional = stableConflicts >= 2;
    try {
      await putJSON(p, next, unconditional ? undefined : (etag || undefined));
      return next;
    } catch (e) {
      if (e instanceof ConflictError) {
        stableConflicts = lastSeen === seen ? stableConflicts + 1 : 0;
        lastSeen = seen;
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error(`Could not update ${p} after retries`);
}
