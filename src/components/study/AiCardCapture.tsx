import { useState, useRef, useMemo, useEffect } from "react";
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
    if (state.uiPrefs?.aiButtonStyle) return { ...DEFAULT_STYLE, ...state.uiPrefs.aiButtonStyle } as IconStyle;
    try { const r = localStorage.getItem(STYLE_KEY); if (r) return { ...DEFAULT_STYLE, ...JSON.parse(r) }; } catch {}
    return DEFAULT_STYLE;
  });
  const isFirstStyleRender = useRef(true);
  useEffect(() => {
    if (isFirstStyleRender.current) { isFirstStyleRender.current = false; return; }
    setUiPref("aiButtonStyle", style as { color: string; bg: string; size: number; shape: string; icon: string });
  }, [style]);
  // Sync style from cloud/IDB hydration after initial render
  useEffect(() => {
    if (state.uiPrefs?.aiButtonStyle) {
      setStyle({ ...DEFAULT_STYLE, ...state.uiPrefs.aiButtonStyle } as IconStyle);
    }
  }, [state.uiPrefs?.aiButtonStyle]);

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    // Prefer uiPrefs from cloud/IDB, fall back to legacy localStorage for migration
    if (state.uiPrefs?.aiButtonPos) return state.uiPrefs.aiButtonPos;
    try { const r = localStorage.getItem(POS_KEY); if (r) return JSON.parse(r); } catch {}
    return { x: window.innerWidth - 80, y: window.innerHeight - 80 };
  });
  const currentPosRef = useRef(pos);
  // Sync pos from cloud/IDB hydration after initial render
  useEffect(() => {
    if (state.uiPrefs?.aiButtonPos) {
      setPos(state.uiPrefs.aiButtonPos);
      currentPosRef.current = state.uiPrefs.aiButtonPos;
    }
  }, [state.uiPrefs?.aiButtonPos?.x, state.uiPrefs?.aiButtonPos?.y]);

  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const nx = e.clientX - dragRef.current.dx;
    const ny = e.clientY - dragRef.current.dy;
    if (Math.abs(nx - pos.x) > 3 || Math.abs(ny - pos.y) > 3) dragRef.current.moved = true;
    const maxX = window.innerWidth - style.size;
    const maxY = window.innerHeight - style.size;
    const newPos = { x: Math.max(0, Math.min(maxX, nx)), y: Math.max(0, Math.min(maxY, ny)) };
    currentPosRef.current = newPos;
    setPos(newPos);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const moved = dragRef.current?.moved;
    dragRef.current = null;
    if (moved) {
      setUiPref("aiButtonPos", currentPosRef.current);
    } else {
      setOpen(true);
    }
  };

  const decks = state.decks ?? [];
  const categoryOptions = useMemo(() => {
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
  }, [state.categories]);

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
        className="z-40 shadow-2xl hover:scale-110 transition-transform flex items-center justify-center cursor-move"
      >
        {(() => { const I = ICON_MAP[style.icon] ?? Sparkles; return <I style={{ width: style.size * 0.5, height: style.size * 0.5 }} />; })()}
      </button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-gold" />
                חילוץ שאלות באמצעות AI
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="icon" variant="ghost" title="הגדרות איקון"><Settings className="h-4 w-4" /></Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 space-y-3" dir="rtl">
                  <div className="font-semibold text-sm">עיצוב האיקון הצף</div>
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

          {drafts.length === 0 ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button variant={mode === "text" ? "default" : "outline"} size="sm" onClick={() => setMode("text")}>
                  <Type className="h-4 w-4 ml-1" /> טקסט
                </Button>
                <Button variant={mode === "voice" ? "default" : "outline"} size="sm" onClick={() => setMode("voice")}>
                  <Mic className="h-4 w-4 ml-1" /> קול
                </Button>
                <Button variant={mode === "image" ? "default" : "outline"} size="sm" onClick={() => setMode("image")}>
                  <ImageIcon className="h-4 w-4 ml-1" /> תמונה
                </Button>
              </div>

              {mode === "text" && (
                <div>
                  <Label>הזן את השאלות והתשובות</Label>
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={6}
                    placeholder='לדוג: השאלה היא X, האפשרויות הן: 1) א 2) ב 3) ג 4) ד, התשובה הנכונה היא 2'
                  />
                </div>
              )}

              {mode === "voice" && (
                <div className="space-y-2">
                  <Label>הקלט קולית את השאלות</Label>
                  <div className="flex gap-2">
                    {!recording ? (
                      <Button onClick={startVoice} variant="outline"><Mic className="h-4 w-4 ml-1" /> התחל הקלטה</Button>
                    ) : (
                      <Button onClick={stopVoice} variant="destructive"><MicOff className="h-4 w-4 ml-1" /> עצור</Button>
                    )}
                  </div>
                  <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="הטקסט המתומלל יופיע כאן..." />
                </div>
              )}

              {mode === "image" && (
                <div className="space-y-2">
                  <Label>העלה תמונה של שאלות ותשובות</Label>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onPickImage(e.target.files[0])} />
                  <Button onClick={() => fileRef.current?.click()} variant="outline">
                    <ImageIcon className="h-4 w-4 ml-1" /> בחר תמונה
                  </Button>
                  {imageData && (
                    <div className="relative">
                      <img src={imageData.preview} alt="" className="max-h-64 rounded border" />
                      <Button size="sm" variant="destructive" className="absolute top-2 left-2" onClick={() => setImageData(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="הוראות נוספות (אופציונלי)" />
                </div>
              )}

              <DialogFooter>
                <Button onClick={extract} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Sparkles className="h-4 w-4 ml-1" />}
                  חלץ שאלות
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">תצוגה מקדימה ({drafts.length})</h3>
                <Button size="sm" variant="ghost" onClick={() => setDrafts([])}>חזור</Button>
              </div>

              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {drafts.map((d, idx) => (
                  <div key={idx} className="border rounded p-3 space-y-2 bg-secondary/20">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">{d.type === "flashcard" ? "פתוחה" : d.type === "multiple" ? "אמריקאית" : "נכון/לא נכון"}</Badge>
                      <Button size="icon" variant="ghost" onClick={() => removeDraft(idx)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <Input value={d.question} onChange={(e) => updateDraft(idx, { question: e.target.value })} placeholder="שאלה" />

                    {d.type === "flashcard" && (
                      <Textarea value={d.answer ?? ""} onChange={(e) => updateDraft(idx, { answer: e.target.value })} rows={2} placeholder="תשובה" />
                    )}

                    {d.type === "multiple" && (
                      <div className="space-y-1">
                        {(d.options ?? []).map((opt, oi) => (
                          <div key={oi} className="flex items-center gap-2">
                            <Checkbox
                              checked={(d.correctIndices ?? []).includes(oi)}
                              onCheckedChange={(c) => {
                                const cur = d.correctIndices ?? [];
                                updateDraft(idx, { correctIndices: c ? [...cur, oi] : cur.filter((x) => x !== oi) });
                              }}
                            />
                            <Input value={opt} onChange={(e) => {
                              const newOpts = [...(d.options ?? [])];
                              newOpts[oi] = e.target.value;
                              updateDraft(idx, { options: newOpts });
                            }} />
                          </div>
                        ))}
                      </div>
                    )}

                    {d.type === "boolean" && (
                      <RadioGroup value={d.correct ? "true" : "false"} onValueChange={(v) => updateDraft(idx, { correct: v === "true" })}>
                        <div className="flex gap-4">
                          <div className="flex items-center gap-1"><RadioGroupItem value="true" id={`t-${idx}`} /><Label htmlFor={`t-${idx}`}>נכון</Label></div>
                          <div className="flex items-center gap-1"><RadioGroupItem value="false" id={`f-${idx}`} /><Label htmlFor={`f-${idx}`}>לא נכון</Label></div>
                        </div>
                      </RadioGroup>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2 border-t pt-3">
                <Label>חפיסות יעד (לפחות אחת)</Label>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {decks.map((d) => (
                    <Badge
                      key={d.id}
                      variant={selectedDeckIds.includes(d.id) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleDeck(d.id)}
                    >
                      {selectedDeckIds.includes(d.id) && <Check className="h-3 w-3 ml-1" />}
                      {d.name}
                    </Badge>
                  ))}
                </div>
              </div>

              {categoryOptions.length > 0 && (
                <div className="space-y-2">
                  <Label>קטגוריות (אופציונלי)</Label>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {categoryOptions.map((c) => (
                      <Badge
                        key={c.id}
                        variant={selectedCategoryNames.includes(c.name) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleCategory(c.name)}
                      >
                        {selectedCategoryNames.includes(c.name) && <Check className="h-3 w-3 ml-1" />}
                        {c.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => handleClose(false)}>ביטול</Button>
                <Button onClick={saveAll}><Check className="h-4 w-4 ml-1" /> שמור הכל</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}