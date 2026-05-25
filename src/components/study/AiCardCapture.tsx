import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { Sparkles, Mic, Image as ImageIcon, Type, X, Loader2, Trash2, Check, MicOff, Settings, Bot, Brain, Wand2, Star, Zap, MessageCircle, BookOpen, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useStudy } from "@/lib/study/store";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Card as StudyCard } from "@/lib/study/types";

type Mode = "text" | "voice" | "image";
type Shape = "circle" | "square" | "rounded";
type IconName = "sparkles" | "bot" | "brain" | "wand" | "star" | "zap" | "chat" | "book" | "bulb";
type IconStyle = { color: string; bg: string; size: number; shape: Shape; icon: IconName };
type FabPos = { x: number; y: number };

const STYLE_KEY_V2 = "ai_capture_icon_style_v2";
const POS_KEY_V2 = "ai_capture_icon_pos_v2";
const FAB_PADDING = 12;
const DRAG_THRESHOLD = 4;

const DEFAULT_STYLE: IconStyle = { color: "#0a1f44", bg: "#d4af37", size: 56, shape: "circle", icon: "sparkles" };

const ICON_MAP: Record<IconName, React.ComponentType<any>> = {
  sparkles: Sparkles, bot: Bot, brain: Brain, wand: Wand2, star: Star,
  zap: Zap, chat: MessageCircle, book: BookOpen, bulb: Lightbulb,
};

const normalizeStyle = (value: unknown): IconStyle => {
  const raw = (value && typeof value === "object") ? (value as Partial<IconStyle>) : {};
  return {
    color: typeof raw.color === "string" ? raw.color : DEFAULT_STYLE.color,
    bg: typeof raw.bg === "string" ? raw.bg : DEFAULT_STYLE.bg,
    size: typeof raw.size === "number" ? raw.size : DEFAULT_STYLE.size,
    shape: raw.shape === "circle" || raw.shape === "square" || raw.shape === "rounded" ? raw.shape : DEFAULT_STYLE.shape,
    icon: raw.icon === "sparkles" || raw.icon === "bot" || raw.icon === "brain" || raw.icon === "wand" || raw.icon === "star" || raw.icon === "zap" || raw.icon === "chat" || raw.icon === "book" || raw.icon === "bulb" ? raw.icon : DEFAULT_STYLE.icon,
  };
};

const readStorageJson = <T,>(...keys: string[]): T | null => {
  if (typeof window === "undefined") return null;
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      return JSON.parse(raw) as T;
    } catch {
      // ignore malformed value
    }
  }
  return null;
};

const safeInsets = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.paddingTop = "env(safe-area-inset-top)";
  probe.style.paddingRight = "env(safe-area-inset-right)";
  probe.style.paddingBottom = "env(safe-area-inset-bottom)";
  probe.style.paddingLeft = "env(safe-area-inset-left)";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const cs = window.getComputedStyle(probe);
  const out = {
    top: Number.parseFloat(cs.paddingTop || "0") || 0,
    right: Number.parseFloat(cs.paddingRight || "0") || 0,
    bottom: Number.parseFloat(cs.paddingBottom || "0") || 0,
    left: Number.parseFloat(cs.paddingLeft || "0") || 0,
  };
  document.body.removeChild(probe);
  return out;
};

const defaultPos = (size: number): FabPos => {
  const insets = safeInsets();
  return {
    x: window.innerWidth - size - insets.right - FAB_PADDING,
    y: window.innerHeight - size - insets.bottom - FAB_PADDING,
  };
};

