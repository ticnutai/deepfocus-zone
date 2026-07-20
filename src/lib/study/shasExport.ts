/**
 * shasExport — יצוא לוח לימוד הש"ס לפורמטים שונים.
 * תומך ב: XLSX, DOCX, CSV, JSON, PDF (דרך חלון הדפסה).
 */
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageBreak,
} from "docx";
import { SHAS_BAVLI, SEDARIM, type Masechta } from "./shasData";

type AmudKey = "a" | "b";
type DafEntry = { a?: number; b?: number };
type MasechtaProgress = Record<number, DafEntry>;
export type ShasBoardProgress = Record<string, MasechtaProgress>;

const HEB = [
  "א","ב","ג","ד","ה","ו","ז","ח","ט","י","יא","יב","יג","יד","טו","טז","יז","יח","יט","כ",
  "כא","כב","כג","כד","כה","כו","כז","כח","כט","ל","לא","לב","לג","לד","לה","לו","לז","לח","לט","מ",
  "מא","מב","מג","מד","מה","מו","מז","מח","מט","נ","נא","נב","נג","נד","נה","נו","נז","נח","נט","ס",
  "סא","סב","סג","סד","סה","סו","סז","סח","סט","ע","עא","עב","עג","עד","עה","עו","עז","עח","עט","פ",
  "פא","פב","פג","פד","פה","פו","פז","פח","פט","צ","צא","צב","צג","צד","צה","צו","צז","צח","צט","ק",
  "קא","קב","קג","קד","קה","קו","קז","קח","קט","קי","קיא","קיב","קיג","קיד","קטו","קטז","קיז","קיח","קיט","קכ",
  "קכא","קכב","קכג","קכד","קכה","קכו","קכז","קכח","קכט","קל","קלא","קלב","קלג","קלד","קלה","קלו","קלז","קלח","קלט","קמ",
  "קמא","קמב","קמג","קמד","קמה","קמו","קמז","קמח","קמט","קנ","קנא","קנב","קנג","קנד","קנה","קנו","קנז","קנח","קנט","קס",
  "קסא","קסב","קסג","קסד","קסה","קסו","קסז","קסח","קסט","קע","קעא","קעב","קעג","קעד","קעה",
];
const heb = (n: number) => HEB[n - 1] ?? String(n);

export type ExportScope =
  | { kind: "all" }
  | { kind: "seder"; seder: string }
  | { kind: "masechta"; masechta: string }
  | { kind: "learned" }
  | { kind: "unlearned" };

export interface ExportContent {
  status: boolean;       // status + reps count
  lastDate: boolean;     // last study date (not tracked yet — will show "-")
  summary: boolean;      // summary block on top
  emptyRows: boolean;    // include amudim with reps=0
}

export interface ExportOptions {
  scope: ExportScope;
  content: ExportContent;
  format: "pdf" | "docx" | "xlsx" | "csv" | "json";
  progress: ShasBoardProgress;
}

function scopeMasechtot(scope: ExportScope): Masechta[] {
  if (scope.kind === "seder") return SHAS_BAVLI.filter((m) => m.seder === scope.seder);
  if (scope.kind === "masechta") return SHAS_BAVLI.filter((m) => m.name === scope.masechta);
  return SHAS_BAVLI;
}

interface Row {
  seder: string;
  masechta: string;
  daf: number;
  dafHeb: string;
  amud: AmudKey;
  amudHeb: string;
  reps: number;
  status: string;
}

function buildRows(opts: ExportOptions): Row[] {
  const masechtot = scopeMasechtot(opts.scope);
  const rows: Row[] = [];
  for (const m of masechtot) {
    for (let d = 2; d <= m.pages + 1; d++) {
      for (const a of ["a", "b"] as AmudKey[]) {
        const reps = opts.progress[m.name]?.[d]?.[a] ?? 0;
        if (opts.scope.kind === "learned" && reps === 0) continue;
        if (opts.scope.kind === "unlearned" && reps > 0) continue;
        if (!opts.content.emptyRows && reps === 0 && opts.scope.kind !== "unlearned") continue;
        rows.push({
          seder: m.seder,
          masechta: m.name,
          daf: d,
          dafHeb: heb(d),
          amud: a,
          amudHeb: a === "a" ? "ע\"א" : "ע\"ב",
          reps,
          status: reps > 0 ? "נלמד" : "לא נלמד",
        });
      }
    }
  }
  return rows;
}

function computeSummary(opts: ExportOptions) {
  const masechtot = scopeMasechtot(opts.scope);
  let total = 0, learned = 0, reps = 0;
  for (const m of masechtot) {
    total += m.pages * 2;
    for (let d = 2; d <= m.pages + 1; d++) {
      for (const a of ["a", "b"] as AmudKey[]) {
        const r = opts.progress[m.name]?.[d]?.[a] ?? 0;
        if (r > 0) { learned++; reps += r; }
      }
    }
  }
  return { total, learned, reps, remaining: total - learned, pct: total ? Math.round((learned / total) * 100) : 0 };
}

