(function () {
  const DB_NAME = "business-english-library";
  const DB_VERSION = 1;
  const STORE = "scripts";
  const VOICE_KEY = "businessEnglishVoiceMap";
  const SEEDED_KEY = "businessEnglishSeededV1";

  const state = {
    db: null,
    scripts: [],
    selectedScript: null,
    queue: [],
    queueIndex: 0,
    turnIndex: 0,
    playing: false,
    paused: false,
    parsedDraft: null,
    currentAudio: null,
    voices: [],
    voiceMap: JSON.parse(localStorage.getItem(VOICE_KEY) || "{}")
  };

  const $ = (id) => document.getElementById(id);

  const views = {
    library: $("libraryView"),
    import: $("importView"),
    detail: $("detailView")
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("partner", "partner", { unique: false });
          store.createIndex("topic", "topic", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transaction(mode) {
    return state.db.transaction(STORE, mode).objectStore(STORE);
  }

  function getAllScripts() {
    return new Promise((resolve, reject) => {
      const request = transaction("readonly").getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => (b.importedAt || "").localeCompare(a.importedAt || "")));
      request.onerror = () => reject(request.error);
    });
  }

  function saveScript(script) {
    return new Promise((resolve, reject) => {
      const request = transaction("readwrite").put(script);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function deleteScript(id) {
    return new Promise((resolve, reject) => {
      const request = transaction("readwrite").delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function seedSamples() {
    const existing = await getAllScripts();
    for (const sample of window.BIZ_ENGLISH_SAMPLES || []) {
      const current = existing.find((script) => script.sample && script.title === sample.title);
      await saveScript({ ...sample, id: current?.id || crypto.randomUUID() });
    }
    localStorage.setItem(SEEDED_KEY, "true");
  }

  async function refreshScripts() {
    state.scripts = await getAllScripts();
    renderFilters();
    renderLibrary();
  }

  function showView(name) {
    Object.values(views).forEach((view) => view.classList.remove("active"));
    views[name].classList.add("active");
  }

  function filteredScripts() {
    const query = $("searchInput").value.trim().toLowerCase();
    const partner = $("partnerFilter").value;
    const topic = $("topicFilter").value;
    return state.scripts.filter((script) => {
      const matchesQuery = !query || [script.title, script.partner, script.topic, ...(script.speakers || [])].join(" ").toLowerCase().includes(query);
      const matchesPartner = !partner || script.partner === partner;
      const matchesTopic = !topic || script.topic === topic;
      return matchesQuery && matchesPartner && matchesTopic;
    });
  }

  function renderFilters() {
    const partners = [...new Set(state.scripts.map((script) => script.partner).filter(Boolean))].sort();
    const topics = [...new Set(state.scripts.map((script) => script.topic).filter(Boolean))].sort();
    renderSelect($("partnerFilter"), "Partner", partners);
    renderSelect($("topicFilter"), "Topic", topics);
  }

  function renderSelect(select, label, options) {
    const previous = select.value;
    select.innerHTML = `<option value="">${label}: 전체</option>${options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")}`;
    if (options.includes(previous)) select.value = previous;
  }

  function renderLibrary() {
    const list = $("libraryList");
    const scripts = filteredScripts();
    if (!scripts.length) {
      list.innerHTML = '<div class="empty">저장된 스크립트가 없습니다.</div>';
      return;
    }
    list.innerHTML = scripts.map((script) => `
      <button class="script-card" type="button" data-id="${script.id}">
        <h3>${escapeHtml(script.title)}</h3>
        <div class="meta-row">
          <span class="pill">${escapeHtml(script.partner || "General")}</span>
          <span class="pill">${escapeHtml(script.topic || "General")}</span>
          <span>${script.turns.length} turns</span>
        </div>
      </button>
    `).join("");
    list.querySelectorAll(".script-card").forEach((card) => {
      card.addEventListener("click", () => openScript(card.dataset.id));
    });
  }

  function renderPreview(parsed) {
    const panel = $("previewPanel");
    const template = $("previewTemplate").content.cloneNode(true);
    const summary = template.querySelector(".preview-summary");
    summary.innerHTML = [
      ["Title", parsed.title],
      ["Speakers", parsed.speakers.join(", ") || "-"],
      ["Dialogue count", parsed.stats.dialogueCount],
      ["English count", parsed.stats.englishCount],
      ["Korean count", parsed.stats.koreanCount],
      ["Notes", parsed.stats.hasNotes ? "있음" : "없음"]
    ].map(([key, value]) => `<div class="summary-line"><span>${key}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("");

    const partnerInput = template.querySelector("#previewPartner");
    const topicInput = template.querySelector("#previewTopic");
    partnerInput.value = parsed.partner;
    topicInput.value = parsed.topic;

    const warnings = template.querySelector(".warnings");
    warnings.innerHTML = parsed.warnings.length
      ? `<strong>Warnings</strong><ul>${parsed.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
      : "<strong>Warnings</strong><p>없음</p>";

    template.querySelector("#savePreviewButton").addEventListener("click", async () => {
      const script = normalizeScript({
        ...state.parsedDraft,
        partner: partnerInput.value.trim() || "General",
        topic: topicInput.value.trim() || "General"
      });
      await saveScript(script);
      $("scriptInput").value = "";
      panel.classList.add("hidden");
      await refreshScripts();
      openScript(script.id);
    });

    panel.innerHTML = "";
    panel.appendChild(template);
    panel.classList.remove("hidden");
  }

  function normalizeScript(script) {
    return {
      ...script,
      id: script.id || crypto.randomUUID(),
      importedAt: script.importedAt || new Date().toISOString(),
      speakers: [...new Set((script.turns || []).map((turn) => turn.speaker).filter(Boolean))]
    };
  }

  function openScript(id) {
    const script = state.scripts.find((item) => item.id === id);
    if (!script) return;
    state.selectedScript = script;
    state.queue = filteredScripts();
    state.queueIndex = Math.max(0, state.queue.findIndex((item) => item.id === id));
    state.turnIndex = 0;
    renderDetail(script);
    updateNowPlaying(script, null);
    showView("detail");
  }

  function renderDetail(script) {
    const detail = $("scriptDetail");
    detail.innerHTML = `
      <h2 id="detailTitle">${escapeHtml(script.title)}</h2>
      <div class="meta-row">
        <span class="pill">${escapeHtml(script.partner || "General")}</span>
        <span class="pill">${escapeHtml(script.topic || "General")}</span>
        <span>${script.turns.length} turns</span>
      </div>
      <div class="detail-actions">
        <button class="primary-button" id="playScriptButton" type="button">이 스크립트 재생</button>
        <button class="compact-button" id="playFromHereButton" type="button">여기부터 연속재생</button>
      </div>
      <div class="voice-grid">
        ${(script.speakers || []).map((speaker) => `
          <label>${escapeHtml(speaker)}
            <select data-speaker="${escapeHtml(speaker)}" class="voice-select"></select>
          </label>
        `).join("")}
      </div>
      ${script.notes ? `<h3>운영 메모</h3><p class="notes">${escapeHtml(script.notes)}</p>` : ""}
      <div class="turn-list">
        ${script.turns.map((turn, index) => `
          <section class="turn" data-turn-index="${index}">
            <div class="turn-speaker">${escapeHtml(turn.speaker)} ${turn.turn || index + 1}</div>
            <p class="english">${escapeHtml(turn.english)}</p>
            <p class="korean">${escapeHtml(turn.korean || "번역 없음")}</p>
          </section>
        `).join("")}
      </div>
    `;
    detail.querySelector("#playScriptButton").addEventListener("click", () => startPlayback([script], 0, 0));
    detail.querySelector("#playFromHereButton").addEventListener("click", () => startPlayback(state.queue.length ? state.queue : [script], state.queueIndex, 0));
    renderVoiceSelectors(detail);
  }

  function renderVoiceSelectors(container) {
    container.querySelectorAll(".voice-select").forEach((select) => {
      const speaker = select.dataset.speaker;
      select.innerHTML = `<option value="">자동 선택</option>${state.voices
        .filter((voice) => voice.lang.toLowerCase().startsWith("en"))
        .map((voice) => `<option value="${escapeHtml(voice.name)}">${escapeHtml(voice.name)} (${escapeHtml(voice.lang)})</option>`)
        .join("")}`;
      select.value = state.voiceMap[speaker] || "";
      select.addEventListener("change", () => {
        if (select.value) state.voiceMap[speaker] = select.value;
        else delete state.voiceMap[speaker];
        localStorage.setItem(VOICE_KEY, JSON.stringify(state.voiceMap));
      });
    });
  }

  function loadVoices() {
    state.voices = speechSynthesis.getVoices();
    if (state.selectedScript) renderDetail(state.selectedScript);
  }

  function getVoiceForSpeaker(speaker) {
    const englishVoices = state.voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
    const selected = state.voiceMap[speaker];
    if (selected) return englishVoices.find((voice) => voice.name === selected) || null;
    if (!englishVoices.length) return null;
    const hash = [...speaker].reduce((total, char) => total + char.charCodeAt(0), 0);
    return englishVoices[hash % englishVoices.length];
  }

  function startPlayback(queue, queueIndex = 0, turnIndex = 0) {
    if (!queue.length) return;
    stopCurrentAudio();
    speechSynthesis.cancel();
    state.queue = queue;
    state.queueIndex = queueIndex;
    state.turnIndex = turnIndex;
    state.playing = true;
    state.paused = false;
    $("playPauseButton").textContent = "Ⅱ";
    playCurrentTurn();
  }

  function playCurrentTurn() {
    const script = state.queue[state.queueIndex];
    if (!script) {
      stopPlayback();
      return;
    }
    const turn = script.turns[state.turnIndex];
    if (!turn) {
      state.queueIndex += 1;
      state.turnIndex = 0;
      playCurrentTurn();
      return;
    }
    updateNowPlaying(script, turn);
    if (turn.audioUrl) {
      playAudioUrl(turn.audioUrl, () => advanceTurn());
      return;
    }
    const utterance = new SpeechSynthesisUtterance(turn.english);
    utterance.lang = "en-US";
    utterance.rate = 1.0;
    utterance.pitch = 1;
    const voice = getVoiceForSpeaker(turn.speaker);
    if (voice) utterance.voice = voice;
    utterance.onend = () => advanceTurn();
    utterance.onerror = () => advanceTurn();
    speechSynthesis.speak(utterance);
  }

  function playAudioUrl(url, done) {
    stopCurrentAudio();
    const audio = new Audio(url);
    state.currentAudio = audio;
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  }

  function stopCurrentAudio() {
    if (!state.currentAudio) return;
    state.currentAudio.pause();
    state.currentAudio.currentTime = 0;
    state.currentAudio = null;
  }

  function advanceTurn() {
    if (!state.playing) return;
    state.turnIndex += 1;
    playCurrentTurn();
  }

  function stopPlayback() {
    state.playing = false;
    state.paused = false;
    state.turnIndex = 0;
    stopCurrentAudio();
    speechSynthesis.cancel();
    $("playPauseButton").textContent = "▶";
  }

  function togglePlayback() {
    if (state.playing && !state.paused) {
      if (state.currentAudio) state.currentAudio.pause();
      speechSynthesis.pause();
      state.paused = true;
      $("playPauseButton").textContent = "▶";
      return;
    }
    if (state.playing && state.paused) {
      if (state.currentAudio) state.currentAudio.play().catch(() => {});
      speechSynthesis.resume();
      state.paused = false;
      $("playPauseButton").textContent = "Ⅱ";
      return;
    }
    const queue = state.selectedScript ? [state.selectedScript] : filteredScripts();
    startPlayback(queue, 0, 0);
  }

  function updateNowPlaying(script, turn) {
    $("nowTitle").textContent = script ? script.title : "스크립트를 선택하세요";
    $("nowSpeaker").textContent = turn ? `${turn.speaker} ${turn.turn || ""}` : "Ready";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function bindEvents() {
    $("addScriptButton").addEventListener("click", () => showView("import"));
    $("cancelImportButton").addEventListener("click", () => showView("library"));
    $("backToLibraryButton").addEventListener("click", () => showView("library"));
    $("parseButton").addEventListener("click", () => {
      state.parsedDraft = window.BusinessScriptParser.parseBusinessScript($("scriptInput").value);
      renderPreview(state.parsedDraft);
    });
    $("searchInput").addEventListener("input", renderLibrary);
    $("partnerFilter").addEventListener("change", renderLibrary);
    $("topicFilter").addEventListener("change", renderLibrary);
    $("playQueueButton").addEventListener("click", () => startPlayback(filteredScripts(), 0, 0));
    $("playPauseButton").addEventListener("click", togglePlayback);
    $("nextButton").addEventListener("click", () => {
      stopCurrentAudio();
      speechSynthesis.cancel();
      state.turnIndex += 1;
      if (state.playing) playCurrentTurn();
    });
    $("prevButton").addEventListener("click", () => {
      stopCurrentAudio();
      speechSynthesis.cancel();
      state.turnIndex = Math.max(0, state.turnIndex - 1);
      if (state.playing) playCurrentTurn();
    });
    $("deleteScriptButton").addEventListener("click", async () => {
      if (!state.selectedScript) return;
      await deleteScript(state.selectedScript.id);
      state.selectedScript = null;
      stopPlayback();
      await refreshScripts();
      showView("library");
    });
  }

  async function init() {
    bindEvents();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
    if ("speechSynthesis" in window) {
      loadVoices();
      speechSynthesis.onvoiceschanged = loadVoices;
    }
    state.db = await openDb();
    await seedSamples();
    await refreshScripts();
  }

  init().catch((error) => {
    $("libraryList").innerHTML = `<div class="empty">앱 초기화 실패: ${escapeHtml(error.message)}</div>`;
  });
})();
