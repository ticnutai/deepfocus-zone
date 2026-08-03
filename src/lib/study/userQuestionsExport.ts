import { saveAs } from "file-saver";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { Card } from "./types";
import { loadBundledLibraryIds } from "./bundledLibraryGuard";
import { isCardFromSource } from "./store";

export type UserQuestionExportFormat = "docx" | "pdf";

const TYPE_LABEL: Record<Card["type"], string> = {
  flashcard: "כרטיסייה",
  multiple: "אמריקאי",
  boolean: "נכון / לא נכון",
  combo: "משולבת",
};

export function filterUserOwnedCards(
  cards: Card[],
  bundledCardIds: ReadonlySet<string>,
  sourceCardCheck: (id: string) => boolean,
): Card[] {
  return cards.filter((card) => !bundledCardIds.has(card.id) && !sourceCardCheck(card.id));
}

export async function selectUserOwnedCards(cards: Card[]): Promise<Card[]> {
  const bundled = await loadBundledLibraryIds();
  return filterUserOwnedCards(cards, bundled.cards, isCardFromSource);
}

function answerLines(card: Card): string[] {
  if (card.type === "flashcard") return [card.answer || "—"];
  if (card.type === "boolean") {
    return [card.correct ? "נכון" : "לא נכון", ...(card.explanation ? [`הסבר: ${card.explanation}`] : [])];
  }

  const options = (card.options ?? []).map((option, index) => {
    const correct = (card.correctIndices ?? []).includes(index);
    return `${correct ? "✓" : "○"} ${option}`;
  });
  if (card.type === "combo" && card.answer) options.unshift(`תשובה פתוחה: ${card.answer}`);
  if (card.explanation) options.push(`הסבר: ${card.explanation}`);
  return options.length ? options : ["—"];
}

function datedFileBase(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}`;
}

function rtlParagraph(
  text: string,
  bold = false,
  heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel],
): Paragraph {
  return new Paragraph({
    heading,
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { after: heading ? 120 : 60 },
    children: [new TextRun({ text, bold, rightToLeft: true })],
  });
}

async function exportDocx(cards: Card[], title: string, filePrefix: string): Promise<void> {
  const children: Paragraph[] = [
    rtlParagraph(title, true, HeadingLevel.HEADING_1),
    rtlParagraph(`סה״כ שאלות: ${cards.length}`),
    rtlParagraph(`נוצר בתאריך: ${new Date().toLocaleDateString("he-IL")}`),
    new Paragraph({ text: "" }),
  ];

  cards.forEach((card, index) => {
    children.push(rtlParagraph(`${index + 1}. ${card.question}`, true, HeadingLevel.HEADING_2));
    children.push(rtlParagraph(`סוג: ${TYPE_LABEL[card.type]}`));
    if (card.tags.length) children.push(rtlParagraph(`סיווגים: ${card.tags.join(" · ")}`));
    children.push(rtlParagraph("תשובה:", true));
    answerLines(card).forEach((line) => children.push(rtlParagraph(line)));
    children.push(new Paragraph({ text: "" }));
  });

  const document = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(document);
  saveAs(blob, `${datedFileBase(filePrefix)}.docx`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function exportPdf(cards: Card[], title: string, filePrefix: string): void {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("הדפדפן חסם את חלון ה-PDF. יש לאפשר חלונות קופצים ולנסות שוב.");
  popup.opener = null;

  const questions = cards.map((card, index) => `
    <section class="question">
      <h2>${index + 1}. ${escapeHtml(card.question)}</h2>
      <div class="meta">סוג: ${escapeHtml(TYPE_LABEL[card.type])}${card.tags.length ? ` · סיווגים: ${escapeHtml(card.tags.join(" · "))}` : ""}</div>
      <h3>תשובה</h3>
      ${answerLines(card).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
    </section>
  `).join("");

  popup.document.open();
  popup.document.write(`<!doctype html>
  <html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(datedFileBase(filePrefix))}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    body { font-family: Arial, "Noto Sans Hebrew", sans-serif; color: #101d3d; line-height: 1.55; }
    h1 { text-align: center; border-bottom: 2px solid #d7a119; padding-bottom: 10px; }
    .summary { text-align: center; color: #596579; margin-bottom: 24px; }
    .question { break-inside: avoid; border-bottom: 1px solid #ead9ad; padding: 0 0 14px; margin: 0 0 18px; }
    h2 { font-size: 17px; margin: 0 0 6px; }
    h3 { font-size: 14px; margin: 10px 0 2px; color: #9a6c00; }
    p { margin: 2px 0; white-space: pre-wrap; }
    .meta { color: #657087; font-size: 12px; }
  </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <div class="summary">סה״כ ${cards.length} שאלות · ${escapeHtml(new Date().toLocaleDateString("he-IL"))}</div>
    ${questions}
    <script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script>
  </body></html>`);
  popup.document.close();
}

export async function exportUserQuestions(cards: Card[], format: UserQuestionExportFormat): Promise<number> {
  const ownedCards = await selectUserOwnedCards(cards);
  if (!ownedCards.length) return 0;
  await exportCardsDocument(ownedCards, format, "השאלות והתשובות שלי", "השאלות-שלי");
  return ownedCards.length;
}

export async function exportCardsDocument(
  cards: Card[],
  format: UserQuestionExportFormat,
  title: string,
  filePrefix = "שאלות",
): Promise<void> {
  if (format === "docx") await exportDocx(cards, title, filePrefix);
  else exportPdf(cards, title, filePrefix);
}