function scopeTitle(scope: ExportScope): string {
  switch (scope.kind) {
    case "all": return "כל הש\"ס";
    case "seder": return `סדר ${scope.seder}`;
    case "masechta": return `מסכת ${scope.masechta}`;
    case "learned": return "עמודים שנלמדו";
    case "unlearned": return "עמודים שלא נלמדו";
  }
}

function fileBase(scope: ExportScope): string {
  const title = scopeTitle(scope).replace(/["/\\]/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return `לוח-שס-${title}-${date}`;
}

// ============ XLSX ============
function exportXlsx(opts: ExportOptions, rows: Row[]) {
  const wb = XLSX.utils.book_new();
  const summary = computeSummary(opts);
  const header: (string | number)[][] = [];
  if (opts.content.summary) {
    header.push([scopeTitle(opts.scope)]);
    header.push(["סה\"כ עמודים", summary.total]);
    header.push(["נלמדו", summary.learned]);
    header.push(["נשארו", summary.remaining]);
    header.push(["אחוז", `${summary.pct}%`]);
    header.push(["סך חזרות", summary.reps]);
    header.push([]);
  }
  const cols = ["סדר", "מסכת", "דף", "עמוד"];
  if (opts.content.status) cols.push("סטטוס", "חזרות");
  if (opts.content.lastDate) cols.push("תאריך אחרון");
  const dataRows = rows.map((r) => {
    const row: (string | number)[] = [r.seder, r.masechta, r.dafHeb, r.amudHeb];
    if (opts.content.status) row.push(r.status, r.reps);
    if (opts.content.lastDate) row.push("-");
    return row;
  });
  const ws = XLSX.utils.aoa_to_sheet([...header, cols, ...dataRows]);
  ws["!cols"] = cols.map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, ws, "לוח ש\"ס");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([wbout], { type: "application/octet-stream" }), `${fileBase(opts.scope)}.xlsx`);
}

// ============ CSV ============
function exportCsv(opts: ExportOptions, rows: Row[]) {
  const cols = ["סדר", "מסכת", "דף", "עמוד"];
  if (opts.content.status) cols.push("סטטוס", "חזרות");
  if (opts.content.lastDate) cols.push("תאריך אחרון");
  const csvRows = [cols.join(",")];
  for (const r of rows) {
    const row = [r.seder, r.masechta, r.dafHeb, r.amudHeb];
    if (opts.content.status) row.push(r.status, String(r.reps));
    if (opts.content.lastDate) row.push("-");
    csvRows.push(row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }
  const bom = "\uFEFF"; // Hebrew Excel compat
  saveAs(new Blob([bom + csvRows.join("\n")], { type: "text/csv;charset=utf-8" }), `${fileBase(opts.scope)}.csv`);
}

// ============ JSON ============
function exportJson(opts: ExportOptions, rows: Row[]) {
  const payload = {
    scope: scopeTitle(opts.scope),
    exportedAt: new Date().toISOString(),
    summary: opts.content.summary ? computeSummary(opts) : undefined,
    rows,
  };
  saveAs(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }),
    `${fileBase(opts.scope)}.json`,
  );
}

// ============ DOCX ============
async function exportDocx(opts: ExportOptions, rows: Row[]) {
  const summary = computeSummary(opts);
  const children: (Paragraph | Table)[] = [];

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    bidirectional: true,
    children: [new TextRun({ text: `לוח לימוד ש"ס — ${scopeTitle(opts.scope)}`, bold: true, rightToLeft: true })],
  }));

  if (opts.content.summary) {
    const lines = [
      `סה"כ עמודים: ${summary.total}`,
      `נלמדו: ${summary.learned} (${summary.pct}%)`,
      `נשארו: ${summary.remaining}`,
      `סך חזרות: ${summary.reps}`,
    ];
    for (const l of lines) {
      children.push(new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: l, rightToLeft: true })],
      }));
    }
    children.push(new Paragraph({ children: [new TextRun("")] }));
  }

  // Group rows by masechta
  const byMasechta = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byMasechta.has(r.masechta)) byMasechta.set(r.masechta, []);
    byMasechta.get(r.masechta)!.push(r);
  }

  const border = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const shade = (fill: string) => ({ fill, type: ShadingType.CLEAR, color: "auto" });
  const cell = (text: string, opts2: { bold?: boolean; fill?: string; width: number } = { width: 2000 }) =>
    new TableCell({
      borders,
      width: { size: opts2.width, type: WidthType.DXA },
      shading: opts2.fill ? shade(opts2.fill) : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text, bold: opts2.bold, rightToLeft: true })],
      })],
    });

  let first = true;
  for (const [mName, mRows] of byMasechta) {
    if (!first) children.push(new Paragraph({ children: [new PageBreak()] }));
    first = false;
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: `מסכת ${mName}`, bold: true, rightToLeft: true })],
    }));

    const cols = ["דף", "עמוד"];
    const widths = [1400, 1400];
    if (opts.content.status) { cols.push("סטטוס", "חזרות"); widths.push(1800, 1400); }
    if (opts.content.lastDate) { cols.push("תאריך אחרון"); widths.push(2200); }
    const totalW = widths.reduce((s, w) => s + w, 0);

    const headerRow = new TableRow({
      tableHeader: true,
      children: cols.map((c, i) => cell(c, { bold: true, fill: "F0E6C8", width: widths[i] })),
    });
    const dataRows = mRows.map((r) => {
      const cells = [cell(r.dafHeb, { width: widths[0] }), cell(r.amudHeb, { width: widths[1] })];
      if (opts.content.status) {
        cells.push(cell(r.status, { width: widths[2], fill: r.reps > 0 ? "E6F4EA" : undefined }));
        cells.push(cell(String(r.reps || ""), { width: widths[3] }));
      }
      if (opts.content.lastDate) cells.push(cell("-", { width: widths[cols.length - 1] }));
      return new TableRow({ children: cells });
    });

    children.push(new Table({
      width: { size: totalW, type: WidthType.DXA },
      columnWidths: widths,
      visuallyRightToLeft: true,
      rows: [headerRow, ...dataRows],
    }));
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 } } },
      children,
    }],
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${fileBase(opts.scope)}.docx`);
}

// ============ PDF (print window — supports Hebrew via browser fonts) ============
function exportPdf(opts: ExportOptions, rows: Row[]) {
  const summary = computeSummary(opts);
  const byMasechta = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byMasechta.has(r.masechta)) byMasechta.set(r.masechta, []);
    byMasechta.get(r.masechta)!.push(r);
  }
  const cols: string[] = ["דף", "עמוד"];
  if (opts.content.status) cols.push("סטטוס", "חזרות");
  if (opts.content.lastDate) cols.push("תאריך אחרון");

  const html = `<!doctype html><html dir="rtl" lang="he"><head>
