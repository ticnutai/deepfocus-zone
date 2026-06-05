import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save, Trash2, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useStudy } from "@/lib/study/store";
import type { Card as StudyCardType } from "@/lib/study/types";
import { toast } from "@/hooks/use-toast";

interface Props {
  card: StudyCardType;
  onClose?: () => void;
}

type Draft = {
  question: string;
  answer: string;
  explanation: string;
  options: string[];
  correctIndices: number[];
  correctBoolean: boolean;
  tags: string[];
};

const buildDraft = (card: StudyCardType): Draft => {
  const c = card as StudyCardType & {
    answer?: string;
    options?: string[];
    correctIndices?: number[];
    correct?: boolean;
    explanation?: string;
  };
  return {
    question: card.question ?? "",
    answer: c.answer ?? "",
    explanation: c.explanation ?? "",
    options: Array.isArray(c.options) ? [...c.options] : [],
    correctIndices: Array.isArray(c.correctIndices) ? [...c.correctIndices] : [],
    correctBoolean: c.correct === true,
    tags: Array.isArray(card.tags) ? [...card.tags] : [],
  };
};

const stripPatchByType = (card: StudyCardType, draft: Draft): Partial<StudyCardType> => {
  const base: Record<string, unknown> = {
    question: draft.question,
    tags: draft.tags,
  };
  if (card.type === "flashcard") {
    base.answer = draft.answer;
  } else if (card.type === "multiple") {
    base.options = draft.options;
    base.correctIndices = draft.correctIndices;
    base.explanation = draft.explanation;
  } else if (card.type === "boolean") {
    base.correct = draft.correctBoolean;
    base.explanation = draft.explanation;
  } else if (card.type === "combo") {
    base.answer = draft.answer;
    base.options = draft.options;
    base.correctIndices = draft.correctIndices;
    base.explanation = draft.explanation;
  }
  return base as Partial<StudyCardType>;
};

