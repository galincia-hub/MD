/*
 * Private Resource Pack importer (generic; contains no private content).
 * Reads a situation package zip:  <PKG>/{resource.json, SCRIPT.md, COACHING.md, ..., audio/*.mp3}
 * and returns { script, audio, missing } where script is compatible with the Library
 * (title/partner/topic/notes/speakers/turns[]) and audio is a Map(audioKey -> Blob).
 * Supports zip "stored" (method 0) and "deflate" (method 8, via DecompressionStream).
 */
(function (root) {
  const td = new TextDecoder("utf-8");

  function u16(view, offset) { return view.getUint16(offset, true); }
  function u32(view, offset) { return view.getUint32(offset, true); }

  function asArrayBuffer(input) {
    if (input instanceof ArrayBuffer) return input;
    if (ArrayBuffer.isView(input)) {
      return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    }
    return null;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("이 브라우저는 압축 해제를 지원하지 않습니다 (DecompressionStream).");
    }
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      throw new Error("zip 압축 해제에 실패했습니다.");
    }
  }

  function need(view, offset, size, message) {
    if (offset < 0 || size < 0 || offset + size > view.byteLength) throw new Error(message);
  }

  async function readZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    const scanFrom = Math.max(0, bytes.length - 22);
    const scanTo = Math.max(0, bytes.length - 65557);
    for (let i = scanFrom; i >= scanTo; i -= 1) {
      need(view, i, 4, "zip 파일이 아닙니다.");
      if (u32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("zip 파일이 아닙니다.");
    need(view, eocd, 22, "zip 파일이 아닙니다.");
    const count = u16(view, eocd + 10);
    let p = u32(view, eocd + 16);
    const files = new Map();
    for (let n = 0; n < count; n += 1) {
      need(view, p, 46, "zip 디렉터리 손상");
      if (u32(view, p) !== 0x02014b50) throw new Error("zip 디렉터리 손상");
      const flags = u16(view, p + 8);
      const method = u16(view, p + 10);
      const csize = u32(view, p + 20);
      const nameLen = u16(view, p + 28);
      const extraLen = u16(view, p + 30);
      const commentLen = u16(view, p + 32);
      const local = u32(view, p + 42);
      need(view, p + 46, nameLen + extraLen + commentLen, "zip 디렉터리 손상");
      const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, "/");
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith("/")) continue;
      if (flags & 1) throw new Error("암호화된 zip은 지원하지 않습니다.");
      need(view, local, 30, "zip 로컬 헤더 손상");
      if (u32(view, local) !== 0x04034b50) throw new Error("zip 로컬 헤더 손상");
      const lNameLen = u16(view, local + 26);
      const lExtraLen = u16(view, local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      need(view, start, csize, "zip 데이터가 잘렸습니다.");
      const raw = bytes.subarray(start, start + csize);
      let data;
      if (method === 0) data = raw.slice();
      else if (method === 8) data = await inflateRaw(raw);
      else throw new Error("지원하지 않는 압축 방식: " + method);
      files.set(name, data);
    }
    return files;
  }

  function isMp3(data) {
    if (!data || data.length < 4) return false;
    let i = 0;
    if (data.length > 10 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
      const size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f);
      i = 10 + size;
    }
    const end = Math.min(data.length - 1, i + 65536);
    for (; i < end; i += 1) {
      if (data[i] === 0xff && (data[i + 1] & 0xe0) === 0xe0) return true;
    }
    return false;
  }

  function zipEntry(files, base, audioPath) {
    const normalized = String(audioPath || "").replace(/\\/g, "/").replace(/^\.\//, "");
    return files.get(base + normalized) || files.get(normalized) || null;
  }

  async function importPack(fileOrBuffer) {
    let buffer = asArrayBuffer(fileOrBuffer);
    if (!buffer) {
      if (fileOrBuffer && typeof fileOrBuffer.arrayBuffer === "function") buffer = await fileOrBuffer.arrayBuffer();
      else throw new Error("zip 데이터를 읽을 수 없습니다.");
    }
    const files = await readZip(buffer);
    const resName = [...files.keys()].find((key) => /(^|\/)resource\.json$/.test(key));
    if (!resName) throw new Error("resource.json이 없는 패키지입니다.");
    const base = resName.slice(0, resName.length - "resource.json".length);
    let jsonText = td.decode(files.get(resName));
    if (jsonText.charCodeAt(0) === 0xfeff) jsonText = jsonText.slice(1);
    const res = JSON.parse(jsonText);
    if (!res.id || !Array.isArray(res.turns)) throw new Error("resource.json 형식 오류");
    const packId = "pack:" + res.id;
    const audio = new Map();
    const missing = [];
    const turns = res.turns.map((turn, index) => {
      const key = turn.key || `T${String(index + 1).padStart(2, "0")}`;
      const mapped = {
        id: `${packId}:${key}`,
        speaker: turn.speaker,
        turn: turn.turn,
        english: turn.english,
        korean: turn.korean || "",
        textHash: turn.textHash || null
      };
      if (turn.audio) {
        const data = zipEntry(files, base, turn.audio);
        if (data && isMp3(data)) {
          const audioKey = `${packId}/${key}/${String(turn.textHash || "").slice(0, 8)}`;
          audio.set(audioKey, new Blob([data], { type: "audio/mpeg" }));
          mapped.audioKey = audioKey;
        } else {
          missing.push(key);
        }
      }
      return mapped;
    });
    const script = {
      id: packId,
      title: res.title || res.id,
      partner: res.partner || "",
      topic: res.topic || "",
      notes: res.notes || "",
      speakers: [...new Set(turns.map((turn) => turn.speaker).filter(Boolean))],
      turns,
      source: "resource-pack",
      packId: res.id,
      packName: res.packageName || res.id,
      contentHash: res.contentHash || null,
      scriptVersion: res.scriptVersion || null,
      importedAt: new Date().toISOString()
    };
    return { script, audio, missing };
  }

  root.ResourcePackImporter = { readZip, importPack, isMp3 };
  if (typeof module !== "undefined" && module.exports) module.exports = root.ResourcePackImporter;
})(typeof window !== "undefined" ? window : globalThis);
