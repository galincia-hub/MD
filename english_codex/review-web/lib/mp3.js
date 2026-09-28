// Minimal MP3 validator: walks MPEG audio frames and computes duration.
const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],      // MPEG1 L3
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]           // MPEG2/2.5 L3
};
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export function inspectMp3(buf) {
  let i = 0;
  if (buf.length > 10 && buf.toString("latin1", 0, 3) === "ID3") {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + size;
  }
  let frames = 0, seconds = 0, sampleRate = 0, bitrate = 0, firstFrame = -1;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { if (frames === 0) { i += 1; continue; } break; }
    const ver = (buf[i + 1] >> 3) & 3; const layer = (buf[i + 1] >> 1) & 3;
    const brIdx = buf[i + 2] >> 4; const srIdx = (buf[i + 2] >> 2) & 3; const pad = (buf[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) { if (frames === 0) { i += 1; continue; } break; }
    const br = BITRATES[ver === 3 ? 1 : 2][brIdx] * 1000; const sr = RATES[ver][srIdx];
    const spf = ver === 3 ? 1152 : 576;
    const len = Math.floor((spf / 8) * br / sr) + pad;
    if (len < 4) break;
    if (firstFrame < 0) firstFrame = i;
    frames += 1; seconds += spf / sr; sampleRate = sr; bitrate = br;
    i += len;
  }
  return { frames, durationSec: Math.round(seconds * 100) / 100, sampleRate, bitrate, firstFrame, walkedTo: Math.min(i, buf.length), bytes: buf.length };
}

export function validateMp3(buf, text) {
  const info = inspectMp3(buf);
  const errors = [];
  if (buf.length < 1500) errors.push(`too small (${buf.length} bytes)`);
  if (info.frames < 10) errors.push(`only ${info.frames} MPEG frames`);
  if (info.durationSec < 0.5) errors.push(`duration ${info.durationSec}s too short`);
  if (info.frames > 0 && buf.length - info.walkedTo > 1024) errors.push(`MPEG frame stream broken at byte ${info.walkedTo} of ${buf.length}`);
  const words = String(text || "").split(/\s+/).filter(Boolean).length;
  const expected = words / 2.9; // ~175 wpm
  if (words > 3 && info.durationSec < expected * 0.35) errors.push(`duration ${info.durationSec}s implausibly short for ${words} words`);
  return { ok: errors.length === 0, errors, ...info };
}
