import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Sparkles, Mic, Image as ImageIcon, Type, X, Loader2, Trash2, Check, MicOff, Settings, Bot, Brain, Wand2, Star, Zap, MessageCircle, BookOpen, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useStudy } from "@/lib/study/store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Card as StudyCard } from "@/lib/study/types";

type Mode = "text" | "voice" | "image";

type Shape = "circle" | "square" | "rounded";
type IconName = "sparkles" | "bot" | "brain" | "wand" | "star" | "zap" | "chat" | "book" | "bulb";
type IconStyle = { color: string; bg: string; size: number; shape: Shape; icon: IconName };
const STYLE_KEY = "ai_capture_icon_style_v1"; // legacy localStorage key — used for migration only
const POS_KEY = "ai_capture_icon_pos_v1"; // legacy localStorage key — used for migration only
const DEFAULT_STYLE: IconStyle = { color: "#0a1f44", bg: "#d4af37", size: 56, shape: "circle", icon: "sparkles" };
const STYLE_SYNC_DEBOUNCE_MS = 180;
const DRAG_THRESHOLD_PX = 3;
const normalizeIconStyle = (value: unknown): IconStyle => {
  const raw = (value && typeof value === "object") ? (value as Partial<IconStyle>) : {};
  return {
    color: typeof raw.color === "string" ? raw.color : DEFAULT_STYLE.color,
    bg: typeof raw.bg === "string" ? raw.bg : DEFAULT_STYLE.bg,
    size: typeof raw.size === "number" ? raw.size : DEFAULT_STYLE.size,
    shape: raw.shape === "circle" || raw.shape === "square" || raw.shape === "rounded" ? raw.shape : DEFAULT_STYLE.shape,
    icon: raw.icon === "sparkles" || raw.icon === "bot" || raw.icon === "brain" || raw.icon === "wand" || raw.icon === "star" || raw.icon === "zap" || raw.icon === "chat" || raw.icon === "book" || raw.icon === "bulb" ? raw.icon : DEFAULT_STYLE.icon,
  };
};
const sameIconStyle = (a: IconStyle, b: IconStyle): boolean => (
  a.color === b.color &&
  a.bg === b.bg &&
  a.size === b.size &&
  a.shape === b.shape &&
  a.icon === b.icon
);
const samePos = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => a.x === b.x && a.y === b.y;
const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
const clampPosToViewport = (next: { x: number; y: number }, size: number): { x: number; y: number } => ({
  x: clamp(next.x, 0, Math.max(0, window.innerWidth - size)),
  y: clamp(next.y, 0, Math.max(0, window.innerHeight - size)),
});
const ICON_MAP: Record<IconName, React.ComponentType<any>> = {
  sparkles: Sparkles, bot: Bot, brain: Brain, wand: Wand2, star: Star,
  zap: Zap, chat: MessageCircle, book: BookOpen, bulb: Lightbulb,
};

type Draft = {
  type: "flashcard" | "multiple" | "boolean";
  question: string;
  answer?: string;
  options?: string[];
  correctIndices?: number[];
  correct?: boolean;
  explanation?: string;
};

const EMPTY_CATEGORY_OPTIONS: { id: string; label: string; name: string }[] = [];

