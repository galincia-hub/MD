// Converts seed/md/Sxx_*.md (private scripts, bundled only into the protected deployment) into script objects.
// Dialogue is parsed with the listening app's own parser so SCRIPT.md stays paste-import compatible.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const { parseBusinessScript } = createRequire(import.meta.url)("./parser.cjs");
const MAP = { "Source Summary": "sourceSummary", FACT: "fact", "OUR POSITION": "ourPosition", "OPEN ISSUE": "openIssue", "COUNTERPART POSITION": "counterpartPosition", "LIKELY QUESTIONS": "likelyQuestions", "HYUN RESPONSE STRATEGY": "responseStrategy", "OWNER DECISION NEEDED": "ownerDecision", DIALOGUE: "dialogue", COACHING: "coaching", SOURCES: "sources" };
export function loadSeed(dir = "seed/md") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^S\d+_.*\.md$/.test(f)).sort().map((f) => {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) throw new Error(`${f}: missing frontmatter`);
    const s = Object.fromEntries(m[1].split("\n").map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
    for (const part of m[2].split(/^## /m).slice(1)) { const nl = part.indexOf("\n"); const h = part.slice(0, nl).trim(); if (MAP[h]) s[MAP[h]] = part.slice(nl + 1).trim(); }
    const parsed = parseBusinessScript(s.dialogue || "");
    if (parsed.warnings.length) throw new Error(`${f}: ${parsed.warnings.join("; ")}`);
    s.turns = parsed.turns.map((t) => ({ speaker: t.speaker, turn: t.turn, english: t.english, korean: t.korean }));
    delete s.dialogue;
    return s;
  });
}
