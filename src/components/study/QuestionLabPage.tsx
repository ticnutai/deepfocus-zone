import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FlaskConical,
  Upload,
  ClipboardCheck,
  CheckSquare,
  Square,
} from "lucide-react";
import { useStudy } from "@/lib/study/store";
import { toHebrewNum } from "@/lib/study/shasFormat";
import type { Card as StudyCard } from "@/lib/study/types";

type SamplePair = {
  key: string;
  question: string;
  answer: string;
};

type PilotResult = {
  file: string;
  masechet: string;
  range_label: string;
  total_questions: number;
  total_answers: number;
  matched_pairs: number;
  unmatched_question_keys: string[];
  unmatched_answer_keys: string[];
  pairs?: SamplePair[];
  sample_pairs: SamplePair[];
};

type PilotPayload = {
  summary: {
    files: number;
    total_questions: number;
    total_answers: number;
    total_matched_pairs: number;
  };
  results: PilotResult[];
};

type ExtractedQuestionRow = {
  source_id?: string;
  source_name?: string;
  source_type?: string;
  source_url?: string;
  question_text: string;
  options?: string[];
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  option_e?: string;
  canonical_book?: string | null;
  chapter?: number | null;
  verse?: number | null;
  verse_end?: number | null;
  reference_confidence?: number;
  reference_strategy?: string | null;
};

type ExtractedQuestionsPayload = {
  kind: "neviim_extracted";
  rows: ExtractedQuestionRow[];
};

type ReportIndexEntry = {
  id: string;
  label: string;
  file: string;
  updated_at?: string;
};

type ReportIndex = {
  version: number;
  generated_at?: string;
  reports: ReportIndexEntry[];
};

type ImportRow = {
  masechet: string;
  rangeLabel: string;
  question: string;
  answer: string;
  options?: string[];
  isNeviim?: boolean;
  canonicalBook?: string;
  chapter?: number;
  verse?: number;
  verseEnd?: number;
  confidence?: number;
};

const INDEX_URL = "/data/question-lab-index.json";
const FALLBACK_REPORT_URL = "/data/pilot_docx_qna_report.json";
const ROOT_CATEGORY_NAME = "תלמוד בבלי";
const NEVIIM_ROOT_CATEGORY_NAME = "נביאים וכתובים - מאגר שאלות";

function isPilotPayload(x: unknown): x is PilotPayload {
  return (
    !!x &&
    typeof x === "object" &&
    "summary" in (x as Record<string, unknown>) &&
    "results" in (x as Record<string, unknown>)
  );
}

function toExtractedPayload(x: unknown): ExtractedQuestionsPayload | null {
  if (Array.isArray(x)) {
    return { kind: "neviim_extracted", rows: x as ExtractedQuestionRow[] };
  }
  if (
    x &&
    typeof x === "object" &&
    Array.isArray((x as { rows?: unknown[] }).rows)
  ) {
    return {
      kind: "neviim_extracted",
      rows: (x as { rows: ExtractedQuestionRow[] }).rows,
    };
  }
  return null;
}

function normalizeExtractedOptions(row: ExtractedQuestionRow): string[] {
  if (Array.isArray(row.options) && row.options.length) {
    return row.options.map((o) => o.trim()).filter(Boolean);
  }
  return [row.option_a, row.option_b, row.option_c, row.option_d, row.option_e]
    .map((o) => (o ?? "").trim())
    .filter(Boolean);
}

function neviimRowKey(row: ExtractedQuestionRow): string {
  const q = (row.question_text ?? "").replace(/\s+/g, " ").trim();
  const b = row.canonical_book ?? "";
  const c = row.chapter ?? "";
  const v = row.verse ?? "";
  return `${b}::${c}::${v}::${q}`;
}

function formatKodeshRef(
  book: string,
  chapter: number,
  verse: number,
  verseEnd?: number,
): string {
  const c = toHebrewNum(chapter) || String(chapter);
  const v = toHebrewNum(verse) || String(verse);
  const ve =
    verseEnd && verseEnd !== verse
      ? `-${toHebrewNum(verseEnd) || String(verseEnd)}`
      : "";
  return `${book} ${c}:${v}${ve}`;
}

