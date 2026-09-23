(function (root) {
  const KNOWN_PARTNERS = ["Emma", "Emma Zhu", "Ashlee", "Ashlee Sun", "Hyun"];
  const TOPIC_KEYWORDS = [
    "Small Talk",
    "Confirmation",
    "Request",
    "Alternative Proposal",
    "Problem Solving",
    "Meeting",
    "Counterargument",
    "Negotiation",
    "Pricing",
    "Cabin",
    "Inventory",
    "Hard Block",
    "Charter",
    "FAM Tour",
    "Drinks Package",
    "Suite Benefits"
  ];

  function cleanHeading(line) {
    return line.replace(/^#{1,6}\s*/, "").trim();
  }

  function parseSpeakerLine(line) {
    const trimmed = line.trim();
    const bold = trimmed.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)$/);
    if (!bold) return null;
    const label = bold[1].trim();
    const numbered = label.match(/^(.+?)\s+(\d+)$/);
    if (numbered) {
      return {
        speaker: numbered[1].trim(),
        turn: Number(numbered[2]),
        missingTurn: false
      };
    }
    return { speaker: label, turn: null, missingTurn: true };
  }

  function splitParagraphs(lines) {
    return lines
      .join("\n")
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function inferPartner(speakers, text) {
    const haystack = text.toLowerCase();
    const known = KNOWN_PARTNERS.find((name) => haystack.includes(name.toLowerCase()));
    const nonHyun = speakers.find((speaker) => speaker.toLowerCase() !== "hyun");
    return nonHyun || known || speakers[0] || "General";
  }

  function inferTopic(title, text) {
    const haystack = `${title}\n${text}`.toLowerCase();
    const found = TOPIC_KEYWORDS.find((topic) => haystack.includes(topic.toLowerCase()));
    if (found) return found;
    const titleParts = title.split(/[—\-:|]/).map((part) => part.trim()).filter(Boolean);
    return titleParts[1] || titleParts[0] || "General";
  }

  function parseBusinessScript(input) {
    const source = String(input || "").replace(/\r\n/g, "\n").trim();
    const warnings = [];
    const lines = source.split("\n");
    let title = "";
    let notes = "";
    let inNotes = false;
    let current = null;
    const turns = [];

    function flushTurn() {
      if (!current) return;
      const paragraphs = splitParagraphs(current.lines);
      const english = paragraphs[0] || "";
      const korean = paragraphs[1] || "";
      const extra = paragraphs.slice(2).join("\n\n");
      if (!english) warnings.push(`${current.speaker} turn has no English dialogue.`);
      if (!korean) warnings.push(`${current.speaker}${current.turn ? " " + current.turn : ""} has no Korean translation.`);
      if (current.missingTurn) warnings.push(`${current.speaker} is missing a turn number.`);
      turns.push({
        id: `turn-${turns.length + 1}`,
        speaker: current.speaker,
        turn: current.turn || turns.length + 1,
        english,
        korean,
        extra,
        audioUrl: ""
      });
      current = null;
    }

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (/^####\s*/.test(line)) {
        flushTurn();
        const section = cleanHeading(line).toLowerCase();
        if (section.includes("운영") || section.includes("note")) {
          inNotes = true;
          continue;
        }
      }

      if (inNotes) {
        notes += `${line}\n`;
        continue;
      }

      if (!title && /^###\s+/.test(line)) {
        title = cleanHeading(line);
        continue;
      }

      const speaker = parseSpeakerLine(line);
      if (speaker) {
        flushTurn();
        current = { ...speaker, lines: [] };
        continue;
      }

      if (current) current.lines.push(line);
    }

    flushTurn();
    notes = notes.trim();

    if (!title) {
      title = source.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").trim() || "Untitled Script";
      warnings.push("Title heading is missing; first non-empty line was used.");
    }
    if (!turns.length) warnings.push("No speaker turns were detected.");

    for (let index = 1; index < turns.length; index += 1) {
      if (turns[index].speaker === turns[index - 1].speaker) {
        warnings.push(`${turns[index].speaker} appears in consecutive turns near turn ${index + 1}.`);
        break;
      }
    }

    const speakers = [...new Set(turns.map((turn) => turn.speaker).filter(Boolean))];
    const partner = inferPartner(speakers, source);
    const topic = inferTopic(title, source);

    return {
      title,
      partner,
      topic,
      notes,
      turns,
      speakers,
      warnings,
      stats: {
        dialogueCount: turns.length,
        englishCount: turns.filter((turn) => turn.english).length,
        koreanCount: turns.filter((turn) => turn.korean).length,
        hasNotes: Boolean(notes)
      },
      importedAt: new Date().toISOString()
    };
  }

  root.BusinessScriptParser = {
    parseBusinessScript,
    TOPIC_KEYWORDS
  };

  if (typeof module !== "undefined") {
    module.exports = root.BusinessScriptParser;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