const clampPos = (pos: FabPos, size: number): FabPos => {
  const insets = safeInsets();
  const minX = insets.left + FAB_PADDING;
  const minY = insets.top + FAB_PADDING;
  const maxX = Math.max(minX, window.innerWidth - size - insets.right - FAB_PADDING);
  const maxY = Math.max(minY, window.innerHeight - size - insets.bottom - FAB_PADDING);
  return {
    x: Math.max(minX, Math.min(maxX, pos.x)),
    y: Math.max(minY, Math.min(maxY, pos.y)),
  };
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
  const { user, isGuest } = useAuth();
  const initialStyle = normalizeStyle(
    state.uiPrefs?.aiButtonStyle ?? readStorageJson<IconStyle>(STYLE_KEY_V2) ?? DEFAULT_STYLE,
  );
  const initialPos = clampPos(
    state.uiPrefs?.aiButtonPos ?? readStorageJson<FabPos>(POS_KEY_V2) ?? defaultPos(initialStyle.size),
    initialStyle.size,
  );

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("text");
  const [style, setStyle] = useState<IconStyle>(initialStyle);
  const [pos, setPos] = useState<FabPos>(initialPos);
  const [syncState, setSyncState] = useState<"idle" | "saving" | "saved">("idle");
  const [text, setText] = useState("");
  const [imageData, setImageData] = useState<{ base64: string; mime: string; preview: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [selectedCategoryNames, setSelectedCategoryNames] = useState<string[]>([]);
  const recognitionRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const savedBadgeTimerRef = useRef<number | null>(null);
  const firstRenderRef = useRef(true);
  const debugSeqRef = useRef(0);

  const safeJson = useCallback((value: unknown) => {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      if (v && typeof v === "object") {
        if (seen.has(v as object)) return "[Circular]";
        seen.add(v as object);
      }
      return v;
    });
  }, []);

  const dbg = useCallback((event: string, payload?: Record<string, unknown>) => {
    debugSeqRef.current += 1;
    const stamp = new Date().toISOString();
    const perf = Math.round(performance.now());
    if (payload) {
      console.debug(`[AI-FAB][${debugSeqRef.current}] ${stamp} +${perf}ms ${event} ${safeJson(payload)}`);
      return;
    }
    console.debug(`[AI-FAB][${debugSeqRef.current}] ${stamp} +${perf}ms ${event}`);
  }, [safeJson]);

  useEffect(() => {
    dbg("mount", {
      initialStyle,
      initialPos,
      hasUser: !!user,
      isGuest,
      categories: state.categories?.length ?? 0,
      decks: state.decks?.length ?? 0,
    });
    return () => dbg("unmount");
    // Intentionally mount-only: this must reflect true component lifecycle, not rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbg]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    dbg("pointerDown", { pointerId: e.pointerId, x: e.clientX, y: e.clientY, pos });
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - pos.x,
      offsetY: e.clientY - pos.y,
      moved: false,
    };
  }, [dbg, pos, pos.x, pos.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = Math.abs(e.clientX - drag.startX);
    const dy = Math.abs(e.clientY - drag.startY);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) drag.moved = true;
    const next = clampPos({ x: e.clientX - drag.offsetX, y: e.clientY - drag.offsetY }, style.size);
    dbg("pointerMove", { pointerId: e.pointerId, x: e.clientX, y: e.clientY, dx, dy, moved: drag.moved, next });
    setPos(next);
  }, [dbg, style.size]);

  const finishDrag = useCallback((pointerId: number, clientX?: number, clientY?: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const movedByRelease = typeof clientX === "number" && typeof clientY === "number" &&
      (Math.abs(clientX - drag.startX) > DRAG_THRESHOLD || Math.abs(clientY - drag.startY) > DRAG_THRESHOLD);
    dragRef.current = null;

    dbg("finishDrag", {
      pointerId,
      clientX,
      clientY,
      moved: drag.moved,
      movedByRelease,
      size: style.size,
    });

    if (drag.moved || movedByRelease) {
      dbg("finishDrag:applyFreePosition");
      setPos((prev) => clampPos(prev, style.size));
      return;
    }
    dbg("finishDrag:openDialog");
    setOpen(true);
  }, [dbg, style.size]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    dbg("pointerUp", { pointerId: e.pointerId, x: e.clientX, y: e.clientY });
    finishDrag(e.pointerId, e.clientX, e.clientY);
  }, [dbg, finishDrag]);

  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    dbg("pointerCancel", { pointerId: e.pointerId });
    finishDrag(e.pointerId);
  }, [dbg, finishDrag]);

  const onLostPointerCapture = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    dbg("lostPointerCapture", { pointerId: e.pointerId });
    finishDrag(e.pointerId);
  }, [dbg, finishDrag]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    dbg("keyDown", { key: e.key, shift: e.shiftKey, pos, size: style.size });
    const step = e.shiftKey ? 24 : 12;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dbg("keyDown:openDialog", { key: e.key });
      setOpen(true);
      return;
    }

    let next: FabPos | null = null;
    if (e.key === "ArrowLeft") next = { x: pos.x - step, y: pos.y };
    if (e.key === "ArrowRight") next = { x: pos.x + step, y: pos.y };
    if (e.key === "ArrowUp") next = { x: pos.x, y: pos.y - step };
    if (e.key === "ArrowDown") next = { x: pos.x, y: pos.y + step };
    if (!next) return;

    e.preventDefault();
    dbg("keyDown:move", { next });
    setPos(clampPos(next, style.size));
  }, [dbg, pos, style.size]);

  useEffect(() => {
    const onResize = () => setPos((prev) => clampPos(prev, style.size));
    dbg("viewportListener:attach", { size: style.size });
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      dbg("viewportListener:detach");
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [dbg, style.size]);

  useEffect(() => {
    // Absolute rebuild cleanup: remove old storage artifacts from the previous FAB implementation.
    try {
      localStorage.removeItem("ai_capture_icon_style_v1");
      localStorage.removeItem("ai_capture_icon_pos_v1");
      localStorage.removeItem("ai_capture_pref_sync_queue_v1");
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }

    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    setSyncState("saving");
    saveTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STYLE_KEY_V2, JSON.stringify(style));
        localStorage.setItem(POS_KEY_V2, JSON.stringify(pos));
        dbg("persist:localStorage", { style, pos });
      } catch {
        // ignore localStorage errors
      }
      setUiPref("aiButtonStyle", style as any);
      setUiPref("aiButtonPos", pos as any);
      dbg("persist:setUiPref", { style, pos });
      setSyncState("saved");
      if (savedBadgeTimerRef.current != null) window.clearTimeout(savedBadgeTimerRef.current);
      savedBadgeTimerRef.current = window.setTimeout(() => {
        dbg("syncState:idle");
        setSyncState("idle");
      }, 900);
      saveTimerRef.current = null;
    }, 180);

    dbg("persist:scheduled", { style, pos });

    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [dbg, pos, setUiPref, style]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
      if (savedBadgeTimerRef.current != null) window.clearTimeout(savedBadgeTimerRef.current);
    };
  }, []);

  const decks = open ? (state.decks ?? []) : [];
  const shouldBuildCategoryOptions = open && drafts.length > 0;
  const categoryOptions = useMemo(() => {
    if (!shouldBuildCategoryOptions) return EMPTY_CATEGORY_OPTIONS;
    const cats = state.categories ?? [];
    if (cats.length === 0) return EMPTY_CATEGORY_OPTIONS;

    const byParent = new Map<string | null, Category[]>();
    for (const c of cats) {
      const key = c.parentId ?? null;
      const bucket = byParent.get(key);
      if (bucket) bucket.push(c);
      else byParent.set(key, [c]);
    }

    const result: { id: string; label: string; name: string }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      const children = byParent.get(parentId) ?? [];
      children.forEach((c) => {
        result.push({ id: c.id, label: `${"— ".repeat(depth)}${c.name}`, name: c.name });
        walk(c.id, depth + 1);
      });
    };
    walk(null, 0);
    return result;
  }, [shouldBuildCategoryOptions, state.categories]);

  const reset = () => {
    dbg("reset");
    setText(""); setImageData(null); setDrafts([]);
    setSelectedDeckIds([]); setSelectedCategoryNames([]);
    setMode("text");
  };

  const handleClose = (v: boolean) => {
    dbg("handleClose", { nextOpen: v });
    if (!v) reset();
    setOpen(v);
  };

  const startVoice = () => {
    dbg("voice:startRequested");
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      dbg("voice:notSupported");
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
    rec.onerror = () => { dbg("voice:error"); setRecording(false); toast.error("שגיאה בזיהוי קולי"); };
    rec.onend = () => { dbg("voice:end"); setRecording(false); };
    rec.start();
    dbg("voice:started");
    recognitionRef.current = rec;
    setRecording(true);
  };
  const stopVoice = () => { dbg("voice:stop"); recognitionRef.current?.stop(); setRecording(false); };

  const onPickImage = (file: File) => {
    dbg("image:picked", { name: file.name, type: file.type, size: file.size });
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      setImageData({ base64, mime: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const extract = async () => {
    dbg("extract:start", {
      mode,
      textLength: text.trim().length,
      hasImage: !!imageData,
      recording,
      selectedDecks: selectedDeckIds.length,
      selectedCategories: selectedCategoryNames.length,
    });
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
      dbg("extract:response", { cards: cards.length, hasError: !!(data as any)?.error });
      if (!cards.length) { toast.error("לא חולצו שאלות"); return; }
      setDrafts(cards);
      toast.success(`חולצו ${cards.length} שאלות`);
    } catch (e: any) {
      dbg("extract:error", { message: e?.message ?? "unknown" });
      toast.error(e?.message || "שגיאה בחילוץ");
    } finally {
      dbg("extract:finally");
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
    dbg("saveAll:start", {
      drafts: drafts.length,
      selectedDecks: selectedDeckIds.length,
      selectedCategories: selectedCategoryNames.length,
    });
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
    dbg("saveAll:done", { saved });
    toast.success(`נוספו ${saved} כרטיסים`);
    handleClose(false);
  };

  useEffect(() => {
    dbg("dialogState", { open, mode, drafts: drafts.length, loading, syncState });
  }, [dbg, drafts.length, loading, mode, open, syncState]);

  const syncTitle = syncState === "saving"
    ? "שומר מיקום והגדרות"
    : syncState === "saved"
      ? "נשמר"
      : "AI - גרור או לחץ";

  return (
    <>
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        title={syncTitle}
        aria-label={syncTitle}
        tabIndex={0}
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
        className="z-40 shadow-2xl hover:scale-110 active:scale-95 transition-transform duration-150 select-none flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        {(() => { const I = ICON_MAP[style.icon] ?? Sparkles; return <I style={{ width: style.size * 0.5, height: style.size * 0.5 }} />; })()}

        {syncState !== "idle" && (
          <span
            className={`absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-background text-[10px] ${
              syncState === "saved" ? "bg-emerald-600 text-white" : "bg-amber-500 text-black"
            }`}
            title={syncTitle}
            role="status"
            aria-live="polite"
          >
            {syncState === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
            {syncState === "saved" && <Check className="h-3 w-3" />}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={handleClose} modal={false}>
        {open ? (
        <DialogContent
          className="max-w-3xl max-h-[92vh] overflow-y-auto p-0"
          dir="rtl"
          showOverlay={false}
          trapFocus={false}
          disableOutsidePointerEvents={false}
        >
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
              <DialogDescription className="sr-only">
                חילוץ שאלות ותשובות מטקסט, קול או תמונה באמצעות AI.
              </DialogDescription>
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