export function QuestionLabPage() {
  const { state, addCategory, addCard } = useStudy();
  type AddCardInput = Omit<StudyCard, "id" | "createdAt" | "srs" | "stats">;
  const [index, setIndex] = useState<ReportIndex | null>(null);
  const [selectedReportFile, setSelectedReportFile] =
    useState<string>(FALLBACK_REPORT_URL);
  const [data, setData] = useState<
    PilotPayload | ExtractedQuestionsPayload | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dryRunSummary, setDryRunSummary] = useState<{
    rows: number;
    uniqueRows: number;
    newCards: number;
    duplicateCards: number;
    missingAnswers: number;
  } | null>(null);
  const [approvedMap, setApprovedMap] = useState<Record<string, boolean>>({});

  const load = async (reportFile?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(reportFile ?? selectedReportFile, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (isPilotPayload(json)) {
        setData(json);
        setApprovedMap({});
        return;
      }
      const extracted = toExtractedPayload(json);
      if (extracted) {
        setData(extracted);
        const initial: Record<string, boolean> = {};
        for (const r of extracted.rows) initial[neviimRowKey(r)] = false;
        setApprovedMap(initial);
        return;
      }
      throw new Error("Unsupported report format");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load report";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const loadIndex = async () => {
    try {
      const res = await fetch(INDEX_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ReportIndex;
      if (!json.reports?.length) throw new Error("No reports in index");
      setIndex(json);
      const first = json.reports[0].file;
      setSelectedReportFile(first);
      await load(first);
      return;
    } catch {
      setIndex(null);
      setSelectedReportFile(FALLBACK_REPORT_URL);
      await load(FALLBACK_REPORT_URL);
    }
  };

  useEffect(() => {
    void loadIndex();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadIndex();
    }, 30000);
    return () => window.clearInterval(id);
  }, []);

  const unmatchedTotal = useMemo(() => {
    if (!data || !isPilotPayload(data)) return 0;
    return data.results.reduce(
      (acc, r) =>
        acc + r.unmatched_question_keys.length + r.unmatched_answer_keys.length,
      0,
    );
  }, [data]);

  const pairsPreview = useMemo(() => {
    if (!data || !isPilotPayload(data))
      return [] as Array<
        SamplePair & { masechet: string; range_label: string }
      >;
    return data.results.flatMap((r) =>
      r.sample_pairs.map((p) => ({
        ...p,
        masechet: r.masechet,
        range_label: r.range_label,
      })),
    );
  }, [data]);

  const importRows = useMemo<ImportRow[]>(() => {
    if (!data) return [];

    if (!isPilotPayload(data)) {
      return data.rows
        .map((r) => {
          const options = normalizeExtractedOptions(r);
          const book = (r.canonical_book ?? "").trim();
          const ch = typeof r.chapter === "number" ? r.chapter : undefined;
          const vs = typeof r.verse === "number" ? r.verse : undefined;
          const ve = typeof r.verse_end === "number" ? r.verse_end : undefined;
          const refText =
            book && ch && vs
              ? formatKodeshRef(book, ch, vs, ve)
              : "מיקום לא מזוהה";

          return {
            masechet: "נביאים וכתובים",
            rangeLabel: refText,
            question: (r.question_text ?? "").trim(),
            answer: `מיקום: ${refText}`,
            options,
            isNeviim: true,
            canonicalBook: book || undefined,
            chapter: ch,
            verse: vs,
            verseEnd: ve,
            confidence: r.reference_confidence,
          } satisfies ImportRow;
        })
        .filter(
          (r) =>
            r.question &&
            !!r.canonicalBook &&
            typeof r.chapter === "number" &&
            typeof r.verse === "number",
        );
    }

    const rows: ImportRow[] = [];
    for (const r of data.results) {
      const sourcePairs = r.pairs && r.pairs.length ? r.pairs : r.sample_pairs;
      for (const p of sourcePairs) {
        rows.push({
          masechet: r.masechet,
          rangeLabel: r.range_label,
          question: p.question.trim(),
          answer: p.answer.trim(),
        });
      }
    }
    return rows;
  }, [data]);

  const runDryRun = () => {
    const candidateRows = !isPilotPayload(data)
      ? importRows.filter(
          (r) =>
            approvedMap[
              `${r.canonicalBook ?? ""}::${r.chapter ?? ""}::${r.verse ?? ""}::${r.question.replace(/\s+/g, " ").trim()}`
            ],
        )
      : importRows;

    const normalized = candidateRows.map((r) => ({
      ...r,
      key: `${r.masechet}::${r.rangeLabel}::${r.question.replace(/\s+/g, " ").trim()}`,
    }));
    const unique = new Map<string, ImportRow>();
    for (const row of normalized) {
      if (!unique.has(row.key)) unique.set(row.key, row);
    }
    const uniqueRows = [...unique.values()];
    const existing = new Set(
      state.cards.map((c) => {
        const q = (c.question ?? "").replace(/\s+/g, " ").trim();
        const tags = c.tags ?? [];
        const m =
          tags.find((t) => t.startsWith("cat:") && t.length > 4) ?? "cat:";
        return `${m}::${q}`;
      }),
    );

    let newCards = 0;
    let duplicateCards = 0;
    let missingAnswers = 0;
    for (const row of uniqueRows) {
      const tag = `cat:${row.rangeLabel}`;
      const key = `${tag}::${row.question.replace(/\s+/g, " ").trim()}`;
      if (!row.answer) missingAnswers++;
      if (existing.has(key)) duplicateCards++;
      else newCards++;
    }

    setDryRunSummary({
      rows: candidateRows.length,
      uniqueRows: uniqueRows.length,
      newCards,
      duplicateCards,
      missingAnswers,
    });
    toast.success("dry-run הושלם");
  };

  const commitImport = () => {
    if (!dryRunSummary) {
      toast.error("יש לבצע Dry-run לפני Commit");
      return;
    }
    setImporting(true);
    try {
      const categories = [...(state.categories ?? [])];
      const keyOf = (name: string, parentId: string | null) =>
        `${parentId ?? "root"}::${name}`;
      const byKey = new Map<string, string>();
      for (const c of categories) byKey.set(keyOf(c.name, c.parentId), c.id);

      const ensureCategory = (
        name: string,
        parentId: string | null,
      ): string => {
        const k = keyOf(name, parentId);
        const existing = byKey.get(k);
        if (existing) return existing;
        const created = addCategory(name, parentId);
        byKey.set(k, created.id);
        return created.id;
      };

      const rootId = ensureCategory(
        isPilotPayload(data) ? ROOT_CATEGORY_NAME : NEVIIM_ROOT_CATEGORY_NAME,
        null,
      );
      const existingCardKeys = new Set(
        state.cards.map(
          (c) =>
            `${(c.tags ?? []).join("|")}::${(c.question ?? "").replace(/\s+/g, " ").trim()}`,
        ),
      );

      let inserted = 0;
      const rowsToCommit = !isPilotPayload(data)
        ? importRows.filter(
            (r) =>
              approvedMap[
                `${r.canonicalBook ?? ""}::${r.chapter ?? ""}::${r.verse ?? ""}::${r.question.replace(/\s+/g, " ").trim()}`
              ],
          )
        : importRows;

      for (const row of rowsToCommit) {
        if (!row.question || !row.answer) continue;
        ensureCategory(row.masechet, rootId);
        ensureCategory(
          row.rangeLabel,
          byKey.get(keyOf(row.masechet, rootId)) ?? null,
        );

        const rootName = isPilotPayload(data)
          ? ROOT_CATEGORY_NAME
          : NEVIIM_ROOT_CATEGORY_NAME;
        const tags = [
          `cat:${rootName}`,
          `cat:${row.masechet}`,
          `cat:${row.rangeLabel}`,
        ];

        if (row.isNeviim && row.canonicalBook) {
          tags.push(`cat:${row.canonicalBook}`);
          const chapterHeb = row.chapter
            ? toHebrewNum(row.chapter) || String(row.chapter)
            : "";
          const verseHeb = row.verse
            ? toHebrewNum(row.verse) || String(row.verse)
            : "";
          if (chapterHeb && verseHeb) {
            tags.push(`ref:${row.canonicalBook}.${chapterHeb}:${verseHeb}`);
          }
        }

        const cardKey = `${tags.join("|")}::${row.question.replace(/\s+/g, " ").trim()}`;
        if (existingCardKeys.has(cardKey)) continue;
        existingCardKeys.add(cardKey);

        if (row.isNeviim && row.options && row.options.length >= 2) {
          addCard({
            deckId: null,
            type: "combo",
            question: row.question,
            answer: row.answer,
            options: row.options,
            tags,
          } as AddCardInput);
        } else {
          addCard({
            deckId: null,
            type: "flashcard",
            question: row.question,
            answer: row.answer,
            tags,
          } as AddCardInput);
        }
        inserted++;
      }

      toast.success(`בוצעה הכנסה למאגר: ${inserted} כרטיסים`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Commit failed";
      toast.error(`שגיאה בהכנסה: ${message}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div dir="rtl" className="space-y-4 p-2 sm:p-4">
      <Card className="gold-frame p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xl font-display font-bold">
              <FlaskConical className="h-5 w-5 text-gold" />
              מעבדת יצירה וניתוח שאלות
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              מרכז בדיקה לפני הכנסה למאגר: חילוץ, התאמה שאלה-תשובה, ואיכות
              נתונים.
            </p>
          </div>
          <Button
            variant="outline"
            className="border-gold/50"
            onClick={() => void loadIndex()}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4" />
            רענון דוחות
          </Button>
        </div>
      </Card>

      <Card className="gold-frame p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <div className="text-xs text-muted-foreground mb-1">דוח פעיל</div>
            <Select
              value={selectedReportFile}
              onValueChange={(v) => {
                setSelectedReportFile(v);
                void load(v);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="בחר דוח" />
              </SelectTrigger>
              <SelectContent>
                {(index?.reports?.length
                  ? index.reports
                  : [{ id: "pilot", label: "pilot", file: FALLBACK_REPORT_URL }]
                ).map((r) => (
                  <SelectItem key={r.id} value={r.file}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            {!isPilotPayload(data) && data && (
              <Button
                variant="outline"
                className="flex-1 border-gold/50"
                onClick={() => {
                  const next: Record<string, boolean> = {};
                  for (const r of data.rows) next[neviimRowKey(r)] = true;
                  setApprovedMap(next);
                  toast.success("סומנו כל השאלות לאישור");
                }}
                disabled={loading}
              >
                <CheckSquare className="h-4 w-4" />
                אשר הכל
              </Button>
            )}
            <Button
              variant="outline"
              className="flex-1 border-gold/50"
              onClick={runDryRun}
              disabled={!data || loading}
            >
              <ClipboardCheck className="h-4 w-4" />
              Dry-run
            </Button>
            <Button
              className="flex-1 bg-gradient-navy text-primary-foreground"
              onClick={commitImport}
              disabled={!data || loading || importing || !dryRunSummary}
            >
              <Upload className="h-4 w-4" />
              Commit
            </Button>
          </div>
        </div>
      </Card>

      {dryRunSummary && (
        <Card className="gold-frame p-4">
          <div className="text-sm font-semibold mb-2">סיכום Dry-run</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <div className="rounded-md border border-gold/30 p-2">
              שורות: <b>{dryRunSummary.rows}</b>
            </div>
            <div className="rounded-md border border-gold/30 p-2">
              ייחודיות: <b>{dryRunSummary.uniqueRows}</b>
            </div>
            <div className="rounded-md border border-gold/30 p-2">
              חדשים: <b>{dryRunSummary.newCards}</b>
            </div>
            <div className="rounded-md border border-gold/30 p-2">
              כפולים: <b>{dryRunSummary.duplicateCards}</b>
            </div>
            <div className="rounded-md border border-gold/30 p-2">
              ללא תשובה: <b>{dryRunSummary.missingAnswers}</b>
            </div>
          </div>
        </Card>
      )}

      {loading && (
        <Card className="gold-frame p-5 text-sm text-muted-foreground">
          טוען דוח חילוץ...
        </Card>
      )}

      {!loading && error && (
        <Card className="gold-frame p-5 text-sm text-destructive">
          שגיאה בטעינת הדוח: {error}
          <div className="text-muted-foreground mt-2">
            ודא שקיים קובץ דוח תחת data/reports או דוח פיילוט.
          </div>
        </Card>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card className="gold-frame p-4">
              <div className="text-xs text-muted-foreground">מסמכים</div>
              <div className="text-2xl font-bold">
                {isPilotPayload(data) ? data.summary.files : 1}
              </div>
            </Card>
            <Card className="gold-frame p-4">
              <div className="text-xs text-muted-foreground">שאלות שחולצו</div>
              <div className="text-2xl font-bold">
                {isPilotPayload(data)
                  ? data.summary.total_questions
                  : data.rows.length}
              </div>
            </Card>
            <Card className="gold-frame p-4">
              <div className="text-xs text-muted-foreground">מוכנות לאישור</div>
              <div className="text-2xl font-bold">
                {isPilotPayload(data)
                  ? data.summary.total_answers
                  : data.rows.filter((r) => approvedMap[neviimRowKey(r)])
                      .length}
              </div>
            </Card>
            <Card className="gold-frame p-4">
              <div className="text-xs text-muted-foreground">
                התאמות מוצלחות
              </div>
              <div className="text-2xl font-bold">
                {isPilotPayload(data)
                  ? data.summary.total_matched_pairs
                  : data.rows.filter(
                      (r) => !!r.canonical_book && !!r.chapter && !!r.verse,
                    ).length}
              </div>
            </Card>
          </div>

          <Card className="gold-frame p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {unmatchedTotal === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              )}
              <span className="font-medium">
                {unmatchedTotal === 0
                  ? "לא נמצאו חריגות בהתאמת שאלה-תשובה בדוח הנוכחי"
                  : `נמצאו ${unmatchedTotal} חריגות להתייחסות`}
              </span>
            </div>
            <Badge variant="secondary">pilot</Badge>
          </Card>

          {!isPilotPayload(data) && (
            <Card className="gold-frame p-4 space-y-3">
              <div className="text-sm font-semibold">
                אישור שאלות לפני העברה לקטגוריות
              </div>
              <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                {data.rows.map((row, idx) => {
                  const key = neviimRowKey(row);
                  const checked = !!approvedMap[key];
                  const ref =
                    row.canonical_book && row.chapter && row.verse
                      ? formatKodeshRef(
                          row.canonical_book,
                          row.chapter,
                          row.verse,
                          row.verse_end ?? undefined,
                        )
                      : "מיקום לא מזוהה";
                  return (
                    <button
                      key={`${key}-${idx}`}
                      type="button"
                      className={`w-full text-right rounded-md border p-3 transition ${checked ? "border-emerald-500/50 bg-emerald-500/5" : "border-gold/30"}`}
                      onClick={() =>
                        setApprovedMap((prev) => ({ ...prev, [key]: !checked }))
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm leading-relaxed">
                          {row.question_text}
                        </div>
                        <div className="shrink-0 mt-0.5">
                          {checked ? (
                            <CheckSquare className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Square className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{ref}</Badge>
                        <Badge variant="outline">
                          בטחון: {(row.reference_confidence ?? 0).toFixed(2)}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {isPilotPayload(data) && (
            <Tabs defaultValue="by-file" className="w-full" dir="rtl">
              <TabsList className="w-full justify-start gap-2 flex-wrap h-auto bg-transparent p-0">
                <TabsTrigger value="by-file" className="border border-gold/40">
                  לפי מסמך
                </TabsTrigger>
                <TabsTrigger value="pairs" className="border border-gold/40">
                  תצוגת שאלות/תשובות
                </TabsTrigger>
              </TabsList>

              <TabsContent value="by-file" className="space-y-3 mt-3">
                {data.results.map((r) => (
                  <Card key={r.file} className="gold-frame p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold">
                          {r.masechet} | {r.range_label}
                        </div>
                        <div className="text-xs text-muted-foreground break-all">
                          {r.file}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline">
                          שאלות: {r.total_questions}
                        </Badge>
                        <Badge variant="outline">
                          תשובות: {r.total_answers}
                        </Badge>
                        <Badge variant="outline">
                          התאמות: {r.matched_pairs}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                ))}
              </TabsContent>

              <TabsContent value="pairs" className="space-y-3 mt-3">
                {pairsPreview.map((p, idx) => (
                  <Card
                    key={`${p.masechet}-${p.range_label}-${p.key}-${idx}`}
                    className="gold-frame p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {p.masechet} | {p.range_label}
                      </span>
                      <Badge variant="outline">אות {p.key}</Badge>
                    </div>
                    <div className="text-sm">
                      <span className="font-semibold">שאלה:</span> {p.question}
                    </div>
                    <div className="text-sm">
                      <span className="font-semibold">תשובה:</span> {p.answer}
                    </div>
                  </Card>
                ))}
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
