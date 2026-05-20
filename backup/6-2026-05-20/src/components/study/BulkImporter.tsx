import { useState, useRef, useMemo, useEffect, useCallback, type ClipboardEvent, type KeyboardEvent } from "react";
import {
  Upload, Sparkles, AlertCircle, CheckCircle2, FileText, Eye, Pencil,
  Plus, X, GripVertical, Shuffle, Tag as TagIcon, CheckSquare, Square, Keyboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogFooter } from "@/components/ui/dialog";
import { useStudy } from "@/lib/study/store";
import { parseBulk, BULK_EXAMPLES, type BulkMode } from "@/lib/study/bulkParser";
import { cn } from "@/lib/utils";

// ── Structured model for the visual editor (multiple-choice mode) ─────────
type EditorOption = { id: string; text: string; correct: boolean };
type EditorBlock = {
  id: string;
  question: string;
  options: EditorOption[];
  tags: string[];
  shuffle: boolean;
  multiCorrect: boolean;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const newOption = (text = "", correct = false): EditorOption => ({ id: uid(), text, correct });
const newBlock = (): EditorBlock => ({
  id: uid(),
  question: "",
  options: [newOption(), newOption()],
  tags: [],
  shuffle: false,
  multiCorrect: false,
});

// ── Serialization between text and structured blocks ──────────────────────
function blocksToText(blocks: EditorBlock[]): string {
  return blocks
    .map((b) => {
      const tagPart = b.tags.length ? ` ${b.tags.map((t) => `#${t}`).join(" ")}` : "";
      const shufflePart = b.shuffle ? " #shuffle" : "";
      const lines: string[] = [`${b.question}${tagPart}${shufflePart}`.trim()];
      b.options.forEach((o) => {
        lines.push(o.correct ? `* ${o.text}` : o.text);
      });
      return lines.join("\n");
    })
    .join("\n\n");
}

function textToBlocks(text: string): EditorBlock[] {
  const blocks: EditorBlock[] = [];
  const rawBlocks = text.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
  rawBlocks.forEach((block) => {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    let questionLine = lines[0];
    const tags: string[] = [];
    let shuffle = false;
    questionLine = questionLine.replace(/#([^\s#]+)/g, (_, t: string) => {
      if (t.toLowerCase() === "shuffle") { shuffle = true; return ""; }
      tags.push(t);
      return "";
    }).trim();
    const options: EditorOption[] = [];
    lines.slice(1).forEach((raw) => {
      let opt = raw;
      opt = opt.replace(/^([0-9]+|[a-zA-Zא-ת])[.)]\s+/, "").replace(/^[-•]\s+(?!\*)/, "");
      let correct = false;
      if (/^\*+/.test(opt)) { correct = true; opt = opt.replace(/^\*+\s*/, ""); }
      else if (/^\[(x|X|v|V|✓)\]/.test(opt)) { correct = true; opt = opt.replace(/^\[[xXvV✓]\]\s*/, ""); }
      options.push(newOption(opt.trim(), correct));
    });
    const correctCount = options.filter((o) => o.correct).length;
    blocks.push({
      id: uid(),
      question: questionLine,
      options: options.length ? options : [newOption(), newOption()],
      tags,
      shuffle,
      multiCorrect: correctCount > 1,
    });
  });
  return blocks;
}

// ── Smart paste: detect common formats and convert to canonical ───────────
function smartPaste(raw: string, mode: BulkMode): string {
  const lines = raw.split(/\r?\n/);
  // Quizlet / TSV → flashcard format (term \t definition)
  if (mode === "flashcard" && lines.some((l) => /\t/.test(l))) {
    return lines
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/\t+/, " | "))
      .join("\n");
  }
  // Numbered/bulleted multi-choice list inside one paste → multiple
  if (mode === "multiple") {
    // Convert "1) opt", "1. opt", "א." or "•" / "-" into raw option lines
    return lines
      .map((l) => l
        .replace(/^\s*([0-9]+|[a-zA-Zא-ת])[.)]\s+/, "")
        .replace(/^\s*[-•]\s+/, "")
      )
      .join("\n");
  }
  return raw;
}

const DRAFT_KEY = (deckId: string) => `bulk-importer-draft:${deckId}`;

