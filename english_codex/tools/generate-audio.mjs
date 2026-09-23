import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import tls from "node:tls";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

const voiceMap = {
  Hyun: "en-US-BrianNeural",
  Emma: "en-US-EmmaNeural",
  Ashlee: "en-US-AvaNeural"
};

const sampleTurns = [
  {
    speaker: "Hyun",
    text: "Emma, today I'd like to align on the suite benefits before we finalize the package.",
    output: "english_codex/audio/suite-drinks/hyun-1.mp3"
  },
  {
    speaker: "Emma",
    text: "That makes sense. Our current suite benefits are strong, but the drinks package may need a clearer boundary.",
    output: "english_codex/audio/suite-drinks/emma-1.mp3"
  },
  {
    speaker: "Hyun",
    text: "I agree. We can position it as a welcome benefit, not an unlimited inclusion.",
    output: "english_codex/audio/suite-drinks/hyun-2.mp3"
  },
  {
    speaker: "Emma",
    text: "If we present it that way, I think the internal approval will be easier.",
    output: "english_codex/audio/suite-drinks/emma-2.mp3"
  }
];

function endpoint(connectionId) {
  const params = new URLSearchParams({
    TrustedClientToken: TRUSTED_CLIENT_TOKEN,
    "Sec-MS-GEC": generateSecMsGec(),
    "Sec-MS-GEC-Version": SEC_MS_GEC_VERSION,
    ConnectionId: connectionId
  });
  return `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?${params}`;
}

function endpointPath(connectionId) {
  return new URL(endpoint(connectionId)).pathname + new URL(endpoint(connectionId)).search;
}

function generateSecMsGec() {
  const windowsEpochOffset = 11644473600;
  const roundedSeconds = Math.floor(Date.now() / 1000 / 300) * 300;
  const ticks = BigInt(roundedSeconds + windowsEpochOffset) * 10000000n;
  return createHash("sha256").update(`${ticks}${TRUSTED_CLIENT_TOKEN}`).digest("hex").toUpperCase();
}

function requestId() {
  return randomUUID().replace(/-/g, "");
}

function dateHeader() {
  return new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function frame(headers, body) {
  return `${headers.map(([key, value]) => `${key}:${value}`).join("\r\n")}\r\n\r\n${body}`;
}

function speechConfigMessage() {
  return frame(
    [
      ["X-Timestamp", dateHeader()],
      ["Content-Type", "application/json; charset=utf-8"],
      ["Path", "speech.config"]
    ],
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: false,
              wordBoundaryEnabled: false
            },
            outputFormat: OUTPUT_FORMAT
          }
        }
      }
    })
  );
}

function ssmlMessage(id, voice, text) {
  const ssml = `<speak version="1.0" xml:lang="en-US"><voice name="${voice}"><prosody rate="+0%" pitch="+0Hz">${escapeXml(text)}</prosody></voice></speak>`;
  return frame(
    [
      ["X-RequestId", id],
      ["X-Timestamp", dateHeader()],
      ["Content-Type", "application/ssml+xml"],
      ["Path", "ssml"]
    ],
    ssml
  );
}

function stripAudioHeader(buffer) {
  if (buffer.length < 2) return Buffer.alloc(0);
  const headerLength = buffer.readUInt16BE(0);
  const dataStart = 2 + headerLength;
  if (dataStart > buffer.length) return Buffer.alloc(0);
  const header = buffer.subarray(2, dataStart).toString("utf8");
  if (!header.includes("Path:audio")) return Buffer.alloc(0);
  return buffer.subarray(dataStart);
}

async function synthesize({ speaker, text, output }) {
  const voice = voiceMap[speaker];
  if (!voice) throw new Error(`No voice configured for ${speaker}`);

  const id = requestId();
  const chunks = [];

  await new Promise((resolve, reject) => {
    const socket = tls.connect(443, "speech.platform.bing.com", { servername: "speech.platform.bing.com" });
    const wsKey = randomBytes(16).toString("base64");
    let upgraded = false;
    let pending = Buffer.alloc(0);

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out while generating ${output}`));
    }, 30000);

    socket.on("connect", () => {
      const request = [
        `GET ${endpointPath(requestId())} HTTP/1.1`,
        "Host: speech.platform.bing.com",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${wsKey}`,
        "Sec-WebSocket-Version: 13",
        `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
        "Accept-Encoding: gzip, deflate, br, zstd",
        "Accept-Language: en-US,en;q=0.9",
        "Pragma: no-cache",
        "Cache-Control: no-cache",
        "Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        `Cookie: muid=${randomUUID().replace(/-/g, "").toUpperCase()};`,
        "",
        ""
      ].join("\r\n");
      socket.write(request);
    });

    socket.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      if (!upgraded) {
        const headerEnd = pending.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const response = pending.subarray(0, headerEnd).toString("utf8");
        if (!response.startsWith("HTTP/1.1 101")) {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error(`WebSocket handshake failed for ${output}: ${response.split("\r\n")[0]}`));
          return;
        }
        upgraded = true;
        pending = pending.subarray(headerEnd + 4);
        socket.write(encodeClientFrame(speechConfigMessage()));
        socket.write(encodeClientFrame(ssmlMessage(id, voice, text)));
      }

      for (;;) {
        const parsed = readServerFrame(pending);
        if (!parsed) break;
        pending = parsed.rest;
        if (parsed.opcode === 1) {
          const textFrame = parsed.payload.toString("utf8");
          if (textFrame.includes("Path:turn.end")) {
            clearTimeout(timeout);
            socket.end();
            resolve();
            return;
          }
        } else if (parsed.opcode === 2) {
          const audio = stripAudioHeader(parsed.payload);
          if (audio.length) chunks.push(audio);
        } else if (parsed.opcode === 8) {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error(`WebSocket closed while generating ${output}`));
          return;
        }
      }
    });

    socket.on("error", (event) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error while generating ${output}: ${event.message || "unknown error"}`));
    });
  });

  if (!chunks.length) throw new Error(`No audio returned for ${output}`);
  const file = join(process.cwd(), output);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.concat(chunks));
  console.log(`${output} (${voice})`);
}

function encodeClientFrame(message) {
  const payload = Buffer.from(message, "utf8");
  const mask = randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function readServerFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = Boolean(buffer[1] & 0x80);
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  let mask;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return {
    opcode,
    payload,
    rest: buffer.subarray(offset + length)
  };
}

async function listEnglishVoices() {
  const url = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
  const voices = await fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Voice list failed: ${response.status}`);
    return response.json();
  });
  for (const voice of voices.filter((item) => item.Locale?.startsWith("en-"))) {
    console.log(`${voice.ShortName}\t${voice.Gender}\t${voice.Locale}\t${voice.FriendlyName || voice.Name}`);
  }
}

if (process.argv.includes("--list-voices")) {
  await listEnglishVoices();
} else {
  for (const turn of sampleTurns) {
    await synthesize(turn);
  }
}
