export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
export function isAdmin(request) {
  const key = process.env.ADMIN_KEY;
  return Boolean(key) && request.headers.get("x-admin-key") === key;
}
// Same-origin guard for owner actions (the deployment itself is behind Vercel Authentication).
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}
