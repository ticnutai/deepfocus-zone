import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, BookOpen, Check, RotateCcw, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStudy } from "@/lib/study/store";
import { MISHNAYOT_DATA, TOTAL_MISHNAYOT, type MishnayotSeder, type MishnayotMasechet } from "@/lib/study/mishnayotData";

// Hebrew numbering for mishnayot (1..30 covers all)
const HEB_LETTERS = [
  "א","ב","ג","ד","ה","ו","ז","ח","ט","י",
  "יא","יב","יג","יד","טו","טז","יז","יח","יט","כ",
  "כא","כב","כג","כד","כה","כו","כז","כח","כט","ל",
];
const heb = (n: number) => HEB_LETTERS[n - 1] ?? String(n);

type Progress = Record<string, Record<string, Record<number, number[]>>>;

function countLearnedInMasechet(progress: Progress, sederName: string, masechet: MishnayotMasechet): number {
  const m = progress?.[sederName]?.[masechet.name];
  if (!m) return 0;
  let total = 0;
  for (const arr of Object.values(m)) total += new Set(arr).size;
  return total;
}

function countTotalInMasechet(m: MishnayotMasechet): number {
  return m.chapters.reduce((a, b) => a + b, 0);
}

function isMishnaLearned(progress: Progress, sederName: string, masechetName: string, perek: number, mishna: number): boolean {
  return !!progress?.[sederName]?.[masechetName]?.[perek]?.includes(mishna);
}