export function CardQuickEditor({ card, onClose }: Props) {
  const { updateCard } = useStudy();
  const [draft, setDraft] = useState<Draft>(() => buildDraft(card));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [newTag, setNewTag] = useState("");

  const cardId = card.id;
  const cardType = card.type;
  const initialRef = useRef(buildDraft(card));

  // Reset draft when switching to a different card
  useEffect(() => {
    const next = buildDraft(card);
    setDraft(next);
    initialRef.current = next;
    setSavedAt(null);
  }, [cardId]);

  // Autosave (debounced) — only when something actually changed
  useEffect(() => {
    const changed = JSON.stringify(draft) !== JSON.stringify(initialRef.current);
    if (!changed) return;
    setSaving(true);
    const t = window.setTimeout(() => {
      try {
        updateCard(cardId, stripPatchByType(card, draft));
        initialRef.current = draft;
        setSavedAt(Date.now());
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => window.clearTimeout(t);
  }, [draft, cardId, card, updateCard]);

  const saveNow = () => {
    updateCard(cardId, stripPatchByType(card, draft));
    initialRef.current = draft;
    setSavedAt(Date.now());
    toast({ title: "נשמר", description: "השינויים נשמרו בענן ובמכשיר" });
    onClose?.();
  };

  const setOption = (i: number, v: string) => {
    setDraft((d) => ({ ...d, options: d.options.map((o, idx) => (idx === i ? v : o)) }));
  };
  const removeOption = (i: number) => {
    setDraft((d) => {
      const opts = d.options.filter((_, idx) => idx !== i);
      const correctIndices = d.correctIndices
        .filter((ci) => ci !== i)
        .map((ci) => (ci > i ? ci - 1 : ci));
      return { ...d, options: opts, correctIndices };
    });
  };
  const addOption = () => {
    setDraft((d) => ({ ...d, options: [...d.options, ""] }));
  };
  const toggleCorrect = (i: number) => {
    setDraft((d) => {
      const has = d.correctIndices.includes(i);
      const next = has ? d.correctIndices.filter((x) => x !== i) : [...d.correctIndices, i];
      return { ...d, correctIndices: next.sort((a, b) => a - b) };
    });
  };
  const addTag = () => {
    const t = newTag.trim();
    if (!t) return;
    setDraft((d) => (d.tags.includes(t) ? d : { ...d, tags: [...d.tags, t] }));
    setNewTag("");
  };
  const removeTag = (t: string) => {
    setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== t) }));
  };

  const savedLabel = useMemo(() => {
    if (saving) return "שומר…";
    if (!savedAt) return "אין שינויים";
    const s = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
    return s < 5 ? "נשמר ✓" : `נשמר לפני ${s}\"`;
  }, [saving, savedAt]);

  return (
    <div className="flex flex-col gap-4 p-1" dir="rtl">
      <div className="space-y-2">
        <Label htmlFor="qe-q" className="text-xs">שאלה</Label>
        <Textarea
          id="qe-q"
          value={draft.question}
          onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))}
          className="min-h-[100px] text-base"
          dir="rtl"
        />
      </div>

      {(cardType === "flashcard" || cardType === "combo") && (
        <div className="space-y-2">
          <Label htmlFor="qe-a" className="text-xs">תשובה</Label>
          <Textarea
            id="qe-a"
            value={draft.answer}
            onChange={(e) => setDraft((d) => ({ ...d, answer: e.target.value }))}
            className="min-h-[80px]"
            dir="rtl"
          />
        </div>
      )}

      {(cardType === "multiple" || cardType === "combo") && (
        <div className="space-y-2">
          <Label className="text-xs">אופציות (סמן ✓ את הנכונות)</Label>
          <div className="space-y-1.5">
            {draft.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <Checkbox
                  checked={draft.correctIndices.includes(i)}
                  onCheckedChange={() => toggleCorrect(i)}
                />
                <Input
                  value={opt}
                  onChange={(e) => setOption(i, e.target.value)}
                  className="flex-1 h-9"
                  placeholder={`אפשרות ${i + 1}`}
                  dir="rtl"
                />
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeOption(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addOption} className="h-8">
              <Plus className="h-3.5 w-3.5 ml-1" /> הוסף אפשרות
            </Button>
          </div>
        </div>
      )}

      {cardType === "boolean" && (
        <div className="space-y-2">
          <Label className="text-xs">תשובה נכונה</Label>
          <RadioGroup
            value={draft.correctBoolean ? "true" : "false"}
            onValueChange={(v) => setDraft((d) => ({ ...d, correctBoolean: v === "true" }))}
            className="flex gap-4"
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="true" /> נכון
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="false" /> לא נכון
            </label>
          </RadioGroup>
        </div>
      )}

      {(cardType === "multiple" || cardType === "boolean" || cardType === "combo") && (
        <div className="space-y-2">
          <Label htmlFor="qe-ex" className="text-xs">הסבר (אופציונלי)</Label>
          <Textarea
            id="qe-ex"
            value={draft.explanation}
            onChange={(e) => setDraft((d) => ({ ...d, explanation: e.target.value }))}
            className="min-h-[60px]"
            dir="rtl"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs">תגיות</Label>
        <div className="flex flex-wrap gap-1.5 mb-1">
          {draft.tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/10 border border-gold/30 text-xs">
              {t}
              <button onClick={() => removeTag(t)} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder="הוסף תגית…"
            className="h-9"
            dir="rtl"
          />
          <Button variant="outline" size="sm" onClick={addTag}>הוסף</Button>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-gold/20">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : savedAt ? <Check className="h-3 w-3 text-green-600" /> : null}
          {savedLabel}
        </span>
        <div className="flex gap-2">
          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>סגור</Button>
          )}
          <Button onClick={saveNow} size="sm" className="bg-gradient-navy text-primary-foreground">
            <Save className="h-4 w-4 ml-1" /> שמור
          </Button>
        </div>
      </div>
    </div>
  );
}
