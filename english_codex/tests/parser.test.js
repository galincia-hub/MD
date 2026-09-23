const assert = require("assert");
const { parseBusinessScript } = require("../js/parser");

const sample = `### 협상 스크립트 - 스위트 드링크 패키지 포함

**Hyun 1**

Emma, today I'd like to talk about suite benefits.

오늘은 스위트 특전에 대해 말씀드리고 싶습니다.

**Emma 1**

I see. Our current suite benefits are already included.

그렇군요. 현재 스위트 특전은 이미 포함되어 있습니다.

**Hyun**

Could we define the drinks package as a welcome benefit?

#### 운영 메모

설득 논리는 무제한 포함이 아니라 웰컴 특전으로 제한하는 것이다.
`;

const parsed = parseBusinessScript(sample);

assert.equal(parsed.title, "협상 스크립트 - 스위트 드링크 패키지 포함");
assert.equal(parsed.turns.length, 3);
assert.equal(parsed.stats.englishCount, 3);
assert.equal(parsed.stats.koreanCount, 2);
assert.equal(parsed.stats.hasNotes, true);
assert.deepEqual(parsed.speakers, ["Hyun", "Emma"]);
assert(parsed.warnings.some((warning) => warning.includes("missing a turn number")));
assert(parsed.warnings.some((warning) => warning.includes("no Korean translation")));

console.log("parser tests passed");
