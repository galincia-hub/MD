// Microsoft Edge online TTS (same protocol as english_codex/tools/generate-audio.mjs), returns an MP3 Buffer.
import tls from "node:tls";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
export const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

export const VOICE_MAP = {
  Hyun: "en-US-BrianNeural",
  Emma: "en-US-EmmaNeural",
  Ashlee: "en-US-AvaNeural",
  Lydia: "en-US-JennyNeural",
  Joyce: "en-US-AriaNeural",
  DJ: "en-US-AndrewNeural"
};

const rid = () => randomUUID().replace(/-/g, "");
function secMsGec() {
  const rounded = Math.floor(Date.now() / 1000 / 300) * 300;
  const ticks = BigInt(rounded + 11644473600) * 10000000n;
  return createHash("sha256").update(`${ticks}${TRUSTED_CLIENT_TOKEN}`).digest("hex").toUpperCase();
}
function endpointPath() {
  const params = new URLSearchParams({ TrustedClientToken: TRUSTED_CLIENT_TOKEN, "Sec-MS-GEC": secMsGec(), "Sec-MS-GEC-Version": SEC_MS_GEC_VERSION, ConnectionId: rid() });
  return `/consumer/speech/synthesize/readaloud/edge/v1?${params}`;
}
const dateHeader = () => new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");
const esc = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const frame = (headers, body) => `${headers.map(([k, v]) => `${k}:${v}`).join("\r\n")}\r\n\r\n${body}`;

function encodeClientFrame(message) {
  const payload = Buffer.from(message, "utf8");
  const mask = randomBytes(4);
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length]);
  else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}
function readServerFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = Boolean(buffer[1] & 0x80);
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) { if (buffer.length < 4) return null; length = buffer.readUInt16BE(2); offset = 4; }
  else if (length === 127) { if (buffer.length < 10) return null; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
  let mask;
  if (masked) { if (buffer.length < offset + 4) return null; mask = buffer.subarray(offset, offset + 4); offset += 4; }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  return { opcode, payload, rest: buffer.subarray(offset + length) };
}
function stripAudioHeader(buffer) {
  if (buffer.length < 2) return Buffer.alloc(0);
  const dataStart = 2 + buffer.readUInt16BE(0);
  if (dataStart > buffer.length) return Buffer.alloc(0);
  if (!buffer.subarray(2, dataStart).toString("utf8").includes("Path:audio")) return Buffer.alloc(0);
  return buffer.subarray(dataStart);
}

export function synthesizeOnce(voice, text, timeoutMs = 30000) {
  const id = rid();
  const chunks = [];
  return new Promise((resolve, reject) => {
    const socket = tls.connect(443, "speech.platform.bing.com", { servername: "speech.platform.bing.com" });
    let upgraded = false;
    let pending = Buffer.alloc(0);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("TTS timeout")); }, timeoutMs);
    const fail = (e) => { clearTimeout(timer); socket.destroy(); reject(e); };
    socket.on("connect", () => {
      socket.write([
        `GET ${endpointPath()} HTTP/1.1`, "Host: speech.platform.bing.com", "Upgrade: websocket", "Connection: Upgrade",
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`, "Sec-WebSocket-Version: 13",
        `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
        "Accept-Encoding: gzip, deflate, br, zstd", "Accept-Language: en-US,en;q=0.9", "Pragma: no-cache", "Cache-Control: no-cache",
        "Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold", `Cookie: muid=${rid().toUpperCase()};`, "", ""
      ].join("\r\n"));
    });
    socket.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      if (!upgraded) {
        const end = pending.indexOf("\r\n\r\n");
        if (end < 0) return;
        const status = pending.subarray(0, end).toString("utf8").split("\r\n")[0];
        if (!status.startsWith("HTTP/1.1 101")) return fail(new Error(`TTS handshake failed: ${status}`));
        upgraded = true;
        pending = pending.subarray(end + 4);
        socket.write(encodeClientFrame(frame([["X-Timestamp", dateHeader()], ["Content-Type", "application/json; charset=utf-8"], ["Path", "speech.config"]],
          JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false }, outputFormat: OUTPUT_FORMAT } } } }))));
        const ssml = `<speak version="1.0" xml:lang="en-US"><voice name="${voice}"><prosody rate="+0%" pitch="+0Hz">${esc(text)}</prosody></voice></speak>`;
        socket.write(encodeClientFrame(frame([["X-RequestId", id], ["X-Timestamp", dateHeader()], ["Content-Type", "application/ssml+xml"], ["Path", "ssml"]], ssml)));
      }
      for (;;) {
        const f = readServerFrame(pending);
        if (!f) break;
        pending = f.rest;
        if (f.opcode === 1 && f.payload.toString("utf8").includes("Path:turn.end")) {
          clearTimeout(timer); socket.end();
          return chunks.length ? resolve(Buffer.concat(chunks)) : reject(new Error("TTS returned no audio"));
        }
        if (f.opcode === 2) { const a = stripAudioHeader(f.payload); if (a.length) chunks.push(a); }
        else if (f.opcode === 8) return fail(new Error("TTS socket closed early"));
      }
    });
    socket.on("error", (e) => fail(new Error(`TTS socket error: ${e.message}`)));
  });
}

export async function synthesize(voice, text, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try { return await synthesizeOnce(voice, text); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  throw last;
}