interface DraftData {
  mode: BulkMode;
  text: string;
  blocks: EditorBlock[] | null;
  savedAt: number;
}

export function BulkImporter({ deckId, onClose }: { deckId: string; onClose?: () => void }) {
  const { addCard } = useStudy();
  const [mode, setMode] = useState<BulkMode>("flashcard");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ cards: number; errors: string[] } | null>(null);
  const [visualMode, setVisualMode] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [dragInfo, setDragInfo] = useState<
    | { kind: "block"; blockId: string }
    | { kind: "option"; blockId: string; optionId: string }
    | null
  >(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Draft restore on mount ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY(deckId));
      if (!raw) return;
      const draft = JSON.parse(raw) as DraftData;
      if (!draft || typeof draft !== "object") return;
      if (draft.mode) setMode(draft.mode);
      if (typeof draft.text === "string") setText(draft.text);
      if (Array.isArray(draft.blocks)) setBlocks(draft.blocks);
      setDraftRestored(true);
    } catch { /* ignore */ }
  }, [deckId]);

  // ── Auto-save draft (debounced) ──
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const draft: DraftData = {
          mode,
          text,
          blocks: mode === "multiple" && visualMode ? blocks : null,
          savedAt: Date.now(),
        };
        localStorage.setItem(DRAFT_KEY(deckId), JSON.stringify(draft));
      } catch { /* ignore */ }
    }, 600);
    return () => clearTimeout(t);
  }, [deckId, mode, text, blocks, visualMode]);

  // ── Sync blocks ↔ text when entering / leaving visual mode ──
  const enterVisual = useCallback(() => {
    setBlocks(textToBlocks(text || ""));
    setVisualMode(true);
  }, [text]);

  const leaveVisual = useCallback(() => {
    setText(blocksToText(blocks));
    setVisualMode(false);
  }, [blocks]);

  // When mode changes to "multiple", parse current text into blocks once.
  useEffect(() => {
    if (mode === "multiple" && visualMode) {
      setBlocks((prev) => (prev.length ? prev : textToBlocks(text || "")));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Keep text in sync from blocks when in visual mode (so import / preview always work)
  useEffect(() => {
    if (mode === "multiple" && visualMode) {
      setText(blocksToText(blocks));
      setPreview(null);
    }
  }, [blocks, mode, visualMode]);

  // ── Block / option mutators ──
  const updateBlock = (blockId: string, fn: (b: EditorBlock) => EditorBlock) =>
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? fn(b) : b)));

  const addBlock = () => {
    const b = newBlock();
    setBlocks((prev) => [...prev, b]);
    setFocusedBlockId(b.id);
  };
  const removeBlock = (blockId: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId));
    if (focusedBlockId === blockId) setFocusedBlockId(null);
  };
  const addOption = (blockId: string) =>
    updateBlock(blockId, (b) => ({ ...b, options: [...b.options, newOption()] }));
  const removeOption = (blockId: string, optionId: string) =>
    updateBlock(blockId, (b) => ({ ...b, options: b.options.filter((o) => o.id !== optionId) }));
  const setOptionText = (blockId: string, optionId: string, value: string) =>
    updateBlock(blockId, (b) => ({
      ...b,
      options: b.options.map((o) => (o.id === optionId ? { ...o, text: value } : o)),
    }));
  const toggleCorrect = (blockId: string, optionId: string) =>
    updateBlock(blockId, (b) => {
      if (b.multiCorrect) {
        return { ...b, options: b.options.map((o) => (o.id === optionId ? { ...o, correct: !o.correct } : o)) };
      }
      return { ...b, options: b.options.map((o) => ({ ...o, correct: o.id === optionId })) };
    });
  const toggleMultiCorrect = (blockId: string) =>
    updateBlock(blockId, (b) => {
      const next = !b.multiCorrect;
      if (!next) {
        // Collapsing to single — keep only the first correct
        let kept = false;
        return {
          ...b,
          multiCorrect: false,
          options: b.options.map((o) => {
            if (!o.correct) return o;
            if (kept) return { ...o, correct: false };
            kept = true;
            return o;
          }),
        };
      }
      return { ...b, multiCorrect: true };
    });
  const toggleShuffle = (blockId: string) =>
    updateBlock(blockId, (b) => ({ ...b, shuffle: !b.shuffle }));
  const setQuestion = (blockId: string, value: string) =>
    updateBlock(blockId, (b) => ({ ...b, question: value }));
  const addTag = (blockId: string, tag: string) => {
    const t = tag.trim().replace(/^#/, "");
    if (!t) return;
    updateBlock(blockId, (b) => (b.tags.includes(t) ? b : { ...b, tags: [...b.tags, t] }));
    setTagInputs((p) => ({ ...p, [blockId]: "" }));
  };
  const removeTag = (blockId: string, tag: string) =>
    updateBlock(blockId, (b) => ({ ...b, tags: b.tags.filter((t) => t !== tag) }));

  // ── Drag & drop ──
  const onDragStart = (e: React.DragEvent, info: NonNullable<typeof dragInfo>) => {
    setDragInfo(info);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", info.kind);
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const onDropOnBlock = (targetBlockId: string) => {
    if (!dragInfo || dragInfo.kind !== "block" || dragInfo.blockId === targetBlockId) { setDragInfo(null); return; }
    setBlocks((prev) => {
      const fromIdx = prev.findIndex((b) => b.id === dragInfo.blockId);
      const toIdx = prev.findIndex((b) => b.id === targetBlockId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    setDragInfo(null);
  };
  const onDropOnOption = (blockId: string, targetOptionId: string) => {
    if (!dragInfo || dragInfo.kind !== "option" || dragInfo.blockId !== blockId || dragInfo.optionId === targetOptionId) {
      setDragInfo(null); return;
    }
    updateBlock(blockId, (b) => {
      const fromIdx = b.options.findIndex((o) => o.id === dragInfo.optionId);
      const toIdx = b.options.findIndex((o) => o.id === targetOptionId);
      if (fromIdx < 0 || toIdx < 0) return b;
      const opts = [...b.options];
      const [moved] = opts.splice(fromIdx, 1);
      opts.splice(toIdx, 0, moved);
      return { ...b, options: opts };
    });
    setDragInfo(null);
  };

  // ── Keyboard shortcuts (1-9 in focused block marks correct) ──
  useEffect(() => {
    const handler = (ev: globalThis.KeyboardEvent) => {
      if (!focusedBlockId || mode !== "multiple" || !visualMode) return;
      const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      const key = ev.key;
      if (!/^[1-9]$/.test(key)) return;
      const block = blocks.find((b) => b.id === focusedBlockId);
      if (!block) return;
      const idx = parseInt(key, 10) - 1;
      const opt = block.options[idx];
      if (!opt) return;
      ev.preventDefault();
      toggleCorrect(focusedBlockId, opt.id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusedBlockId, blocks, mode, visualMode]);

  // ── Smart paste handler (textarea) ──
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    const transformed = smartPaste(pasted, mode);
    if (transformed !== pasted) {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = text.slice(0, start) + transformed + text.slice(end);
      setText(next);
      setPreview(null);
    }
  };

  // ── Preview / Import ──
  const effectiveText = useMemo(
    () => (mode === "multiple" && visualMode ? blocksToText(blocks) : text),
    [mode, visualMode, blocks, text],
  );

  const handlePreview = () => {
    const { cards, errors } = parseBulk(effectiveText, mode);
    setPreview({ cards: cards.length, errors });
  };

  const handleImport = () => {
    const { cards, errors } = parseBulk(effectiveText, mode);
    cards.forEach((c) => {
      if (c.type === "flashcard") {
        addCard({ deckId, type: "flashcard", question: c.question, answer: c.answer!, tags: c.tags } as never);
      } else if (c.type === "multiple") {
        addCard({ deckId, type: "multiple", question: c.question, options: c.options!, correctIndices: c.correctIndices!, tags: c.tags } as never);
      } else {
        addCard({ deckId, type: "boolean", question: c.question, correct: c.correct!, explanation: c.explanation, tags: c.tags } as never);
      }
    });
    setPreview({ cards: cards.length, errors });
    if (errors.length === 0 && cards.length > 0) {
      setText(""); setBlocks([]);
      try { localStorage.removeItem(DRAFT_KEY(deckId)); } catch { /* ignore */ }
      onClose?.();
    }
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const v = String(e.target?.result || "");
      setText(v);
      if (mode === "multiple" && visualMode) setBlocks(textToBlocks(v));
    };
    reader.readAsText(file);
  };

  const insertExample = () => {
    setText(BULK_EXAMPLES[mode]);
    if (mode === "multiple" && visualMode) setBlocks(textToBlocks(BULK_EXAMPLES[mode]));
  };

  const clearDraft = () => {
    setText(""); setBlocks([]); setPreview(null);
    try { localStorage.removeItem(DRAFT_KEY(deckId)); } catch { /* ignore */ }
    setDraftRestored(false);
  };

  const modeDescriptions: Record<BulkMode, string> = {
    flashcard: "שורה לשאלה. פורמט: שאלה | תשובה",
    multiple: "בלוקים מופרדים בשורה ריקה. שורה ראשונה = שאלה, שאר השורות = אפשרויות. סמן נכונות עם * בהתחלה",
    boolean: "שורה לשאלה. פורמט: שאלה | נכון/לא נכון | הסבר (אופציונלי)",
  };

  // ── Live card preview (single block) ──
  const focusedBlock = blocks.find((b) => b.id === focusedBlockId);

  return (
    <div dir="rtl" className="space-y-4" ref={containerRef}>
      <div className="space-y-2">
        <Label className="block text-right">סוג השאלות לייבוא</Label>
        <Select value={mode} onValueChange={(v) => { setMode(v as BulkMode); setPreview(null); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="flashcard">כרטיסיות (שאלה | תשובה)</SelectItem>
            <SelectItem value="multiple">אמריקאיות (בלוקים)</SelectItem>
            <SelectItem value="boolean">נכון / לא נכון</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground text-right">{modeDescriptions[mode]}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={insertExample} className="border-2 border-gold/50">
          <Sparkles className="h-3 w-3" /> הדבק דוגמה
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="border-2 border-gold/50">
          <Upload className="h-3 w-3" /> טען מקובץ (.txt/.csv)
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,.md,text/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
        {mode === "multiple" && (
          <Button
            type="button" variant="outline" size="sm"
            onClick={() => setShowHelp((v) => !v)}
            className="border-2 border-gold/50"
            title="קיצורי מקלדת"
          >
            <Keyboard className="h-3 w-3" /> קיצורים
          </Button>
        )}
        {(text || blocks.length > 0) && (
          <Button type="button" variant="outline" size="sm" onClick={clearDraft} className="border-2 border-destructive/40 text-destructive">
            <X className="h-3 w-3" /> נקה טיוטה
          </Button>
        )}
        <span className="text-xs text-muted-foreground self-center ml-auto">
          טיפ: הוסף #תגית לתיוג שאלה · הדבקה חכמה מזהה Quizlet/רשימות ממוספרות
        </span>
      </div>

      {showHelp && mode === "multiple" && (
        <div className="rounded-lg border-2 border-gold/40 bg-secondary/20 p-3 text-xs space-y-1">
          <p className="font-semibold">קיצורי מקלדת (כשלא בתוך שדה טקסט):</p>
          <p>• <kbd className="px-1.5 py-0.5 rounded bg-card border">1</kbd>–<kbd className="px-1.5 py-0.5 rounded bg-card border">9</kbd> — סימון אפשרות בבלוק הממוקד כתשובה הנכונה</p>
          <p>• לחיצה על כותרת בלוק → הופך אותו לבלוק הממוקד</p>
          <p>• <kbd className="px-1.5 py-0.5 rounded bg-card border">Tab</kbd> בתוך שדה האפשרות האחרונה — קיים? כן, מוסיף אפשרות חדשה</p>
        </div>
      )}

      {draftRestored && (
        <div className="rounded-lg border-2 border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs flex items-center justify-between">
          <span>שוחזרה טיוטה אוטומטית מהפעם האחרונה</span>
          <button onClick={() => setDraftRestored(false)} className="text-muted-foreground hover:text-foreground">×</button>
        </div>
      )}

      {/* ── Visual editor (multiple mode only) ── */}
      {mode === "multiple" && visualMode ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="block text-right">בלוקי שאלות</Label>
            <button
              type="button"
              onClick={leaveVisual}
              className="text-xs flex items-center gap-1 text-navy hover:text-gold transition-colors"
            >
              <Pencil className="h-3 w-3" /> מעבר לעריכת טקסט
            </button>
          </div>

          {blocks.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-gold/40 p-6 text-center text-sm text-muted-foreground">
              אין בלוקים עדיין. לחץ "הוסף בלוק" כדי להתחיל
            </div>
          )}

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {blocks.map((block, bIdx) => {
              const correctCount = block.options.filter((o) => o.correct).length;
              const isFocused = focusedBlockId === block.id;
              return (
                <div
                  key={block.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, { kind: "block", blockId: block.id })}
                  onDragOver={onDragOver}
                  onDrop={() => onDropOnBlock(block.id)}
                  onClick={() => setFocusedBlockId(block.id)}
                  className={cn(
                    "rounded-lg border-2 bg-card p-3 space-y-2 transition-all",
                    isFocused ? "border-gold shadow-elegant" : "border-gold/30",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground mt-2 cursor-grab" />
                    <span className="text-[10px] font-bold text-gold mt-2">{bIdx + 1}.</span>
                    <Input
                      value={block.question}
                      onChange={(e) => setQuestion(block.id, e.target.value)}
                      placeholder="שאלה…"
                      dir="auto"
                      className="flex-1 border-gold/30 text-sm font-semibold"
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleMultiCorrect(block.id); }}
                        title={block.multiCorrect ? "כמה תשובות נכונות מותרות" : "תשובה נכונה אחת בלבד"}
                        className={cn(
                          "h-7 w-7 rounded-md border-2 flex items-center justify-center transition-colors",
                          block.multiCorrect ? "border-gold bg-gold/20 text-gold" : "border-gold/30 text-muted-foreground",
                        )}
                      >
                        {block.multiCorrect ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleShuffle(block.id); }}
                        title="ערבב סדר אפשרויות בלמידה"
                        className={cn(
                          "h-7 w-7 rounded-md border-2 flex items-center justify-center transition-colors",
                          block.shuffle ? "border-gold bg-gold/20 text-gold" : "border-gold/30 text-muted-foreground",
                        )}
                      >
                        <Shuffle className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeBlock(block.id); }}
                        title="מחק בלוק"
                        className="h-7 w-7 rounded-md border-2 border-destructive/30 text-destructive hover:bg-destructive/10 flex items-center justify-center"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Tags row */}
                  <div className="flex items-center gap-1.5 flex-wrap pr-6">
                    <TagIcon className="h-3 w-3 text-muted-foreground" />
                    {block.tags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-foreground border border-gold/30">
                        #{t}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeTag(block.id, t); }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <Input
                      value={tagInputs[block.id] ?? ""}
                      onChange={(e) => setTagInputs((p) => ({ ...p, [block.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          addTag(block.id, tagInputs[block.id] ?? "");
                        }
                      }}
                      placeholder="הוסף תגית…"
                      className="h-6 text-[11px] w-28 border-gold/20"
                      dir="auto"
                    />
                  </div>

                  {/* Options */}
                  <div className="space-y-1 pr-6">
                    {block.options.map((opt, oIdx) => (
                      <div
                        key={opt.id}
                        draggable
                        onDragStart={(e) => { e.stopPropagation(); onDragStart(e, { kind: "option", blockId: block.id, optionId: opt.id }); }}
                        onDragOver={onDragOver}
                        onDrop={(e) => { e.stopPropagation(); onDropOnOption(block.id, opt.id); }}
                        className="flex items-center gap-1.5"
                      >
                        <GripVertical className="h-3 w-3 text-muted-foreground cursor-grab" />
                        <span className="text-[10px] text-muted-foreground w-4 text-center">{oIdx + 1}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleCorrect(block.id, opt.id); }}
                          title={opt.correct ? "סמן כלא נכון" : "סמן כתשובה נכונה"}
                          className={cn(
                            "h-6 w-6 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0",
                            opt.correct
                              ? "border-green-500 bg-green-400/40 text-green-900 dark:text-green-100 shadow-[0_0_8px_rgba(34,197,94,0.55)]"
                              : "border-gold/30 hover:border-green-500/50",
                          )}
                        >
                          {opt.correct ? "✓" : ""}
                        </button>
                        <Input
                          value={opt.text}
                          onChange={(e) => setOptionText(block.id, opt.id, e.target.value)}
                          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === "Tab" && !e.shiftKey && oIdx === block.options.length - 1) {
                              e.preventDefault();
                              addOption(block.id);
                            }
                          }}
                          placeholder={`אפשרות ${oIdx + 1}`}
                          dir="auto"
                          className={cn(
                            "h-8 text-sm flex-1",
                            opt.correct
                              ? "border-green-500/60 bg-green-50 dark:bg-green-950/30 font-medium"
                              : "border-gold/20",
                          )}
                        />
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeOption(block.id, opt.id); }}
                          title="מחק אפשרות"
                          className="h-6 w-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center flex-shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); addOption(block.id); }}
                      className="text-xs text-navy hover:text-gold flex items-center gap-1 mt-1"
                    >
                      <Plus className="h-3 w-3" /> הוסף אפשרות
                    </button>
                  </div>

                  {correctCount === 0 && block.options.some((o) => o.text.trim()) && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400 pr-6">⚠ לא סומנה תשובה נכונה</div>
                  )}
                </div>
              );
            })}
          </div>

          <Button type="button" variant="outline" onClick={addBlock} className="w-full border-2 border-dashed border-gold/50 text-navy">
            <Plus className="h-4 w-4" /> הוסף בלוק
          </Button>

          {/* Live preview */}
          {focusedBlock && focusedBlock.question && (
            <div className="rounded-xl border-2 border-gold/40 bg-gradient-to-br from-secondary/30 to-card p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">תצוגה מקדימה</div>
              <p className="text-base font-display font-semibold text-foreground text-right">{focusedBlock.question}</p>
              <div className="space-y-1.5">
                {focusedBlock.options.map((o, i) => (
                  <div
                    key={o.id}
                    className={cn(
                      "px-3 py-2 rounded-lg border-2 text-sm text-right",
                      o.correct
                        ? "border-green-500 bg-green-400/20 text-foreground font-medium"
                        : "border-gold/30 bg-card text-foreground",
                    )}
                  >
                    <span className="text-xs text-muted-foreground ml-2">{["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"][i] ?? i + 1}.</span>
                    {o.text || <span className="text-muted-foreground">(ריק)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="block text-right">תוכן הייבוא</Label>
            {mode === "multiple" && (
              <button
                type="button"
                onClick={enterVisual}
                className="text-xs flex items-center gap-1 text-navy hover:text-gold transition-colors"
              >
                <Eye className="h-3 w-3" /> עורך חזותי
              </button>
            )}
          </div>
          <Textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setPreview(null); }}
            onPaste={handlePaste}
            placeholder={BULK_EXAMPLES[mode]}
            dir="auto"
            className="border-2 border-gold/40 font-mono text-sm min-h-[240px] text-right"
          />
        </div>
      )}

      {preview && (
        <div className={cn(
          "rounded-xl border-2 p-3 text-sm space-y-2",
          preview.errors.length > 0
            ? "border-destructive/50 bg-destructive/5"
            : "border-green-500/50 bg-green-50 dark:bg-green-950/30"
        )}>
          <div className="flex items-center gap-2 font-medium">
            {preview.errors.length > 0
              ? <><AlertCircle className="h-4 w-4 text-destructive" /> זוהו {preview.cards} שאלות תקינות, {preview.errors.length} שגיאות</>
              : <><CheckCircle2 className="h-4 w-4 text-green-600" /> {preview.cards} שאלות מוכנות לייבוא</>}
          </div>
          {preview.errors.slice(0, 5).map((e, i) => (
            <div key={i} className="text-xs text-destructive">• {e}</div>
          ))}
          {preview.errors.length > 5 && (
            <div className="text-xs text-muted-foreground">ועוד {preview.errors.length - 5} שגיאות...</div>
          )}
        </div>
      )}

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" onClick={handlePreview}
          disabled={!effectiveText.trim()}
          className="border-2 border-gold/50">
          <FileText className="h-4 w-4" /> בדוק
        </Button>
        <Button onClick={handleImport} disabled={!effectiveText.trim()}
          className="bg-gradient-navy text-primary-foreground rounded-xl">
          <Upload className="h-4 w-4" /> ייבא שאלות
        </Button>
      </DialogFooter>
    </div>
  );
}
