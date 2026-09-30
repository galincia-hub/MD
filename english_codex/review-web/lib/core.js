// Review state machine + audio pipeline. No private content lives in this code.
import { createHash, randomUUID } from "node:crypto";
import { getJSON, putJSON, putBuf, getBuf, updateJSON, remove } from "./store.js";
import { VOICE_MAP, synthesize } from "./tts.js";
import { validateMp3 } from "./mp3.js";
import { createZip } from "./zip.js";

export const STATUSES = ["REVIEW_REQUIRED", "REVISION_REQUIRED", "APPROVED_FOR_AUDIO", "AUDIO_READY", "ARCHIVED"];
const SCRIPTS = "db/scripts.json";
const STATE = "db/state.json";
const JOB_STALE_MS = 290 * 1000;

const sha = (s) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();
export const packageName = (s) => `${s.id}_${(s.slug || s.title).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

const CONTENT_FIELDS = ["title", "partner", "topic", "sourceSummary", "fact", "ourPosition", "openIssue", "counterpartPosition", "likelyQuestions", "responseStrategy", "ownerDecision", "coaching", "turns"];
export function contentHash(script) {
  const o = {};
  for (const k of CONTENT_FIELDS) o[k] = k === "turns" ? (script.turns || []).map((t) => [t.speaker, t.turn, t.english, t.korean]) : script[k] || "";
  return sha(JSON.stringify(o));
}
export const voiceFor = (speaker) => VOICE_MAP[speaker] || VOICE_MAP[String(speaker).split(" ")[0]] || null;
export const turnTextHash = (turn) => sha(`${voiceFor(turn.speaker)}|${turn.english.trim()}`);

export async function loadAll() {
  const [{ data: scripts }, { data: state }] = await Promise.all([getJSON(SCRIPTS, {}), getJSON(STATE, {})]);
  return { scripts, state };
}

export function summarize(scripts, state) {
  const list = Object.values(scripts).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })).map((s) => ({ ...s, state: state[s.id] || { status: "REVIEW_REQUIRED", history: [] } }));
  const counts = Object.fromEntries(STATUSES.map((k) => [k, 0]));
  for (const s of list) counts[s.state.status] = (counts[s.state.status] || 0) + 1;
  const active = list.filter((s) => s.state.status !== "ARCHIVED").length;
  return { total: active, counts, scripts: list };
}

function pushHistory(st, entry) { st.history = [...(st.history || []), { at: now(), ...entry }].slice(-60); }

// ---- Admin: upsert scripts (used by the writing agent; never by the audio job)
export async function upsertScripts(incoming, note, actor = "agent") {
  const changed = [];
  const scripts = await updateJSON(SCRIPTS, {}, (all) => {
    for (const s of incoming) {
      const prev = all[s.id];
      const hash = contentHash(s);
      if (prev && prev.contentHash === hash) continue;
      const version = (prev?.version || 0) + 1;
      const changelog = [...(prev?.changelog || []), { at: now(), version, note: s.changeNote || note || (prev ? "revised" : "initial draft") }].slice(-40);
      all[s.id] = { ...s, version, contentHash: hash, updatedAt: now(), changelog };
      changed.push({ id: s.id, version, isNew: !prev });
    }
    return changed.length ? all : undefined;
  });
  if (changed.length) {
    await updateJSON(STATE, {}, (st) => {
      for (const c of changed) {
        const cur = st[c.id] || { status: "REVIEW_REQUIRED", history: [] };
        const inc = incoming.find((x) => x.id === c.id);
        cur.status = inc?.archive ? "ARCHIVED" : "REVIEW_REQUIRED";
        cur.reviewVersion = c.version;
        pushHistory(cur, { action: c.isNew ? "created" : "revised", version: c.version, by: actor, comment: inc?.changeNote || note || "" });
        st[c.id] = cur;
      }
      return st;
    });
  }
  return { changed, count: Object.keys(scripts).length };
}

// ---- Owner actions
export async function ownerAction({ id, action, comment, actor, expectedVersion }) {
  const { scripts } = await loadAll();
  const script = scripts[id];
  if (!script) return { ok: false, code: 404, error: "unknown script" };
  if (expectedVersion && Number(expectedVersion) !== script.version) return { ok: false, code: 409, error: "스크립트가 갱신되었습니다. 새로고침 후 다시 확인해 주세요." };
  let result = { ok: true, startJob: false };
  await updateJSON(STATE, {}, (st) => {
    const cur = st[id] || { status: "REVIEW_REQUIRED", history: [] };
    const running = cur.job?.status === "RUNNING" && Date.now() - Date.parse(cur.job.startedAt) < JOB_STALE_MS;
    if (action === "revise") {
      if (cur.status === "ARCHIVED") { result = { ok: false, code: 400, error: "archived" }; return undefined; }
      if (running) { result = { ok: false, code: 409, error: "음성 생성 중입니다. 완료 후 다시 시도해 주세요." }; return undefined; }
      cur.status = "REVISION_REQUIRED";
      cur.revisionRequest = { at: now(), version: script.version, comment: comment || "" };
      pushHistory(cur, { action: "revision_requested", version: script.version, by: actor, comment: comment || "" });
    } else if (action === "approve" || action === "retry") {
      if (cur.status === "AUDIO_READY" && cur.audio?.contentHash === script.contentHash) { result = { ok: true, noop: "already audio ready" }; return undefined; }
      if (cur.status === "APPROVED_FOR_AUDIO" && cur.approval?.contentHash === script.contentHash) {
        if (running) { result = { ok: true, noop: "job already running" }; return undefined; }
        result = { ok: true, startJob: true, retry: true };
        pushHistory(cur, { action: "retry_requested", version: script.version, by: actor });
        st[id] = cur;
        return st;
      }
      if (cur.status !== "REVIEW_REQUIRED") { result = { ok: false, code: 400, error: `현재 상태(${cur.status})에서는 승인할 수 없습니다.` }; return undefined; }
      cur.status = "APPROVED_FOR_AUDIO";
      cur.approval = { at: now(), by: actor, version: script.version, contentHash: script.contentHash };
      cur.job = { id: randomUUID(), status: "QUEUED", attempts: 0, queuedAt: now() };
      pushHistory(cur, { action: "approved_for_audio", version: script.version, by: actor, comment: comment || "" });
      result = { ok: true, startJob: true };
    } else { result = { ok: false, code: 400, error: "unknown action" }; return undefined; }
    st[id] = cur;
    return st;
  });
  return result;
}

// ---- Markdown renderers (package files)
const section = (h, body) => (body ? `## ${h}\n\n${String(body).trim()}\n\n` : "");
export function renderScriptMd(s) {
  let md = `### ${s.title}\n\n`;
  for (const t of s.turns) md += `**${t.speaker} ${t.turn}**\n${t.english.trim()}\n\n${t.korean.trim()}\n\n`;
  if (s.coaching) md += `#### 운영 노트\n${String(s.coaching).trim()}\n`;
  return md;
}
export function renderSourceBrief(s) {
  return `# ${s.id} ${s.title} — SOURCE BRIEF\n\n` + section("Source Summary", s.sourceSummary) + section("FACT", s.fact) + section("OUR POSITION", s.ourPosition) +
    section("OPEN ISSUE", s.openIssue) + section("COUNTERPART POSITION", s.counterpartPosition) + section("LIKELY QUESTIONS", s.likelyQuestions) +
    section("HYUN RESPONSE STRATEGY", s.responseStrategy) + section("OWNER DECISION NEEDED", s.ownerDecision) + section("Sources", s.sources);
}
export const renderCoaching = (s) => `# ${s.id} ${s.title} — COACHING / 운영 메모\n\n${String(s.coaching || "").trim()}\n`;
export function renderChangelog(s, st) {
  let md = `# ${s.id} ${s.title} — CHANGELOG\n\n## Script versions\n`;
  for (const c of s.changelog || []) md += `- v${c.version} · ${c.at} · ${c.note}\n`;
  md += `\n## Review / audio history\n`;
  for (const h of st.history || []) md += `- ${h.at} · ${h.action}${h.version ? ` · v${h.version}` : ""}${h.by ? ` · ${h.by}` : ""}${h.comment ? ` · ${h.comment}` : ""}\n`;
  return md;
}

