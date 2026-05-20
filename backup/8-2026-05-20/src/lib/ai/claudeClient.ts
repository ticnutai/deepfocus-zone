export interface GeneratedQuestion {
  question: string;
  options: string[];     // exactly 4
  correctIndex: number;  // 0–3
  explanation: string;
}

export async function generateQuestionsWithClaude(
  apiKey: string,
  masechetHebrew: string,
  daf: number,
  amud: "a" | "b",
  text: string,
  count = 10,
): Promise<GeneratedQuestion[]> {
  const amudLabel = amud === "a" ? "עמוד א" : "עמוד ב";
  const dafLabel = String(daf); // numeric; display as-is

  const systemPrompt =
    "אתה מומחה לתלמוד בבלי ומומחה בהוראה. אתה מייצר שאלות בחינה איכותיות בעברית.";

  const userPrompt = `להלן טקסט מ${masechetHebrew} דף ${dafLabel} ${amudLabel}:

---
${text.slice(0, 6000)}
---

צור בדיוק ${count} שאלות בחירה מרובה בעברית הבודקות הבנת תוכן הגמרא.

דרישות לכל שאלה:
- שאלה ברורה ומדויקת בעברית
- בדיוק 4 תשובות אפשריות (רק אחת נכונה)
- אינדקס התשובה הנכונה (0, 1, 2 או 3)
- הסבר קצר (משפט אחד) מדוע התשובה נכונה

החזר JSON בלבד, ללא markdown, ללא טקסט נוסף:
[{"question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"..."},...]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => String(res.status));
    throw new Error(`Claude API שגיאה ${res.status}: ${errText}`);
  }

  const data = await res.json() as { content?: Array<{ text?: string }> };
  const content = data.content?.[0]?.text ?? "";

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("לא נמצא JSON בתשובת Claude — נסה שוב");

  const questions = JSON.parse(jsonMatch[0]) as GeneratedQuestion[];
  if (!Array.isArray(questions)) throw new Error("תשובת Claude לא בפורמט הנכון");
  return questions;
}