export function MishnayotTracker() {
  const { state, setUiPref } = useStudy();
  const progress: Progress = useMemo(() => state.uiPrefs?.mishnayotProgress ?? {}, [state.uiPrefs?.mishnayotProgress]);

  const [selectedSeder, setSelectedSeder] = useState<string | null>(null);
  const [selectedMasechet, setSelectedMasechet] = useState<string | null>(null);

  useEffect(() => { document.title = "מעקב משניות | מעקב למידה"; }, []);

  const totalLearned = useMemo(() => {
    let n = 0;
    for (const seder of MISHNAYOT_DATA) {
      for (const m of seder.masechtot) n += countLearnedInMasechet(progress, seder.name, m);
    }
    return n;
  }, [progress]);

  const overallPct = Math.round((totalLearned / TOTAL_MISHNAYOT) * 100);

  const toggleMishna = (sederName: string, masechetName: string, perek: number, mishna: number) => {
    const next: Progress = JSON.parse(JSON.stringify(progress ?? {}));
    next[sederName] ??= {};
    next[sederName][masechetName] ??= {};
    const arr = next[sederName][masechetName][perek] ?? [];
    const has = arr.includes(mishna);
    next[sederName][masechetName][perek] = has ? arr.filter((x) => x !== mishna) : [...arr, mishna];
    setUiPref("mishnayotProgress", next);
  };

  const togglePerekAll = (sederName: string, masechet: MishnayotMasechet, perek: number) => {
    const total = masechet.chapters[perek - 1];
    const learned = progress?.[sederName]?.[masechet.name]?.[perek] ?? [];
    const allLearned = learned.length === total;
    const next: Progress = JSON.parse(JSON.stringify(progress ?? {}));
    next[sederName] ??= {};
    next[sederName][masechet.name] ??= {};
    next[sederName][masechet.name][perek] = allLearned ? [] : Array.from({ length: total }, (_, i) => i + 1);
    setUiPref("mishnayotProgress", next);
  };

  const resetMasechet = (sederName: string, masechetName: string) => {
    const next: Progress = JSON.parse(JSON.stringify(progress ?? {}));
    if (next[sederName]) next[sederName][masechetName] = {};
    setUiPref("mishnayotProgress", next);
  };

  // ============== VIEW: Mishnayot grid for selected masechet ==============
  if (selectedSeder && selectedMasechet) {
    const seder = MISHNAYOT_DATA.find((s) => s.name === selectedSeder)!;
    const masechet = seder.masechtot.find((m) => m.name === selectedMasechet)!;
    const totalInMasechet = countTotalInMasechet(masechet);
    const learnedInMasechet = countLearnedInMasechet(progress, seder.name, masechet);
    const pct = Math.round((learnedInMasechet / totalInMasechet) * 100);

    return (
      <div className="space-y-4" dir="rtl">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setSelectedMasechet(null)} className="gap-1">
            <ChevronLeft className="h-4 w-4" />חזרה למסכתות
          </Button>
          <h2 className="font-display text-2xl font-bold text-foreground">משנה {masechet.name}</h2>
          <Badge variant="outline" className="border-gold/60">{learnedInMasechet}/{totalInMasechet} ({pct}%)</Badge>
          <Button variant="ghost" size="sm" onClick={() => resetMasechet(seder.name, masechet.name)} className="gap-1 mr-auto text-destructive">
            <RotateCcw className="h-4 w-4" />איפוס מסכת
          </Button>
        </div>
        <Progress value={pct} className="h-2" />

        <div className="space-y-3">
          {masechet.chapters.map((mishnayotCount, idx) => {
            const perek = idx + 1;
            const learnedArr = progress?.[seder.name]?.[masechet.name]?.[perek] ?? [];
            const perekPct = Math.round((learnedArr.length / mishnayotCount) * 100);
            return (
              <Card key={perek} className="gold-frame p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="gold-icon-circle"><Layers className="h-4 w-4" /></span>
                    <h3 className="font-display text-lg font-semibold">פרק {heb(perek)}</h3>
                    <Badge variant="secondary">{learnedArr.length}/{mishnayotCount}</Badge>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => togglePerekAll(seder.name, masechet, perek)}>
                    {learnedArr.length === mishnayotCount ? "בטל סימון כל הפרק" : "סמן כל הפרק"}
                  </Button>
                </div>
                <Progress value={perekPct} className="h-1.5" />
                <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
                  {Array.from({ length: mishnayotCount }, (_, i) => i + 1).map((mishna) => {
                    const learned = isMishnaLearned(progress, seder.name, masechet.name, perek, mishna);
                    return (
                      <button
                        key={mishna}
                        onClick={() => toggleMishna(seder.name, masechet.name, perek, mishna)}
                        className={cn(
                          "h-12 rounded-lg border-2 text-sm font-semibold transition-all flex items-center justify-center gap-1",
                          learned
                            ? "bg-gradient-navy text-primary-foreground border-gold shadow-elegant"
                            : "bg-card text-foreground border-gold/40 hover:border-gold hover:bg-secondary",
                        )}
                        aria-label={`משנה ${heb(mishna)}`}
                      >
                        {learned && <Check className="h-3 w-3" />}
                        <span>משנה {heb(mishna)}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // ============== VIEW: Masechtot grid for selected seder ==============
  if (selectedSeder) {
    const seder = MISHNAYOT_DATA.find((s) => s.name === selectedSeder)!;
    const sederTotal = seder.masechtot.reduce((a, m) => a + countTotalInMasechet(m), 0);
    const sederLearned = seder.masechtot.reduce((a, m) => a + countLearnedInMasechet(progress, seder.name, m), 0);
    const pct = Math.round((sederLearned / sederTotal) * 100);

    return (
      <div className="space-y-4" dir="rtl">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setSelectedSeder(null)} className="gap-1">
            <ChevronLeft className="h-4 w-4" />חזרה לסדרים
          </Button>
          <h2 className="font-display text-2xl font-bold text-foreground">סדר {seder.name}</h2>
          <Badge variant="outline" className="border-gold/60">{sederLearned}/{sederTotal} ({pct}%)</Badge>
        </div>
        <Progress value={pct} className="h-2" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {seder.masechtot.map((m) => {
            const total = countTotalInMasechet(m);
            const learned = countLearnedInMasechet(progress, seder.name, m);
            const mPct = Math.round((learned / total) * 100);
            return (
              <Card
                key={m.name}
                onClick={() => setSelectedMasechet(m.name)}
                className="gold-frame p-4 cursor-pointer hover:shadow-elegant transition-all space-y-2"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-semibold">משנה {m.name}</h3>
                  <span className="gold-icon-circle"><BookOpen className="h-4 w-4" /></span>
                </div>
                <div className="text-xs text-muted-foreground">{m.chapters.length} פרקים · {total} משניות</div>
                <Progress value={mPct} className="h-1.5" />
                <div className="text-xs text-foreground font-medium">{learned}/{total} ({mPct}%)</div>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // ============== VIEW: Six Sedarim ==============
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="font-display text-2xl font-bold text-foreground">מעקב משניות</h2>
        <Badge variant="outline" className="border-gold/60">{totalLearned}/{TOTAL_MISHNAYOT} ({overallPct}%)</Badge>
      </div>
      <Progress value={overallPct} className="h-2" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MISHNAYOT_DATA.map((seder) => {
          const total = seder.masechtot.reduce((a, m) => a + countTotalInMasechet(m), 0);
          const learned = seder.masechtot.reduce((a, m) => a + countLearnedInMasechet(progress, seder.name, m), 0);
          const pct = Math.round((learned / total) * 100);
          return (
            <Card
              key={seder.name}
              onClick={() => setSelectedSeder(seder.name)}
              className="gold-frame p-5 cursor-pointer hover:shadow-elegant transition-all space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl font-bold">סדר {seder.name}</h3>
                <span className="gold-icon-circle"><Layers className="h-4 w-4" /></span>
              </div>
              <div className="text-sm text-muted-foreground">
                {seder.masechtot.length} מסכתות · {total} משניות
              </div>
              <Progress value={pct} className="h-2" />
              <div className="text-sm text-foreground font-semibold">{learned}/{total} ({pct}%)</div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
