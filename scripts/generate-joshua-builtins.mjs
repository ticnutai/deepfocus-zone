import { writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { from: 2, to: 11, count: 10, out: "src/lib/ai/joshuaBuiltins.generated.ts" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--from" && val) args.from = Number(val);
    if (key === "--to" && val) args.to = Number(val);
    if (key === "--count" && val) args.count = Number(val);
    if (key === "--out" && val) args.out = val;
  }
  return args;
}

function toHebrewNumeral(n) {
  const vals = [400, 300, 200, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const letters = ["\u05ea", "\u05e9", "\u05e8", "\u05e7", "\u05e6", "\u05e4", "\u05e2", "\u05e1", "\u05e0", "\u05de", "\u05dc", "\u05db", "\u05d9", "\u05d8", "\u05d7", "\u05d6", "\u05d5", "\u05d4", "\u05d3", "\u05d2", "\u05d1", "\u05d0"];
  if (n % 100 === 15) return `${toHebrewNumeral(n - 15)}\u05d8\u05d5`;
  if (n % 100 === 16) return `${toHebrewNumeral(n - 16)}\u05d8\u05d6`;
  let result = "";
  let remaining = n;
  for (let i = 0; i < vals.length; i += 1) {
    while (remaining >= vals[i]) {
      result += letters[i];
      remaining -= vals[i];
    }
  }
  return result;
}

function ensureQuestions(raw, chapter, count) {
  if (!Array.isArray(raw)) {
    throw new Error(`Chapter ${chapter}: Claude did not return an array`);
  }

  const cleaned = raw.slice(0, count).map((q, i) => {
    if (!q || typeof q !== "object") throw new Error(`Chapter ${chapter} Q${i + 1}: invalid object`);
    const options = Array.isArray(q.options) ? q.options.map(String).slice(0, 4) : [];
    if (options.length !== 4) throw new Error(`Chapter ${chapter} Q${i + 1}: options must be exactly 4`);
    const correctIndex = Number(q.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      throw new Error(`Chapter ${chapter} Q${i + 1}: correctIndex must be 0-3`);
    }
    const verseStart = Number(q.verseStart);
    if (!Number.isInteger(verseStart) || verseStart < 1) {
      throw new Error(`Chapter ${chapter} Q${i + 1}: verseStart must be >= 1`);
    }
    const verseEnd = q.verseEnd == null ? undefined : Number(q.verseEnd);
    if (verseEnd != null && (!Number.isInteger(verseEnd) || verseEnd < verseStart)) {
      throw new Error(`Chapter ${chapter} Q${i + 1}: verseEnd must be >= verseStart`);
    }

    return {
      question: String(q.question ?? ""),
      options,
      correctIndex,
      explanation: String(q.explanation ?? ""),
      verseStart,
      ...(verseEnd != null ? { verseEnd } : {}),
    };
  });

  if (cleaned.length !== count) {
    throw new Error(`Chapter ${chapter}: expected ${count} questions, got ${cleaned.length}`);
  }

  return cleaned;
}

async function fetchJoshuaChapter(chapter) {
  const ref = `Joshua.${chapter}`;
  const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?pad=0&commentary=0&context=0`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Sefaria HTTP ${res.status} for ${ref}`);
  }
  const data = await res.json();
  if (data?.error) {
    throw new Error(`Sefaria error for ${ref}: ${String(data.error)}`);
  }

  const he = Array.isArray(data?.he) ? data.he : [];
  const en = Array.isArray(data?.text) ? data.text : [];
  const lines = [];
  for (let i = 0; i < he.length; i += 1) {
    const verseNo = i + 1;
    const heText = String(he[i] ?? "").trim();
    const enText = String(en[i] ?? "").trim();
    lines.push(`v${verseNo} (${toHebrewNumeral(verseNo)}): ${heText}`);
    if (enText) lines.push(`EN v${verseNo}: ${enText}`);
  }

  return {
    chapter,
    verseCount: he.length,
    textForModel: lines.join("\n"),
  };
}

async function generateChapterQuestions(apiKey, chapterData, count) {
  const systemPrompt = "You are a Tanakh teacher creating accurate Hebrew multiple-choice questions.";
  const userPrompt = [
    `Generate exactly ${count} Hebrew multiple-choice questions from Joshua chapter ${chapterData.chapter}.`,
    "Use only chapter content provided below.",
    "Each question must include:",
    "- question (Hebrew)",
    "- options: array of exactly 4 Hebrew options",
    "- correctIndex: integer 0-3",
    "- explanation: one short Hebrew sentence",
    "- verseStart: integer verse number",
    "- optional verseEnd: integer if question spans range",
    "Prefer references that spread across the chapter.",
    "Return JSON array only, with no markdown and no extra text.",
    "",
    "Chapter text:",
    chapterData.textForModel,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    throw new Error(`Claude HTTP ${res.status} on chapter ${chapterData.chapter}: ${err}`);
  }

  const data = await res.json();
  const content = data?.content?.[0]?.text ?? "";
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Chapter ${chapterData.chapter}: no JSON array found in Claude response`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return ensureQuestions(parsed, chapterData.chapter, count);
}

function buildVerseRangeLabel(questions) {
  const starts = questions.map((q) => q.verseStart);
  const ends = questions.map((q) => q.verseEnd ?? q.verseStart);
  const minV = Math.min(...starts);
  const maxV = Math.max(...ends);
  if (minV === maxV) {
    return `\u05e4\u05e1\u05d5\u05e7 ${toHebrewNumeral(minV)}`;
  }
  return `\u05e4\u05e1\u05d5\u05e7\u05d9\u05dd ${toHebrewNumeral(minV)}-${toHebrewNumeral(maxV)}`;
}

async function main() {
  const { from, to, count, out } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY env var");
  }
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    throw new Error("Invalid chapter range. Example: --from 2 --to 11");
  }
  if (!Number.isInteger(count) || count < 1 || count > 30) {
    throw new Error("Invalid count. Use 1-30");
  }

  const chapters = [];
  for (let chapter = from; chapter <= to; chapter += 1) {
    console.log(`Generating Joshua chapter ${chapter}...`);
    const chapterData = await fetchJoshuaChapter(chapter);
    const questions = await generateChapterQuestions(apiKey, chapterData, count);
    chapters.push({
      chapter,
      verseRangeLabel: buildVerseRangeLabel(questions),
      questions,
    });
  }

  const header = [
    "// Auto-generated by scripts/generate-joshua-builtins.mjs",
    "// Do not edit manually.",
    "",
  ].join("\n");

  const body = `export const GENERATED_JOSHUA_CHAPTERS = ${JSON.stringify(chapters, null, 2)};\n`;
  const outputPath = path.resolve(process.cwd(), out);
  await writeFile(outputPath, header + body, "utf8");
  console.log(`Done. Wrote ${chapters.length} chapters to ${outputPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
