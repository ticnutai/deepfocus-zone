import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronLeft, ListChecks, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStudy } from "@/lib/study/store";
import { CHUMASH_CHAPTERS, CHUMASH_EN, chumashSefariaUrl } from "@/lib/study/sefariaExt";
import { filterCardsByCategoryChain } from "@/lib/study/categoryCards";
import { SefariaTextViewer } from "./SefariaTextViewer";
import { StudySession } from "./StudySession";

const STORAGE_KEY = "chumash-learning-state";
const SFARIM = ["בראשית", "שמות", "ויקרא", "במדבר", "דברים"] as const;

interface SavedState { sefer?: string; perek?: number; }
function loadSaved(): SavedState {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveSt(s: SavedState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
function toGematria(n: number): string {
  if (n <= 0) return "";
  let s = "";
  if (n >= 100) { s += "ק"; n -= 100; }
  if (n === 15) return s + "טו";
  if (n === 16) return s + "טז";
  const t = Math.floor(n / 10);
  const o = n % 10;
  if (t > 0) s += TENS[t];
  if (o > 0) s += ONES[o];
  return s;
}

export function ChumashLearningTab() {
  const { state } = useStudy();
  const saved = useMemo(() => loadSaved(), []);

  const [sefer, setSefer] = useState<string>(saved.sefer ?? "בראשית");
  const [perek, setPerek] = useState<number>(saved.perek ?? 1);
  const [studyOpen, setStudyOpen] = useState(false);

  useEffect(() => { saveSt({ sefer, perek }); }, [sefer, perek]);

  const totalChapters = CHUMASH_CHAPTERS[sefer] ?? 1;

  useEffect(() => { if (perek > totalChapters) setPerek(1); }, [sefer, totalChapters, perek]);

  const cards = useMemo(() => filterCardsByCategoryChain(
    state.cards,
    state.categories,
    [sefer, `פרק ${toGematria(perek)}`],
  ), [state.cards, state.categories, sefer, perek]);
  const cardIds = useMemo(() => cards.map((c) => c.id), [cards]);

  const externalUrl = chumashSefariaUrl(sefer, perek);
  const en = CHUMASH_EN[sefer];
  const sefariaRef = en ? `${en}.${perek}` : "";

  if (studyOpen && cardIds.length > 0) {
    return <StudySession deckId={null} mode="practice" cardIds={cardIds} onExit={() => setStudyOpen(false)} />;
  }

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="gold-frame p-3 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Select value={sefer} onValueChange={(v) => { setSefer(v); setPerek(1); }}>
            <SelectTrigger><SelectValue placeholder="ספר" /></SelectTrigger>
            <SelectContent>
              {SFARIM.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(perek)} onValueChange={(v) => setPerek(Number(v))}>
            <SelectTrigger><SelectValue placeholder="פרק" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {Array.from({ length: totalChapters }, (_, i) => i + 1).map((p) => (
                <SelectItem key={p} value={String(p)}>פרק {toGematria(p)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button onClick={() => setPerek(Math.max(1, perek - 1))} disabled={perek === 1} variant="outline" size="sm" className="gap-1">
            <ChevronRight className="h-4 w-4" /> הקודם
          </Button>
          <div className="text-sm text-muted-foreground">
            {sefer} · פרק {toGematria(perek)} · <span className="text-gold font-semibold">{cards.length} שאלות</span>
          </div>
          <Button onClick={() => setPerek(Math.min(totalChapters, perek + 1))} disabled={perek === totalChapters} variant="outline" size="sm" className="gap-1">
            הבא <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ height: "calc(100vh - 320px)", minHeight: 500 }}>
        <div className="min-h-0">
          {en ? (
            <SefariaTextViewer
              sefariaRef={sefariaRef}
              externalUrl={externalUrl}
              title={`${sefer} · פרק ${toGematria(perek)}`}
              className="h-full"
            />
          ) : (
            <Card className="gold-frame p-6 h-full flex items-center justify-center text-muted-foreground text-sm">
              ספר לא נתמך
            </Card>
          )}
        </div>
        <div className="min-h-0">
          <Card className="gold-frame p-4 flex flex-col h-full">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1">
                <ListChecks className="h-4 w-4 text-gold" /> שאלות לפרק זה ({cards.length})
              </h3>
              {cards.length > 0 && (
                <Button onClick={() => setStudyOpen(true)} size="sm" className="bg-gradient-navy text-primary-foreground">
                  <GraduationCap className="h-4 w-4" /> תרגול
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {cards.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-12">
                  אין שאלות משויכות.<br />
                  <span className="text-xs">שייך שאלות לקטגוריית "{sefer} › פרק {toGematria(perek)}".</span>
                </div>
              ) : (
                cards.map((c, i) => (
                  <div key={c.id} className="rounded-lg border border-gold/30 bg-card p-3 hover:border-gold/60 transition-colors">
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-gold font-bold shrink-0 mt-0.5">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground">{c.question}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