export function AiCardCapture() {
  const { state, addCard, setUiPref } = useStudy();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [imageData, setImageData] = useState<{ base64: string; mime: string; preview: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [selectedCategoryNames, setSelectedCategoryNames] = useState<string[]>([]);
  const recognitionRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [style, setStyle] = useState<IconStyle>(() => {
    // Prefer uiPrefs from cloud/IDB, fall back to legacy localStorage for migration
    if (state.uiPrefs?.aiButtonStyle) return normalizeIconStyle(state.uiPrefs.aiButtonStyle);
    try { const r = localStorage.getItem(STYLE_KEY); if (r) return normalizeIconStyle(JSON.parse(r)); } catch {}
    return DEFAULT_STYLE;
  });
  const styleSyncTimerRef = useRef<number | null>(null);
  const persistStyle = useCallback((next: IconStyle) => {
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setUiPref("aiButtonStyle", next as { color: string; bg: string; size: number; shape: string; icon: string });
  }, [setUiPref]);

  useEffect(() => {
    if (styleSyncTimerRef.current) window.clearTimeout(styleSyncTimerRef.current);
    styleSyncTimerRef.current = window.setTimeout(() => {
      const cloudStyle = normalizeIconStyle(state.uiPrefs?.aiButtonStyle);
      if (!sameIconStyle(cloudStyle, style)) persistStyle(style);
    }, STYLE_SYNC_DEBOUNCE_MS);

    return () => {
      if (styleSyncTimerRef.current) {
        window.clearTimeout(styleSyncTimerRef.current);
        styleSyncTimerRef.current = null;
      }
    };
  }, [style, state.uiPrefs?.aiButtonStyle, persistStyle]);
  // Sync style from cloud/IDB hydration after initial render
  useEffect(() => {
    if (state.uiPrefs?.aiButtonStyle) {
      const next = normalizeIconStyle(state.uiPrefs.aiButtonStyle);
      setStyle((prev) => sameIconStyle(prev, next) ? prev : next);
    }
  }, [state.uiPrefs?.aiButtonStyle]);

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    // Prefer uiPrefs from cloud/IDB, fall back to legacy localStorage for migration
    if (state.uiPrefs?.aiButtonPos) return state.uiPrefs.aiButtonPos;
    try { const r = localStorage.getItem(POS_KEY); if (r) return JSON.parse(r); } catch {}
    return { x: window.innerWidth - 80, y: window.innerHeight - 80 };
  });
  const currentPosRef = useRef(pos);
  const isDraggingRef = useRef(false);
  const dragMetaRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const rafMoveRef = useRef<number | null>(null);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);

  const persistPos = useCallback((next: { x: number; y: number }) => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setUiPref("aiButtonPos", next);
  }, [setUiPref]);

  // Sync pos from cloud/IDB hydration after initial render
  useEffect(() => {
    if (isDraggingRef.current) return;
    if (state.uiPrefs?.aiButtonPos) {
      const next = clampPosToViewport(state.uiPrefs.aiButtonPos, style.size);
      setPos((prev) => samePos(prev, next) ? prev : next);
      currentPosRef.current = next;
    }
  }, [state.uiPrefs?.aiButtonPos?.x, state.uiPrefs?.aiButtonPos?.y, style.size]);

  useEffect(() => {
    const clamped = clampPosToViewport(currentPosRef.current, style.size);
    if (!samePos(clamped, currentPosRef.current)) {
      currentPosRef.current = clamped;
      setPos(clamped);
      persistPos(clamped);
    }
  }, [style.size, persistPos]);

  useEffect(() => {
    const onResize = () => {
      const clamped = clampPosToViewport(currentPosRef.current, style.size);
      if (!samePos(clamped, currentPosRef.current)) {
        currentPosRef.current = clamped;
        setPos(clamped);
        persistPos(clamped);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [style.size, persistPos]);

  const flushPendingMove = useCallback(() => {
    rafMoveRef.current = null;
    const next = pendingPosRef.current;
    pendingPosRef.current = null;
    if (!next) return;
    if (!samePos(next, currentPosRef.current)) {
      currentPosRef.current = next;
      setPos(next);
    }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    dragMetaRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - currentPosRef.current.x,
      offsetY: e.clientY - currentPosRef.current.y,
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const meta = dragMetaRef.current;
    if (!meta || meta.pointerId !== e.pointerId) return;

    const dx = Math.abs(e.clientX - meta.startX);
    const dy = Math.abs(e.clientY - meta.startY);
    if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) meta.moved = true;

    const next = clampPosToViewport({ x: e.clientX - meta.offsetX, y: e.clientY - meta.offsetY }, style.size);
    pendingPosRef.current = next;
    if (rafMoveRef.current == null) rafMoveRef.current = window.requestAnimationFrame(flushPendingMove);
  }, [style.size, flushPendingMove]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const meta = dragMetaRef.current;
    if (!meta || meta.pointerId !== e.pointerId) return;
    dragMetaRef.current = null;
    isDraggingRef.current = false;

    if (meta.moved) {
      persistPos(currentPosRef.current);
    } else {
      setOpen(true);
    }
  }, [persistPos]);

  useEffect(() => {
    return () => {
      if (rafMoveRef.current != null) window.cancelAnimationFrame(rafMoveRef.current);
      if (styleSyncTimerRef.current != null) window.clearTimeout(styleSyncTimerRef.current);
    };
  }, []);

  const decks = open ? (state.decks ?? []) : [];
  const categoryOptions = useMemo(() => {
    if (!open) return EMPTY_CATEGORY_OPTIONS;
    const cats = state.categories ?? [];
    const result: { id: string; label: string; name: string }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      cats.filter((c) => c.parentId === parentId).forEach((c) => {
        result.push({ id: c.id, label: `${"— ".repeat(depth)}${c.name}`, name: c.name });
        walk(c.id, depth + 1);
      });
    };
    walk(null, 0);
    return result;
  }, [open, state.categories]);

  const reset = () => {
    setText(""); setImageData(null); setDrafts([]);
    setSelectedDeckIds([]); setSelectedCategoryNames([]);
    setMode("text");
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    setOpen(v);
  };

  const startVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("הדפדפן לא תומך בזיהוי קולי");
      return;
    }
    const rec = new SR();
    rec.lang = "he-IL";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        finalText += e.results[i][0].transcript;
      }
      setText((prev) => prev + " " + finalText);
    };
    rec.onerror = () => { setRecording(false); toast.error("שגיאה בזיהוי קולי"); };
    rec.onend = () => setRecording(false);
    rec.start();
    recognitionRef.current = rec;
    setRecording(true);
  };
  const stopVoice = () => { recognitionRef.current?.stop(); setRecording(false); };

  const onPickImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      setImageData({ base64, mime: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const extract = async () => {
    if (mode !== "image" && !text.trim()) { toast.error("הזן טקסט או הקלט קול"); return; }
    if (mode === "image" && !imageData) { toast.error("העלה תמונה"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-cards", {
        body: {
          text: text.trim() || undefined,
          imageBase64: imageData?.base64,
          imageMime: imageData?.mime,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const cards = (data as any)?.cards ?? [];
      if (!cards.length) { toast.error("לא חולצו שאלות"); return; }
      setDrafts(cards);
      toast.success(`חולצו ${cards.length} שאלות`);
    } catch (e: any) {
      toast.error(e?.message || "שגיאה בחילוץ");
    } finally {
      setLoading(false);
    }
  };

  const updateDraft = (idx: number, patch: Partial<Draft>) => {
    setDrafts((arr) => arr.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };
  const removeDraft = (idx: number) => setDrafts((arr) => arr.filter((_, i) => i !== idx));

  const toggleDeck = (id: string) =>
    setSelectedDeckIds((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));
  const toggleCategory = (name: string) =>
    setSelectedCategoryNames((arr) => (arr.includes(name) ? arr.filter((x) => x !== name) : [...arr, name]));

  const saveAll = () => {
    if (!drafts.length) return;
    if (!selectedDeckIds.length) { toast.error("בחר לפחות חפיסה אחת"); return; }
    const categoryTags = selectedCategoryNames.map((n) => `cat:${n}`);
    let saved = 0;
    for (const d of drafts) {
      for (const deckId of selectedDeckIds) {
        const base = { deckId, question: d.question.trim(), tags: [...categoryTags] };
        if (d.type === "flashcard") {
          addCard({ ...base, type: "flashcard", answer: (d.answer ?? "").trim() } as Omit<StudyCard, "id" | "createdAt" | "srs" | "stats">);
        } else if (d.type === "multiple") {
          addCard({ ...base, type: "multiple", options: (d.options ?? []).filter(Boolean), correctIndices: d.correctIndices ?? [] } as Omit<StudyCard, "id" | "createdAt" | "srs" | "stats">);
        } else if (d.type === "boolean") {
          addCard({ ...base, type: "boolean", correct: !!d.correct, explanation: d.explanation } as Omit<StudyCard, "id" | "createdAt" | "srs" | "stats">);
        }
        saved++;
      }
    }
    toast.success(`נוספו ${saved} כרטיסים`);
    handleClose(false);
  };

  return (
    <>
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="AI - גרור או לחץ"
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          width: style.size,
          height: style.size,
          background: style.bg,
          color: style.color,
          borderRadius: style.shape === "circle" ? "9999px" : style.shape === "rounded" ? "16px" : "4px",
          touchAction: "none",
        }}
        className="z-40 shadow-2xl hover:scale-110 active:scale-95 transition-transform duration-150 select-none flex items-center justify-center cursor-move focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        {(() => { const I = ICON_MAP[style.icon] ?? Sparkles; return <I style={{ width: style.size * 0.5, height: style.size * 0.5 }} />; })()}
      </button>

      <Dialog open={open} onOpenChange={handleClose}>
        {open ? (
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0" dir="rtl">
          {/* Header with gold gradient accent */}
          <div className="bg-gradient-to-l from-gold/15 via-gold/8 to-transparent border-b border-gold/20 px-6 pt-5 pb-4">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gold/15 border border-gold/30">
                    <Sparkles className="h-5 w-5 text-gold" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold leading-tight">חילוץ שאלות באמצעות AI</div>
                    <div className="text-xs text-muted-foreground font-normal mt-0.5">הזן טקסט, קול או תמונה — ה-AI יחלץ כרטיסיות לימוד</div>
                  </div>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="icon" variant="ghost" title="הגדרות איקון" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-gold/10">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 space-y-3" dir="rtl">
                    <div className="font-semibold text-sm text-gold">עיצוב האיקון הצף</div>
                    <div className="space-y-1">
                      <Label className="text-xs">צבע רקע</Label>
                      <input type="color" value={style.bg} onChange={(e) => setStyle({ ...style, bg: e.target.value })} className="h-8 w-full rounded cursor-pointer" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">צבע איקון</Label>
                      <input type="color" value={style.color} onChange={(e) => setStyle({ ...style, color: e.target.value })} className="h-8 w-full rounded cursor-pointer" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">גודל ({style.size}px)</Label>
                      <Slider min={24} max={96} step={2} value={[style.size]} onValueChange={(v) => setStyle({ ...style, size: v[0] })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">איקון</Label>
                      <div className="grid grid-cols-5 gap-1">
                        {(Object.keys(ICON_MAP) as IconName[]).map((n) => {
                          const I = ICON_MAP[n];
                          return (
                            <Button key={n} size="icon" variant={style.icon === n ? "default" : "outline"} className="h-9 w-9" onClick={() => setStyle({ ...style, icon: n })}>
                              <I className="h-4 w-4" />
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">צורה</Label>
                      <div className="flex gap-1">
                        {(["circle", "rounded", "square"] as Shape[]).map((s) => (
                          <Button key={s} size="sm" variant={style.shape === s ? "default" : "outline"} onClick={() => setStyle({ ...style, shape: s })}>
                            {s === "circle" ? "עיגול" : s === "rounded" ? "מעוגל" : "ריבוע"}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="w-full" onClick={() => setStyle(DEFAULT_STYLE)}>איפוס</Button>
                  </PopoverContent>
                </Popover>
              </DialogTitle>
            </DialogHeader>
          </div>

          <div className="px-6 py-5">
            {drafts.length === 0 ? (
              <div className="space-y-5">
                {/* Mode selector — pill tabs */}
                <div className="inline-flex bg-muted rounded-xl p-1 gap-1">
                  {([
                    { id: "text" as Mode, icon: Type, label: "טקסט" },
                    { id: "voice" as Mode, icon: Mic, label: "קול" },
                    { id: "image" as Mode, icon: ImageIcon, label: "תמונה" },
                  ] as const).map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      onClick={() => setMode(id)}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        mode === id
                          ? "bg-gold text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* Text mode */}
                {mode === "text" && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-foreground">הזן את השאלות והתשובות</Label>
                    <Textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={7}
                      className="resize-none border-border focus:border-gold focus:ring-1 focus:ring-gold/40 rounded-xl text-sm"
                      placeholder='לדוג: השאלה היא X, האפשרויות הן: 1) א 2) ב 3) ג 4) ד, התשובה הנכונה היא 2'
                    />
                  </div>
                )}

                {/* Voice mode */}
                {mode === "voice" && (
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">הקלט קולית את השאלות</Label>
                    <div className="flex gap-2 items-center">
                      {!recording ? (
                        <Button onClick={startVoice} variant="outline" className="border-gold/40 hover:border-gold hover:bg-gold/10 gap-2">
                          <Mic className="h-4 w-4 text-gold" /> התחל הקלטה
                        </Button>
                      ) : (
                        <Button onClick={stopVoice} variant="destructive" className="gap-2 animate-pulse">
                          <MicOff className="h-4 w-4" /> עצור הקלטה
                        </Button>
                      )}
                      {recording && <span className="text-xs text-muted-foreground">מקליט...</span>}
                    </div>
                    <Textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={6}
                      className="resize-none border-border focus:border-gold focus:ring-1 focus:ring-gold/40 rounded-xl text-sm"
                      placeholder="הטקסט המתומלל יופיע כאן..."
                    />
                  </div>
                )}

                {/* Image mode */}
                {mode === "image" && (
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">העלה תמונה של שאלות ותשובות</Label>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onPickImage(e.target.files[0])} />
                    <Button
                      onClick={() => fileRef.current?.click()}
                      variant="outline"
                      className="border-dashed border-gold/40 hover:border-gold hover:bg-gold/10 gap-2 h-20 w-full flex-col text-muted-foreground hover:text-foreground"
                    >
                      <ImageIcon className="h-6 w-6 text-gold" />
                      <span className="text-sm">לחץ לבחירת תמונה</span>
                    </Button>
                    {imageData && (
                      <div className="relative inline-block">
                        <img src={imageData.preview} alt="" className="max-h-56 rounded-xl border border-gold/20 shadow-sm" />
                        <Button size="sm" variant="destructive" className="absolute top-2 left-2 h-7 w-7 p-0 rounded-full" onClick={() => setImageData(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <Textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={2}
                      className="resize-none border-border focus:border-gold focus:ring-1 focus:ring-gold/40 rounded-xl text-sm"
                      placeholder="הוראות נוספות (אופציונלי)"
                    />
                  </div>
                )}

                <DialogFooter className="pt-1">
                  <Button
                    onClick={extract}
                    disabled={loading}
                    className="bg-gold hover:bg-gold/90 text-primary-foreground font-semibold gap-2 px-6 py-2.5 rounded-xl shadow-gold"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {loading ? "מחלץ..." : "חלץ שאלות"}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Preview header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gold/20 text-gold text-xs font-bold">{drafts.length}</span>
                    <h3 className="font-semibold text-base">שאלות חולצו — עיין ועדכן לפני שמירה</h3>
                  </div>
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground gap-1" onClick={() => setDrafts([])}>
                    ← חזור
                  </Button>
                </div>

                {/* Draft cards */}
                <div className="space-y-3 max-h-[40vh] overflow-y-auto pl-1">
                  {drafts.map((d, idx) => (
                    <div key={idx} className="border border-border rounded-xl p-4 space-y-3 bg-card hover:border-gold/30 transition-colors">
                      <div className="flex items-center justify-between">
                        <Badge
                          variant="outline"
                          className="border-gold/40 text-gold bg-gold/5 text-xs font-medium"
                        >
                          {d.type === "flashcard" ? "פתוחה" : d.type === "multiple" ? "אמריקאית" : "נכון / לא נכון"}
                        </Badge>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeDraft(idx)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Input
                        value={d.question}
                        onChange={(e) => updateDraft(idx, { question: e.target.value })}
                        placeholder="שאלה"
                        className="font-medium focus:border-gold focus:ring-1 focus:ring-gold/40"
                      />

                      {d.type === "flashcard" && (
                        <Textarea
                          value={d.answer ?? ""}
                          onChange={(e) => updateDraft(idx, { answer: e.target.value })}
                          rows={2}
                          placeholder="תשובה"
                          className="resize-none text-sm focus:border-gold focus:ring-1 focus:ring-gold/40"
                        />
                      )}

                      {d.type === "multiple" && (
                        <div className="space-y-2">
                          {(d.options ?? []).map((opt, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <Checkbox
                                checked={(d.correctIndices ?? []).includes(oi)}
                                className="border-gold/50 data-[state=checked]:bg-gold data-[state=checked]:border-gold"
                                onCheckedChange={(c) => {
                                  const cur = d.correctIndices ?? [];
                                  updateDraft(idx, { correctIndices: c ? [...cur, oi] : cur.filter((x) => x !== oi) });
                                }}
                              />
                              <Input
                                value={opt}
                                className="text-sm focus:border-gold focus:ring-1 focus:ring-gold/40"
                                onChange={(e) => {
                                  const newOpts = [...(d.options ?? [])];
                                  newOpts[oi] = e.target.value;
                                  updateDraft(idx, { options: newOpts });
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {d.type === "boolean" && (
                        <RadioGroup value={d.correct ? "true" : "false"} onValueChange={(v) => updateDraft(idx, { correct: v === "true" })}>
                          <div className="flex gap-6">
                            <div className="flex items-center gap-1.5">
                              <RadioGroupItem value="true" id={`t-${idx}`} className="border-gold text-gold" />
                              <Label htmlFor={`t-${idx}`} className="text-sm">נכון</Label>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <RadioGroupItem value="false" id={`f-${idx}`} />
                              <Label htmlFor={`f-${idx}`} className="text-sm">לא נכון</Label>
                            </div>
                          </div>
                        </RadioGroup>
                      )}
                    </div>
                  ))}
                </div>

                {/* Deck selector */}
                <div className="space-y-2 border-t border-border pt-4">
                  <Label className="text-sm font-semibold">חפיסות יעד <span className="text-muted-foreground font-normal">(לפחות אחת)</span></Label>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {decks.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => toggleDeck(d.id)}
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                          selectedDeckIds.includes(d.id)
                            ? "bg-gold border-gold text-primary-foreground shadow-sm"
                            : "border-border text-muted-foreground hover:border-gold/50 hover:text-foreground"
                        }`}
                      >
                        {selectedDeckIds.includes(d.id) && <Check className="h-3 w-3" />}
                        {d.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Category selector */}
                {categoryOptions.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">קטגוריות <span className="text-muted-foreground font-normal">(אופציונלי)</span></Label>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {categoryOptions.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => toggleCategory(c.name)}
                          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                            selectedCategoryNames.includes(c.name)
                              ? "bg-gold/20 border-gold/60 text-gold"
                              : "border-border text-muted-foreground hover:border-gold/40 hover:text-foreground"
                          }`}
                        >
                          {selectedCategoryNames.includes(c.name) && <Check className="h-3 w-3" />}
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <DialogFooter className="pt-1 gap-2">
                  <Button variant="outline" className="rounded-xl" onClick={() => handleClose(false)}>ביטול</Button>
                  <Button
                    onClick={saveAll}
                    className="bg-gold hover:bg-gold/90 text-primary-foreground font-semibold gap-2 px-6 rounded-xl shadow-gold"
                  >
                    <Check className="h-4 w-4" /> שמור הכל
                  </Button>
                </DialogFooter>
              </div>
            )}
          </div>
        </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}