// ---- Audio job
async function setJob(id, patch) {
  return updateJSON(STATE, {}, (st) => { const cur = st[id]; if (!cur) return undefined; cur.job = { ...(cur.job || {}), ...patch }; st[id] = cur; return st; });
}

export function checkTurns(script) {
  const errors = [];
  const turns = script.turns || [];
  if (turns.length < 2) errors.push("대화 턴이 2개 미만입니다.");
  turns.forEach((t, i) => {
    if (!voiceFor(t.speaker)) errors.push(`턴 ${i + 1}: 화자 '${t.speaker}'에 지정된 음성이 없습니다.`);
    if (!t.english || !t.english.trim()) errors.push(`턴 ${i + 1}: 영어 대사가 비어 있습니다.`);
    if (!t.korean || !t.korean.trim()) errors.push(`턴 ${i + 1}: 한국어 번역이 비어 있습니다.`);
    if (t.english && t.english.length > 1800) errors.push(`턴 ${i + 1}: 영어 대사가 너무 깁니다.`);
    if (i > 0 && turns[i - 1].speaker === t.speaker) errors.push(`턴 ${i + 1}: 같은 화자가 연속으로 나옵니다.`);
  });
  const seen = {};
  for (const t of turns) { const k = `${t.speaker}#${t.turn}`; if (seen[k]) errors.push(`화자 번호 중복: ${t.speaker} ${t.turn}`); seen[k] = 1; }
  return errors;
}

