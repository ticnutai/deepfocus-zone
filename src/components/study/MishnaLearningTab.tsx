import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronLeft, ListChecks, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStudy } from "@/lib/study/store";
import { MISHNAYOT_DATA } from "@/lib/study/mishnayotData";
import { mishnaSefariaUrl, MISHNA_MASECHTA_EN } from "@/lib/study/sefariaExt";
import { filterCardsByCategoryChain } from "@/lib/study/categoryCards";
import { SefariaTextViewer } from "./SefariaTextViewer";
import { StudySession } from "./StudySession";

const STORAGE_KEY = "mishna-learning-state";

interface SavedState { seder?: string; masechta?: string; perek?: number; mishna?: number; }
function loadSaved(): SavedState {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveSt(s: SavedState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// המרת מספר פרק/משנה ל"פרק א", "משנה ב" — תואם לתבנית הקטגוריות שיצרנו
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

export function MishnaLearningTab() {
  const { state } = useStudy();
  const saved = useMemo(() => loadSaved(), []);

  const [sederName, setSederName] = useState<string>(saved.seder ?? "זרעים");
  const [masechta, setMasechta] = useState<string>(saved.masechta ?? "ברכות");
  const [perek, setPerek] = useState<number>(saved.perek ?? 1);
  const [mishna, setMishna] = useState<number>(saved.mishna ?? 1);
  const [studyOpen, setStudyOpen] = useState(false);

  useEffect(() => { saveSt({ seder: sederName, masechta, perek, mishna }); }, [sederName, masechta, perek, mishna]);

  const seder = MISHNAYOT_DATA.find((s) => s.name === sederName);
  const masechtot = seder?.masechtot ?? [];
  const currentMasechet = masechtot.find((m) => m.name === masechta);
  const chapters = currentMasechet?.chapters ?? [];
  const mishnayotInPerek = chapters[perek - 1] ?? 0;

  // אם המסכת אינה בסדר הנוכחי — אפס
  useEffect(() => {
    if (!masechtot.find((m) => m.name === masechta)) {
      setMasechta(masechtot[0]?.name ?? "");
      setPerek(1); setMishna(1);
    }
  }, [sederName, masechtot, masechta]);

  useEffect(() => {
    if (perek > chapters.length) { setPerek(1); setMishna(1); }
    else if (mishna > mishnayotInPerek) setMishna(1);
  }, [chapters.length, perek, mishna, mishnayotInPerek]);

  const cards = useMemo(() => filterCardsByCategoryChain(
    state.cards,
    state.categories,
    [masechta, `פרק ${toGematria(perek)}`, `משנה ${toGematria(mishna)}`],
  ), [state.cards, state.categories, masechta, perek, mishna]);
  const cardIds = useMemo(() => cards.map((c) => c.id), [cards]);

  // ניווט משנה הבאה/קודמת
  const goNext = () => {
    if (mishna < mishnayotInPerek) { setMishna(mishna + 1); return; }
    if (perek < chapters.length) { setPerek(perek + 1); setMishna(1); }
  };
  const goPrev = () => {
    if (mishna > 1) { setMishna(mishna - 1); return; }
    if (perek > 1) { setPerek(perek - 1); setMishna(chapters[perek - 2] ?? 1); }
  };
  const isFirst = perek === 1 && mishna === 1;
  const isLast = perek === chapters.length && mishna === mishnayotInPerek;

  const isSupported = !!MISHNA_MASECHTA_EN[masechta];
  const externalUrl = mishnaSefariaUrl(masechta, perek, mishna);
  const sefariaRef = isSupported
    ? `Mishnah_${MISHNA_MASECHTA_EN[masechta].replace(/\s+/g, "_")}.${perek}.${mishna}`
    : "";

  if (studyOpen && cardIds.length > 0) {
    return <StudySession deckId={null} mode="practice" cardIds={cardIds} onExit={() => setStudyOpen(false)} />;
  }

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="gold-frame p-3 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Select value={sederName} onValueChange={(v) => { setSederName(v); }}>
            <SelectTrigger><SelectValue placeholder="סדר" /></SelectTrigger>
            <SelectContent>
              {MISHNAYOT_DATA.map((s) => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={masechta} onValueChange={(v) => { setMasechta(v); setPerek(1); setMishna(1); }}>
            <SelectTrigger><SelectValue placeholder="מסכת" /></SelectTrigger>
            <SelectContent>
              {masechtot.map((m) => <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(perek)} onValueChange={(v) => { setPerek(Number(v)); setMishna(1); }}>
            <SelectTrigger><SelectValue placeholder="פרק" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {chapters.map((_c, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>פרק {toGematria(i + 1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(mishna)} onValueChange={(v) => setMishna(Number(v))}>
            <SelectTrigger><SelectValue placeholder="משנה" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {Array.from({ length: mishnayotInPerek }, (_, i) => i + 1).map((m) => (
                <SelectItem key={m} value={String(m)}>משנה {toGematria(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button onClick={goPrev} disabled={isFirst} variant="outline" size="sm" className="gap-1">
            <ChevronRight className="h-4 w-4" /> הקודמת
          </Button>
          <div className="text-sm text-muted-foreground">
            {masechta} · פרק {toGematria(perek)} · משנה {toGematria(mishna)} ·{" "}
            <span className="text-gold font-semibold">{cards.length} שאלות</span>
          </div>
          <Button onClick={goNext} disabled={isLast} variant="outline" size="sm" className="gap-1">
            הבאה <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ height: "calc(100vh - 320px)", minHeight: 500 }}>
        <div className="min-h-0">
          {isSupported ? (
            <SefariaTextViewer
              sefariaRef={sefariaRef}
              externalUrl={externalUrl}
              title={`${masechta} · פרק ${toGematria(perek)} · משנה ${toGematria(mishna)}`}
              className="h-full"
            />
          ) : (
            <Card className="gold-frame p-6 h-full flex items-center justify-center text-muted-foreground text-sm">
              מסכת לא נתמכת ב-Sefaria
            </Card>
          )}
        </div>
        <div className="min-h-0">
          <Card className="gold-frame p-4 flex flex-col h-full">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1">
                <ListChecks className="h-4 w-4 text-gold" /> שאלות למשנה זו ({cards.length})
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
                  <span className="text-xs">
                    שייך שאלות לקטגוריית "{masechta} › פרק {toGematria(perek)} › משנה {toGematria(mishna)}".
                  </span>
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
