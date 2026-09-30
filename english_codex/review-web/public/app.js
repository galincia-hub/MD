(function () {
  const LABEL = { REVIEW_REQUIRED: "검토 대기", REVISION_REQUIRED: "수정 필요", APPROVED_FOR_AUDIO: "승인 · 음성 생성 중", AUDIO_READY: "음성 완료", ARCHIVED: "보관" };
  const STAT = [["total", "전체"], ["REVISION_REQUIRED", "Draft (수정 중)"], ["REVIEW_REQUIRED", "Review (검토 대기)"], ["APPROVED_FOR_AUDIO", "Approved (생성 중)"], ["AUDIO_READY", "Audio Ready"], ["ARCHIVED", "Archived"]];
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let data = null; let filter = ""; const open = new Set(); let timer = null;

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), 3500); }

  async function load() {
    const r = await fetch("/api/scripts", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) { $("#list").innerHTML = `<p class="muted">불러오기 실패 (${r.status})</p>`; return; }
    data = await r.json(); render();
    const busy = data.scripts.some((s) => s.state.status === "APPROVED_FOR_AUDIO" && (!s.state.job || ["QUEUED", "RUNNING"].includes(s.state.job.status)));
    clearTimeout(timer); if (busy) timer = setTimeout(load, 4000);
  }

  function render() {
    const c = data.counts;
    $("#summary").innerHTML = STAT.map(([k, l]) => `<div class="stat"><b>${k === "total" ? data.total : c[k] || 0}</b><span>${l}</span></div>`).join("");
    $("#filters").innerHTML = [["", "전체"], ...Object.entries(LABEL)].map(([k, l]) => `<button type="button" data-f="${k}" class="${filter === k ? "on" : ""}">${l}</button>`).join("");
    $("#filters").querySelectorAll("button").forEach((b) => b.onclick = () => { filter = b.dataset.f; render(); });
    const list = data.scripts.filter((s) => !filter || s.state.status === filter);
    $("#list").innerHTML = list.length ? list.map(card).join("") : `<p class="muted">해당 상태의 스크립트가 없습니다.</p>`;
    document.querySelectorAll("details.card").forEach((d) => d.addEventListener("toggle", () => d.open ? open.add(d.dataset.id) : open.delete(d.dataset.id)));
    document.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => act(b.dataset.id, b.dataset.act));
  }

  const block = (h, v, cls = "") => v ? `<h3>${h}</h3><div class="pre ${cls}">${esc(v)}</div>` : "";

  function card(s) {
    const st = s.state; const status = st.status;
    const audio = status === "AUDIO_READY" && st.audio;
    const turns = (s.turns || []).map((t, i) => {
      const key = `T${String(i + 1).padStart(2, "0")}`;
      return `<div class="turn ${t.speaker === "Hyun" ? "hyun" : ""}"><div class="who">${esc(t.speaker)} ${esc(t.turn)}</div><p class="en">${esc(t.english)}</p><p class="ko">${esc(t.korean)}</p>${audio ? `<audio preload="none" controls src="/api/file?id=${s.id}&path=turn/${key}&v=${encodeURIComponent(String(st.audio.contentHash || "").slice(0, 8))}"></audio>` : ""}</div>`;
    }).join("");
    const job = st.job ? `<div class="job ${esc(st.job.status)}">음성 작업: <b>${esc(st.job.status)}</b>${st.job.step ? ` · ${esc(st.job.step)}` : ""}${st.job.attempts ? ` · 시도 ${st.job.attempts}회` : ""}${st.job.error ? `<br>${esc(st.job.error)}` : ""}</div>` : "";
    const changes = (s.changelog || []).slice(-5).reverse().map((c) => `<li>v${c.version} · ${esc(c.at.slice(0, 16).replace("T", " "))} UTC · ${esc(c.note)}</li>`).join("");
    const hist = (st.history || []).slice(-6).reverse().map((h) => `<li>${esc(h.at.slice(0, 16).replace("T", " "))} UTC · ${esc(h.action)}${h.comment ? ` — ${esc(h.comment)}` : ""}</li>`).join("");
    const canApprove = status === "REVIEW_REQUIRED";
    const canRetry = status === "APPROVED_FOR_AUDIO" && st.job && st.job.status === "FAILED";
    const canRevise = ["REVIEW_REQUIRED", "AUDIO_READY"].includes(status) || canRetry;
    return `<details class="card" data-id="${s.id}" ${open.has(s.id) ? "open" : ""}>
      <summary><span class="sid">${esc(s.id)}</span><span class="stitle">${esc(s.title)}</span><span class="badge b-${status}">${LABEL[status] || status}</span><span class="small muted">v${s.version}</span></summary>
      <div class="body">
        ${status === "REVISION_REQUIRED" && st.revisionRequest ? `<h3>요청한 수정사항</h3><div class="pre decision">${esc(st.revisionRequest.comment)}</div>` : ""}
        ${block("Source Summary", s.sourceSummary)}${block("FACT", s.fact)}${block("OUR POSITION", s.ourPosition)}${block("OPEN ISSUE", s.openIssue)}
        ${block("Counterpart Position", s.counterpartPosition)}${block("Likely Questions", s.likelyQuestions)}${block("Hyun Response Strategy", s.responseStrategy)}
        ${block("Owner Decision Needed (가정 확인)", s.ownerDecision, "decision")}
        <h3>English Dialogue + 한국어 번역</h3>${turns}
        ${block("Coaching / 운영 메모", s.coaching)}
        ${block("Source / 변경일", s.sources)}
        <h3>최근 변경</h3><ul class="hist">${changes}${hist}</ul>
        ${audio ? `<p class="small">음성 ${st.audio.turns}턴 · ${st.audio.durationSec}초 · 신규 ${st.audio.generated} / 재사용 ${st.audio.reused} · <a href="/api/file?id=${s.id}&path=package">패키지 zip 받기</a> · <a href="/api/file?id=${s.id}&path=resource.json" target="_blank">resource.json</a></p>` : ""}
        ${job}
        <div id="rev-${s.id}" class="hidden"><h3>무엇을 고칠까요?</h3><textarea id="c-${s.id}" placeholder="예: 3번째 Hyun 대사를 더 부드럽게, 금액 표현은 빼 주세요."></textarea></div>
        <div class="actions">
          <button type="button" class="btn-revise" data-act="revise" data-id="${s.id}" ${canRevise ? "" : "disabled"}>수정 필요</button>
          ${canRetry ? `<button type="button" class="btn-approve" data-act="retry" data-id="${s.id}">음성 생성 다시 시도</button>` :
            `<button type="button" class="btn-approve" data-act="approve" data-id="${s.id}" ${canApprove ? "" : "disabled"}>동의 · 음성 생성하기</button>`}
        </div>
      </div></details>`;
  }

  async function post(body) {
    const r = await fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `오류 ${r.status}`); return j;
  }

  async function act(id, action) {
    const s = data.scripts.find((x) => x.id === id);
    try {
      if (action === "revise") {
        const box = $(`#rev-${id}`);
        if (box.classList.contains("hidden")) { box.classList.remove("hidden"); $(`#c-${id}`).focus(); toast("수정할 내용을 적은 뒤 [수정 필요]를 한 번 더 눌러 주세요."); return; }
        const comment = $(`#c-${id}`).value.trim(); if (!comment) { toast("수정할 내용을 적어 주세요."); return; }
        await post({ id, action, comment, expectedVersion: s.version }); toast("수정 요청이 저장되었습니다. 음성은 만들지 않습니다.");
      } else if (action === "approve") {
        if (!confirm(`${id} ${s.title}\n\n이 스크립트 v${s.version}에 동의하고 음성을 생성할까요?`)) return;
        const j = await post({ id, action, expectedVersion: s.version }); toast(j.noop ? `이미 처리됨: ${j.noop}` : "승인 저장 완료 · 음성 생성을 시작했습니다.");
      } else if (action === "retry") { await post({ id, action, expectedVersion: s.version }); toast("음성 생성을 다시 시작했습니다."); }
      open.add(id); await load();
    } catch (e) { toast(e.message); }
  }

  $("#refresh").onclick = load;
  load();
})();