export async function runAudioJob(id, { actor = "system" } = {}) {
  const { scripts, state } = await loadAll();
  const script = scripts[id];
  const st = state[id];
  if (!script || !st) return { ok: false, error: "unknown script" };
  if (st.status !== "APPROVED_FOR_AUDIO") return { ok: true, noop: `status is ${st.status}` };
  if (st.approval?.contentHash !== script.contentHash) {
    await setJob(id, { status: "FAILED", error: "승인 이후 스크립트가 변경되었습니다. 다시 검토가 필요합니다.", finishedAt: now() });
    return { ok: false, error: "script changed after approval" };
  }
  if (st.job?.status === "RUNNING" && Date.now() - Date.parse(st.job.startedAt) < JOB_STALE_MS) return { ok: true, noop: "already running" };

  // Acquire lock (ETag-protected write)
  const jobId = randomUUID();
  let locked = false;
  await updateJSON(STATE, {}, (all) => {
    const cur = all[id];
    if (cur.job?.status === "RUNNING" && Date.now() - Date.parse(cur.job.startedAt) < JOB_STALE_MS) return undefined;
    cur.job = { ...(cur.job || {}), id: jobId, status: "RUNNING", attempts: (cur.job?.attempts || 0) + 1, startedAt: now(), step: "turn-check", error: null, by: actor };
    all[id] = cur; locked = true; return all;
  });
  if (!locked) return { ok: true, noop: "lock not acquired" };

  const pkg = packageName(script);
  const base = `resources/${id}`;
  try {
    const errors = checkTurns(script);
    if (errors.length) throw new Error(`화자/턴 검사 실패: ${errors.join(" / ")}`);

    const { data: prevRes } = await getJSON(`${base}/resource.json`, null);
    const prevByHash = new Map((prevRes?.turns || []).map((t) => [t.textHash, t]));
    const outTurns = []; let generated = 0; let reused = 0;
    await setJob(id, { step: "tts" });
    for (let i = 0; i < script.turns.length; i += 1) {
      const t = script.turns[i];
      const key = `T${String(i + 1).padStart(2, "0")}`;
      const voice = voiceFor(t.speaker);
      const textHash = turnTextHash(t);
      const file = `audio/${key}_${t.speaker.toLowerCase().replace(/[^a-z0-9]+/g, "-")}_${textHash.slice(0, 8)}.mp3`;
      let buf = null; let wasReused = false;
      const prev = prevByHash.get(textHash);
      if (prev) { const g = await getBuf(`${base}/${prev.audio}`); if (g && validateMp3(g.buf, t.english).ok) { buf = g.buf; wasReused = true; } }
      let partial = false; // same-name file left by an interrupted attempt (name carries voice+text hash)
      if (!buf) { const g = await getBuf(`${base}/${file}`); if (g && validateMp3(g.buf, t.english).ok) { buf = g.buf; wasReused = true; partial = true; } }
      let v = buf ? validateMp3(buf, t.english) : null;
      for (let a = 0; !buf || !v.ok; a += 1) { // fresh synthesis, re-synthesized if validation fails (e.g. truncated stream)
        if (a >= 5) throw new Error(`MP3 검증 실패 (${key}): ${v.errors.join(", ")}`);
        buf = await synthesize(voice, t.english.trim()); v = validateMp3(buf, t.english); wasReused = false;
      }
      if (!(wasReused && (partial || prev?.audio === file))) await putBuf(`${base}/${file}`, buf, "audio/mpeg");
      wasReused ? (reused += 1) : (generated += 1);
      outTurns.push({ index: i + 1, key, speaker: t.speaker, turn: t.turn, english: t.english.trim(), korean: t.korean.trim(), voice, textHash, audio: file, bytes: buf.length, durationSec: v.durationSec, reused: wasReused });
    }
    // Drop audio for deleted/changed turns
    const keep = new Set(outTurns.map((t) => t.audio));
    for (const p of prevRes?.turns || []) if (!keep.has(p.audio)) await remove(`${base}/${p.audio}`);

    await setJob(id, { step: "package" });
    const fresh = await loadAll();
    const stNow = fresh.state[id];
    const resource = {
      schema: "ci-biz-english-resource/v1", id, packageName: pkg, title: script.title, partner: script.partner, topic: script.topic,
      scriptVersion: script.version, contentHash: script.contentHash, approvedAt: stNow.approval?.at, approvedBy: stNow.approval?.by,
      generatedAt: now(), tts: { engine: "edge-tts", format: "audio-24khz-48kbitrate-mono-mp3", voices: VOICE_MAP },
      totals: { turns: outTurns.length, generated, reused, durationSec: Math.round(outTurns.reduce((a, t) => a + t.durationSec, 0) * 100) / 100 },
      notes: script.coaching || "", turns: outTurns
    };
    const files = {
      "SOURCE_BRIEF.md": renderSourceBrief(script),
      "SCRIPT.md": renderScriptMd(script),
      "COACHING.md": renderCoaching(script),
      "CHANGELOG.md": renderChangelog(script, stNow),
      "resource.json": JSON.stringify(resource, null, 2)
    };
    const entries = [];
    for (const [name, text] of Object.entries(files)) {
      const b = Buffer.from(text, "utf8");
      entries.push({ name: `${pkg}/${name}`, data: b });
      await putBuf(`${base}/${name}`, b, name.endsWith(".json") ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8");
    }
    for (const t of outTurns) { const g = await getBuf(`${base}/${t.audio}`); entries.push({ name: `${pkg}/${t.audio}`, data: g.buf }); }
    const zip = createZip(entries);
    await putBuf(`packages/${pkg}.zip`, zip, "application/zip");

    await updateJSON(STATE, {}, (all) => {
      const cur = all[id];
      if (cur.job?.id !== jobId) return undefined;
      if (cur.status !== "APPROVED_FOR_AUDIO") { cur.job = { ...cur.job, status: "SUPERSEDED", step: "done", finishedAt: now() }; all[id] = cur; return all; }
      cur.status = "AUDIO_READY";
      cur.audio = { version: script.version, contentHash: script.contentHash, generatedAt: resource.generatedAt, packageName: pkg, packagePath: `packages/${pkg}.zip`, zipBytes: zip.length, ...resource.totals };
      cur.job = { ...cur.job, status: "DONE", step: "done", finishedAt: now() };
      pushHistory(cur, { action: "audio_ready", version: script.version, by: "audio-job", comment: `${resource.totals.turns} turns · generated ${generated} · reused ${reused} · ${resource.totals.durationSec}s` });
      all[id] = cur; return all;
    });
    return { ok: true, id, package: pkg, ...resource.totals, zipBytes: zip.length, perTurn: outTurns.map((t) => `${t.key}:${t.durationSec}s/${t.bytes}B`) };
  } catch (e) {
    await updateJSON(STATE, {}, (all) => {
      const cur = all[id];
      if (cur.job?.id !== jobId) return undefined;
      cur.job = { ...cur.job, status: "FAILED", error: String(e.message || e).slice(0, 800), finishedAt: now() };
      pushHistory(cur, { action: "audio_failed", version: script.version, by: "audio-job", comment: String(e.message || e).slice(0, 300) });
      all[id] = cur; return all;
    });
    return { ok: false, error: String(e.message || e) };
  }
}

// Retry sweep: runs jobs for scripts the owner already approved (APPROVED_FOR_AUDIO) that are queued, failed or stale.
export async function sweepJobs({ actor = "sweep", budgetMs = 240000, maxAttempts = 6 } = {}) {
  const started = Date.now(); const results = [];
  const { scripts, state } = await loadAll();
  for (const [id, st] of Object.entries(state)) {
    if (Date.now() - started > budgetMs) break;
    if (st.status !== "APPROVED_FOR_AUDIO" || !scripts[id]) continue;
    const j = st.job || {};
    const stale = j.status === "RUNNING" && Date.now() - Date.parse(j.startedAt) >= JOB_STALE_MS;
    if (!(j.status === "QUEUED" || j.status === "FAILED" || stale || !j.status)) continue;
    if ((j.attempts || 0) >= maxAttempts) { results.push({ id, ok: false, error: "max attempts reached" }); continue; }
    results.push({ id, ...(await runAudioJob(id, { actor })) });
  }
  return results;
}
