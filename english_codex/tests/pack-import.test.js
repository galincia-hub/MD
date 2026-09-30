const assert = require("assert");
const zlib = require("zlib");
const { createHash } = require("crypto");
const { importPack, isMp3 } = require("../js/pack-import");

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(entries, method, comment = Buffer.alloc(0)) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, directory, end, comment]);
}

const mp3a = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);
const mp3b = Buffer.from([0xff, 0xf3, 0x64, 0xc4, 0x11, 0x22, 0x33, 0x44]);
const junk = Buffer.from("this is not audio");
const resource = {
  id: "S01",
  packageName: "S01_SAMPLE",
  title: "Meeting - Agenda Check",
  partner: "Emma",
  topic: "Meeting",
  notes: "Keep the example generic.",
  contentHash: "abc123",
  scriptVersion: 1,
  turns: [
    {
      key: "T01",
      speaker: "Hyun",
      turn: 1,
      english: "Could we start with the agenda?",
      korean: "안건부터 시작할까요?",
      textHash: "aaaaaaaaaaaaaaaa",
      audio: "audio/T01_hyun_aaaaaaaa.mp3"
    },
    {
      key: "T02",
      speaker: "Emma",
      turn: 1,
      english: "Yes. Let's confirm the order first.",
      korean: "네. 순서를 먼저 확인하죠.",
      textHash: "bbbbbbbbbbbbbbbb",
      audio: "audio\\T02_emma_bbbbbbbb.mp3"
    },
    {
      key: "T03",
      speaker: "Hyun",
      turn: 2,
      english: "The attachment is not audio.",
      korean: "첨부 파일은 음성이 아닙니다.",
      textHash: "cccccccccccccccc",
      audio: "audio/T03_hyun_cccccccc.txt"
    }
  ]
};

const entries = [
  { name: "S01_SAMPLE/SCRIPT.md", data: Buffer.from("### Meeting\n\n**Hyun 1**\n\nCould we start with the agenda?\n") },
  { name: "S01_SAMPLE/resource.json", data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(resource), "utf8")]) },
  { name: "S01_SAMPLE/audio/T01_hyun_aaaaaaaa.mp3", data: mp3a },
  { name: "S01_SAMPLE/audio/T02_emma_bbbbbbbb.mp3", data: mp3b },
  { name: "S01_SAMPLE/audio/T03_hyun_cccccccc.txt", data: junk }
];

async function assertPack(bytes) {
  const { script, audio, missing } = await importPack(bytes);
  assert.equal(script.id, "pack:S01");
  assert.equal(script.title, "Meeting - Agenda Check");
  assert.equal(script.partner, "Emma");
  assert.equal(script.topic, "Meeting");
  assert.equal(script.notes, "Keep the example generic.");
  assert.equal(script.source, "resource-pack");
  assert.equal(script.packId, "S01");
  assert.equal(script.packName, "S01_SAMPLE");
  assert.equal(script.contentHash, "abc123");
  assert.equal(script.scriptVersion, 1);
  assert.deepEqual(script.speakers, ["Hyun", "Emma"]);
  assert.equal(script.turns.length, 3);
  assert.equal(script.turns[0].id, "pack:S01:T01");
  assert.equal(script.turns[0].audioKey, "pack:S01/T01/aaaaaaaa");
  assert.equal(script.turns[0].english, "Could we start with the agenda?");
  assert.equal(script.turns[0].korean, "안건부터 시작할까요?");
  assert.equal(script.turns[1].audioKey, "pack:S01/T02/bbbbbbbb");
  assert.equal(script.turns[2].audioKey, undefined);
  assert.equal(script.turns[2].english, "The attachment is not audio.");
  assert.deepEqual(missing, ["T03"]);
  assert.equal(audio.size, 2);
  const firstBlob = audio.get("pack:S01/T01/aaaaaaaa");
  const secondBlob = audio.get("pack:S01/T02/bbbbbbbb");
  assert.equal(firstBlob.type, "audio/mpeg");
  assert.equal(secondBlob.type, "audio/mpeg");
  assert.deepEqual(Buffer.from(await firstBlob.arrayBuffer()), mp3a);
  assert.deepEqual(Buffer.from(await secondBlob.arrayBuffer()), mp3b);
}

async function main() {
  assert.equal(isMp3(mp3a), true);
  assert.equal(isMp3(mp3b), true);
  assert.equal(isMp3(junk), false);
  assert.equal(isMp3(Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])), false);
  const id3 = Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    mp3a
  ]);
  assert.equal(isMp3(id3), true);

  const comment = Buffer.from("generic");
  await assertPack(makeZip(entries, 0, comment));
  await assertPack(makeZip(entries, 8, comment));
  await assertPack(new Blob([makeZip(entries, 8)]));

  const missing = makeZip([{ name: "S01_SAMPLE/SCRIPT.md", data: Buffer.from("no resource\n") }], 0);
  await assert.rejects(() => importPack(missing), /resource\.json/);
  await assert.rejects(() => importPack(Buffer.from("not a zip")), /zip/);

  const started = Date.now();
  const { turnAudioFileName } = await import("../tools/generate-audio.mjs");
  const text = "Could we start with the agenda?";
  const voice = "en-US-BrianNeural";
  const hash = createHash("sha256").update(`${voice}|${text}`).digest("hex").slice(0, 8);
  assert.equal(turnAudioFileName(1, "Hyun", `  ${text}  `, voice), `T01_hyun_${hash}.mp3`);
  assert.match(turnAudioFileName(12, "Lydia", "Hello", "en-US-JennyNeural"), /^T12_lydia_[0-9a-f]{8}\.mp3$/);
  assert.ok(Date.now() - started < 2000, "importing the audio generator should not synthesize");

  console.log("pack-import tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
