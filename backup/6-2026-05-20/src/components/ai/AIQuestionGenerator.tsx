import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, Loader2, Sparkles, Trash2, Upload, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useStudy } from "@/lib/study/store";
import { SHAS_BAVLI } from "@/lib/study/shasData";
import { fetchSefariaText, toHebrewNumeral, type TextMode } from "@/lib/ai/sefariaClient";
import { generateQuestionsWithClaude, type GeneratedQuestion } from "@/lib/ai/claudeClient";
import type { Category, MultipleChoiceCard } from "@/lib/study/types";

const AMUD_LABELS = { a: "עמוד א", b: "עמוד ב" };
const TEXT_MODE_LABELS: Record<TextMode, string> = {
  aramaic: "ארמי מקורי",
  english: "תרגום אנגלי",
  both: "שניהם",
};

export function AIQuestionGenerator() {
  const { state, setUiPref, addCategory, bulkAddCards } = useStudy();
  const apiKey = state.uiPrefs?.anthropicApiKey ?? "";

  // Form state
  const [masechet, setMasechet] = useState("יומא");
  const [daf, setDaf] = useState(2);
  const [amud, setAmud] = useState<"a" | "b">("a");
  const [textMode, setTextMode] = useState<TextMode>("both");

  // Loaded text
  const [loadedText, setLoadedText] = useState<{ aramaic: string; english: string; heRef: string } | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);

  // Generated questions
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Import
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

  useEffect(() => { document.title = "יצירת שאלות AI | מעקב למידה"; }, []);

  // Reset on masechet/daf/amud change
  useEffect(() => {
    setLoadedText(null);
    setQuestions([]);
    setImportDone(false);
    setTextError(null);
    setGenError(null);
  }, [masechet, daf, amud]);

  const selectedMasechet = SHAS_BAVLI.find((m) => m.name === masechet);
  const maxDaf = selectedMasechet?.pages ?? 120;

  const textForClaude = loadedText
    ? textMode === "aramaic"
      ? loadedText.aramaic
      : textMode === "english"
        ? loadedText.english
        : `${loadedText.aramaic}\n\n[תרגום]\n${loadedText.english}`
    : "";

  async function loadText() {
    setTextLoading(true);
    setTextError(null);
    setLoadedText(null);
    setQuestions([]);
    setImportDone(false);
    try {
      const result = await fetchSefariaText(masechet, daf, amud);
      setLoadedText({ aramaic: result.aramaic, english: result.english, heRef: result.heRef });
      setShowText(true);
    } catch (e) {
      setTextError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setTextLoading(false);
    }
  }

  async function generateQuestions() {
    if (!apiKey) { setGenError("יש להגדיר מפתח API בהגדרות"); return; }
    if (!textForClaude.trim()) { setGenError("יש לטעון תחילה את הטקסט"); return; }
    setGenerating(true);
    setGenError(null);
    setImportDone(false);
    try {
      const qs = await generateQuestionsWithClaude(apiKey, masechet, daf, amud, textForClaude);
      setQuestions(qs);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setGenerating(false);
    }
  }

  function removeQuestion(idx: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  }

  function findOrCreate(name: string, parentId: string | null): Category {
    const existing = (state.categories ?? []).find(
      (c) => c.name === name && c.parentId === parentId,
    );
    if (existing) return existing;
    return addCategory(name, parentId);
  }

  async function importToDb() {
    if (!questions.length) return;
    setImporting(true);
    try {
      // Build category hierarchy: תלמוד בבלי → masechet → daf → amud
      const root = findOrCreate("תלמוד בבלי", null);
      const masechetCat = findOrCreate(masechet, root.id);
      const dafLabel = toHebrewNumeral(daf);
      const dafCat = findOrCreate(dafLabel, masechetCat.id);
      const amudLabel = amud === "a" ? "א" : "ב";
      const amudCat = findOrCreate(amudLabel, dafCat.id);

      const cards = questions.map((q): Omit<MultipleChoiceCard, "id" | "createdAt" | "srs" | "stats"> => ({
        type: "multiple",
        deckId: null,
        question: q.question,
        options: q.options,
        correctIndices: [q.correctIndex],
        explanation: q.explanation,
        tags: [`cat:${amudCat.id}`, "source:ai"],
        masechta: masechet,
        daf: daf,
        amud: amud === "a" ? 1 : 2,
      }));

      bulkAddCards(cards);
      setImportDone(true);
      setQuestions([]);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto" dir="rtl">
      <header className="flex items-center gap-2">
        <span className="gold-icon-circle"><Sparkles className="h-4 w-4" /></span>
        <h2 className="font-display text-2xl font-bold text-foreground">יצירת שאלות AI</h2>
      </header>

      {/* API key status */}
      {!apiKey && (
        <Card className="gold-frame p-3 flex items-center gap-3 bg-red-500/5 border-red-400/40">
          <span className="text-sm text-red-400">
            ⚠ מפתח API לא מוגדר —{" "}
            <button
              className="underline text-red-300 hover:text-red-200"
              onClick={() => {
                const key = window.prompt("הכנס Anthropic API key:");
                if (key?.trim()) setUiPref("anthropicApiKey", key.trim());
              }}
            >
              לחץ להגדרה מהירה
            </button>
            {" "}או עבור להגדרות → מפתחות API
          </span>
        </Card>
      )}
      {apiKey && (
        <Card className="gold-frame p-3 flex items-center gap-2 bg-green-500/5 border-green-400/30">
          <CheckCircle2 className="h-4 w-4 text-green-400" />
          <span className="text-sm text-green-400">מפתח Anthropic מחובר</span>
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto text-xs text-muted-foreground h-6 px-2"
            onClick={() => {
              const key = window.prompt("עדכן Anthropic API key:", apiKey);
              if (key !== null) setUiPref("anthropicApiKey", key.trim());
            }}
          >
            עדכן
          </Button>
        </Card>
      )}

      {/* Selection form */}
      <Card className="gold-frame p-4 space-y-4">
        <p className="text-sm font-semibold text-foreground">בחירת מקטע</p>

        {/* Masechet dropdown */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">מסכת</label>
          <div className="relative">
            <select
              value={masechet}
              onChange={(e) => setMasechet(e.target.value)}
              className="w-full appearance-none rounded-lg border border-gold/40 bg-background px-3 py-2 text-sm text-foreground pr-8 focus:outline-none focus:border-gold"
            >
              {SHAS_BAVLI.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({m.seder})
                </option>
              ))}
            </select>
            <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Daf + Amud */}
        <div className="flex gap-3">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-muted-foreground">דף (מ-2 עד {maxDaf + 1})</label>
            <input
              type="number"
              min={2}
              max={maxDaf + 1}
              value={daf}
              onChange={(e) => setDaf(Math.max(2, Math.min(maxDaf + 1, Number(e.target.value))))}
              className="rounded-lg border border-gold/40 bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">עמוד</label>
            <div className="flex gap-1">
              {(["a", "b"] as const).map((side) => (
                <button
                  key={side}
                  onClick={() => setAmud(side)}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium border transition-colors",
                    amud === side
                      ? "bg-gradient-navy text-primary-foreground border-gold/60"
                      : "border-gold/30 text-muted-foreground hover:border-gold/60",
                  )}
                >
                  {side === "a" ? "א" : "ב"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Text mode */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">מקור טקסט לשליחה ל-AI</label>
          <div className="flex gap-1 flex-wrap">
            {(Object.keys(TEXT_MODE_LABELS) as TextMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setTextMode(mode)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  textMode === mode
                    ? "bg-gradient-navy text-primary-foreground border-gold/60"
                    : "border-gold/30 text-muted-foreground hover:border-gold/60",
                )}
              >
                {TEXT_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        {/* Load text button */}
        <Button
          onClick={loadText}
          disabled={textLoading}
          variant="outline"
          className="border-gold/50 w-full gap-2"
        >
          {textLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
          {textLoading ? "טוען מ-Sefaria..." : `טען טקסט — ${masechet} דף ${daf} ${AMUD_LABELS[amud]}`}
        </Button>
        {textError && <p className="text-xs text-red-400">{textError}</p>}
      </Card>

      {/* Text preview */}
      {loadedText && (
        <Card className="gold-frame p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">{loadedText.heRef}</p>
            <button
              onClick={() => setShowText((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showText ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showText ? "הסתר" : "הצג"}
            </button>
          </div>

          {showText && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(textMode === "aramaic" || textMode === "both") && loadedText.aramaic && (
                <div>
                  {textMode === "both" && (
                    <p className="text-[10px] text-muted-foreground mb-1">ארמי מקורי</p>
                  )}
                  <p className="text-xs leading-relaxed text-foreground/80 font-serif">
                    {loadedText.aramaic.slice(0, 800)}{loadedText.aramaic.length > 800 ? "..." : ""}
                  </p>
                </div>
              )}
              {(textMode === "english" || textMode === "both") && loadedText.english && (
                <div>
                  {textMode === "both" && (
                    <p className="text-[10px] text-muted-foreground mb-1">תרגום אנגלי</p>
                  )}
                  <p className="text-xs leading-relaxed text-foreground/80 dir-ltr text-left">
                    {loadedText.english.slice(0, 800)}{loadedText.english.length > 800 ? "..." : ""}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Generate button */}
          <Button
            onClick={generateQuestions}
            disabled={generating || !apiKey}
            className="w-full gap-2 bg-gradient-navy text-primary-foreground mt-2"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generating ? "מייצר שאלות עם Claude..." : "צור 10 שאלות AI"}
          </Button>
          {genError && <p className="text-xs text-red-400">{genError}</p>}
        </Card>
      )}

      {/* Generated questions */}
      {questions.length > 0 && (
        <Card className="gold-frame p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">
              {questions.length} שאלות נוצרו
              <span className="text-xs text-muted-foreground mr-2">
                — {masechet} דף {daf} {AMUD_LABELS[amud]}
              </span>
            </p>
            <Badge
              variant="outline"
              className="text-[10px] border-red-400/50 text-red-400"
              style={{ boxShadow: "0 0 4px 1px #f8717166" }}
            >
              source:ai
            </Badge>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {questions.map((q, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-gold/20 bg-card p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground flex-1">
                    <span className="text-muted-foreground text-xs ml-1">{idx + 1}.</span>
                    {q.question}
                  </p>
                  <button
                    onClick={() => removeQuestion(idx)}
                    className="text-muted-foreground hover:text-red-400 transition-colors shrink-0 mt-0.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {q.options.map((opt, oi) => (
                    <div
                      key={oi}
                      className={cn(
                        "rounded-lg px-2.5 py-1.5 text-xs border",
                        oi === q.correctIndex
                          ? "border-green-400/50 bg-green-500/10 text-green-400"
                          : "border-gold/20 text-muted-foreground",
                      )}
                    >
                      <span className="font-bold ml-1">
                        {["א", "ב", "ג", "ד"][oi]}.
                      </span>
                      {opt}
                    </div>
                  ))}
                </div>
                {q.explanation && (
                  <p className="text-[11px] text-muted-foreground border-t border-gold/20 pt-1.5">
                    💡 {q.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Import button */}
          <Button
            onClick={importToDb}
            disabled={importing}
            className="w-full gap-2 bg-gradient-navy text-primary-foreground"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {importing
              ? "מייבא לDB..."
              : `ייבא ${questions.length} שאלות לקטגוריה: תלמוד בבלי → ${masechet} → ${toHebrewNumeral(daf)} → ${amud === "a" ? "א" : "ב"}`}
          </Button>
        </Card>
      )}

      {/* Success */}
      {importDone && (
        <Card className="gold-frame p-4 flex items-center gap-3 bg-green-500/5 border-green-400/30">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          <div>
            <p className="text-sm font-semibold text-green-400">הייבוא הצליח!</p>
            <p className="text-xs text-muted-foreground">
              השאלות נשמרו תחת: תלמוד בבלי → {masechet} → {toHebrewNumeral(daf)} → {amud === "a" ? "א" : "ב"}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