<meta charset="utf-8"><title>לוח ש"ס — ${scopeTitle(opts.scope)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: "Segoe UI", "David", "Frank Ruehl", Arial, sans-serif; direction: rtl; color: #111; }
  h1 { text-align: center; color: #7a5c00; border-bottom: 2px solid #c9a227; padding-bottom: 8px; }
  h2 { color: #7a5c00; margin-top: 24px; page-break-after: avoid; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0; }
  .card { background: #faf5e4; border: 1px solid #e8d896; border-radius: 6px; padding: 10px; text-align: center; }
  .card .lbl { font-size: 11px; color: #666; }
  .card .val { font-size: 16px; font-weight: bold; color: #7a5c00; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; page-break-inside: auto; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: right; }
  th { background: #f0e6c8; }
  .learned { background: #e6f4ea; }
  .print-btn { position: fixed; top: 10px; left: 10px; padding: 8px 16px; background: #7a5c00; color: #fff; border: 0; border-radius: 6px; cursor: pointer; font-size: 14px; }
  @media print { .print-btn { display: none; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">🖨️ שמור כ-PDF / הדפס</button>
<h1>לוח לימוד ש"ס — ${scopeTitle(opts.scope)}</h1>
${opts.content.summary ? `<div class="summary">
  <div class="card"><div class="lbl">סה"כ עמודים</div><div class="val">${summary.total.toLocaleString("he-IL")}</div></div>
  <div class="card"><div class="lbl">נלמדו</div><div class="val">${summary.learned.toLocaleString("he-IL")} (${summary.pct}%)</div></div>
  <div class="card"><div class="lbl">נשארו</div><div class="val">${summary.remaining.toLocaleString("he-IL")}</div></div>
  <div class="card"><div class="lbl">סך חזרות</div><div class="val">${summary.reps.toLocaleString("he-IL")}</div></div>
</div>` : ""}
${Array.from(byMasechta.entries()).map(([m, mRows]) => `
  <h2>מסכת ${m}</h2>
  <table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
  <tbody>${mRows.map((r) => {
    const tds = [`<td>${r.dafHeb}</td>`, `<td>${r.amudHeb}</td>`];
    if (opts.content.status) tds.push(`<td>${r.status}</td>`, `<td>${r.reps || ""}</td>`);
    if (opts.content.lastDate) tds.push(`<td>-</td>`);
    return `<tr class="${r.reps > 0 ? "learned" : ""}">${tds.join("")}</tr>`;
  }).join("")}</tbody></table>
`).join("")}
<script>setTimeout(function(){ window.print(); }, 400);</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) {
    // Fallback: download as HTML
    saveAs(new Blob([html], { type: "text/html;charset=utf-8" }), `${fileBase(opts.scope)}.html`);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ============ Main ============
export async function exportShas(opts: ExportOptions): Promise<{ rowCount: number }> {
  const rows = buildRows(opts);
  switch (opts.format) {
    case "xlsx": exportXlsx(opts, rows); break;
    case "csv": exportCsv(opts, rows); break;
    case "json": exportJson(opts, rows); break;
    case "docx": await exportDocx(opts, rows); break;
    case "pdf": exportPdf(opts, rows); break;
  }
  return { rowCount: rows.length };
}

export const EXPORT_SEDARIM = SEDARIM;
export const EXPORT_MASECHTOT = SHAS_BAVLI.map((m) => ({ name: m.name, seder: m.seder }));
