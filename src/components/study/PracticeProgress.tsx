import { useMemo, useState } from "react";
import { Activity, BookOpen, CalendarDays, Play, Search, TrendingDown, TrendingUp, X } from "lucide-react";
import { useStudy } from "@/lib/study/store";
import type { PracticeResult } from "@/lib/study/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { dafLabel } from "@/lib/study/shasGen";
import { filterCardsForPlan } from "@/lib/study/quiz";
import { calculatePracticeTrend } from "@/lib/study/practiceProgress";
import { buildShasPracticeProgress } from "@/lib/study/shasPracticeProgress";
import { ShasProgressTree } from "./ShasProgressViews";

type PageFilter = { label?: string; masechta?: string; daf?: number; amud?: 1 | 2; cardIds?: string[] };

function readPageFilter(): PageFilter | null {
  try {
    const raw = localStorage.getItem("practice-progress-filter-v1");
    return raw ? JSON.parse(raw) as PageFilter : null;
  } catch { return null; }
}

function AttemptRow({ result, orphaned = false }: { result: PracticeResult; orphaned?: boolean }) {
  const date = new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short" }).format(result.completedAt);
  return (
    <div className="grid gap-2 rounded-xl border border-gold/30 bg-card p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
      <div className="min-w-0">
        <div className="truncate font-semibold">{result.sourceExamName || "תרגול כללי"}</div>
        <div className="text-xs text-muted-foreground">{date}</div>
      </div>
      {orphaned && <Badge variant="outline">בוצע בעבר כמבחן</Badge>}
      <span className="text-sm">{result.correct}/{result.total} נכונות</span>
      <strong className={cn("text-lg", result.score >= 80 ? "text-emerald-600" : result.score < 60 ? "text-destructive" : "text-foreground")}>{result.score}%</strong>
    </div>
  );
}

export function PracticeProgress({ initialTab = "overview" }: { initialTab?: "overview" | "general" | "exams" }) {
  const { state } = useStudy();
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState("");
  const [pageFilter, setPageFilter] = useState<PageFilter | null>(() => readPageFilter());
  const activeExamIds = useMemo(() => new Set([
    ...state.decks.map((deck) => deck.id),
    ...(state.quizPlans ?? []).map((plan) => plan.id),
  ]), [state.decks, state.quizPlans]);
  const resultLocationLabels = useMemo(() => {
    const labels = new Map<string, string[]>();
    const tree = buildShasPracticeProgress(state.practiceResults ?? [], state.cards ?? [], state.categories ?? []);
    for (const masechta of tree) for (const daf of masechta.dapim) for (const amud of daf.amudim) for (const attempt of amud.attempts) {
      const current = labels.get(attempt.result.id) ?? [];
      current.push(`מסכת ${masechta.masechta} דף ${dafLabel(daf.daf).replace(".", "")} עמוד ${amud.amud === 1 ? "א" : "ב"}`);
      labels.set(attempt.result.id, current);
    }
    return labels;
  }, [state.practiceResults, state.cards, state.categories]);

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("he");
    const filterIds = new Set(pageFilter?.cardIds ?? []);
    return [...(state.practiceResults ?? [])]
      .filter((result) => result.completed)
      .filter((result) => !pageFilter || result.answers.some((answer) =>
        (filterIds.size > 0 && answer.cardId && filterIds.has(answer.cardId)) ||
        (answer.masechta === pageFilter.masechta && answer.daf === pageFilter.daf && answer.amud === pageFilter.amud)
      ))
      .filter((result) => !q || [result.sourceExamName, new Date(result.completedAt).toLocaleDateString("he-IL"), ...(resultLocationLabels.get(result.id) ?? []), ...result.answers.map((answer) => answer.question)]
        .filter(Boolean).some((value) => String(value).toLocaleLowerCase("he").includes(q)))
      .sort((a, b) => b.completedAt - a.completedAt);
  }, [pageFilter, query, resultLocationLabels, state.practiceResults]);

  const formal = results.filter((result) => result.kind === "exam" && result.sourceExamId && activeExamIds.has(result.sourceExamId));
  const general = results.filter((result) => result.kind === "general" || !result.sourceExamId || !activeExamIds.has(result.sourceExamId));
  const shasTree = useMemo(() => buildShasPracticeProgress(results, state.cards ?? [], state.categories ?? []), [results, state.cards, state.categories]);
  const mappedResultIds = useMemo(() => new Set(shasTree.flatMap((masechta) => masechta.dapim.flatMap((daf) => daf.amudim.flatMap((amud) => amud.attempts.map((attempt) => attempt.result.id))))), [shasTree]);
  const nonShasResults = results.filter((result) => !mappedResultIds.has(result.id));
  const overallTrend = calculatePracticeTrend(results);
  const average = results.length ? Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length) : 0;

  const startExam = (deckId: string) => {
    try { sessionStorage.setItem("practice-start-exam-v1", deckId); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("deepfocus:start-exam", { detail: { deckId } }));
  };
  const startQuizPlan = (planId: string) => {
    try { sessionStorage.setItem("practice-start-quiz-plan-v1", planId); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("deepfocus:start-quiz-plan", { detail: { planId } }));
  };

  return (
    <Card className="gold-frame space-y-4 p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold"><Activity className="h-5 w-5 text-gold" />התקדמות ותוצאות</h2>
          <p className="text-sm text-muted-foreground">כל ניסיון נשמר פעם אחת, כולל עבודה באופליין, ומציג שיפור או נסיגה לאורך זמן.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pr-9" placeholder="חיפוש מבחן או שאלה..." aria-label="חיפוש בתוצאות" />
        </div>
      </div>

      {pageFilter && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-gold/40 bg-gold/10 p-3">
          <span className="text-sm font-medium">מסונן לעמוד: {pageFilter.label ?? `${pageFilter.masechta ?? ""} ${pageFilter.daf ? dafLabel(pageFilter.daf) : ""}, עמוד ${pageFilter.amud === 1 ? "א׳" : "ב׳"}`}</span>
          <Button size="sm" variant="ghost" onClick={() => { setPageFilter(null); localStorage.removeItem("practice-progress-filter-v1"); }}><X className="h-4 w-4" />הצג הכול</Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><span className="text-xs text-muted-foreground">ממוצע כללי</span><strong className="mt-1 block text-3xl">{results.length ? `${average}%` : "—"}</strong></Card>
        <Card className="p-4"><span className="text-xs text-muted-foreground">ניסיונות שנשמרו</span><strong className="mt-1 block text-3xl">{results.length}</strong></Card>
        <Card className="p-4"><span className="text-xs text-muted-foreground">מגמה כללית</span><strong className={cn("mt-1 flex items-center gap-2 text-xl", overallTrend.delta != null && overallTrend.delta >= 5 ? "text-emerald-600" : overallTrend.delta != null && overallTrend.delta <= -5 ? "text-destructive" : "")}>{overallTrend.delta != null && overallTrend.delta >= 5 ? <TrendingUp /> : overallTrend.delta != null && overallTrend.delta <= -5 ? <TrendingDown /> : <Activity />} {overallTrend.label}{overallTrend.delta != null ? ` (${overallTrend.delta > 0 ? "+" : ""}${Math.round(overallTrend.delta)} נק׳)` : ""}</strong></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="overview">לפי מסכת ודף</TabsTrigger>
          <TabsTrigger value="general">תרגול כללי</TabsTrigger>
          <TabsTrigger value="exams">מבחנים</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4 pt-3">
          {shasTree.length ? <ShasProgressTree tree={shasTree} /> : <Empty text="עדיין אין תוצאות המשויכות למסכת, דף ועמוד. לאחר תרגול של עמוד הן יופיעו כאן." />}
          {nonShasResults.length > 0 && (
            <details className="rounded-2xl border border-gold/30 bg-muted/10 p-3">
              <summary className="cursor-pointer font-semibold">תוצאות נוספות ללא שיוך לעמוד ({nonShasResults.length})</summary>
              <div className="mt-3 space-y-2">{nonShasResults.slice(0, 20).map((result) => <AttemptRow key={result.id} result={result} orphaned={result.kind === "exam" && (!result.sourceExamId || !activeExamIds.has(result.sourceExamId))} />)}</div>
            </details>
          )}
        </TabsContent>
        <TabsContent value="general" className="space-y-2 pt-3">
          {general.length ? general.map((result) => <AttemptRow key={result.id} result={result} orphaned={result.kind === "exam"} />) : <Empty />}
        </TabsContent>
        <TabsContent value="exams" className="space-y-3 pt-3">
          {state.decks.map((deck) => {
            const attempts = formal.filter((result) => result.sourceExamId === deck.id);
            const linked = new Set((state.cardDecks ?? []).filter((item) => item.deckId === deck.id).map((item) => item.cardId));
            state.cards.filter((card) => card.deckId === deck.id).forEach((card) => linked.add(card.id));
            const priorKnowledge = general.filter((result) => result.questionIds.some((id) => linked.has(id)));
            const deckTrend = calculatePracticeTrend(attempts);
            const latest = attempts[0]?.score;
            const best = attempts.length ? Math.max(...attempts.map((item) => item.score)) : null;
            const averageScore = attempts.length ? Math.round(attempts.reduce((sum, item) => sum + item.score, 0) / attempts.length) : null;
            return (
              <Card key={deck.id} className="space-y-3 border-2 border-gold/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="flex items-center gap-2 font-bold"><BookOpen className="h-4 w-4 text-gold" />{deck.name}</h3><p className="text-xs text-muted-foreground">{attempts.length} ניסיונות רשמיים{priorKnowledge.length ? ` · ${priorKnowledge.length} תרגולי ידע קודם עם שאלות חופפות` : ""} · {deckTrend.label}</p>{attempts.length > 0 && <p className="mt-1 text-xs">אחרון {latest}% · שיא {best}% · ממוצע {averageScore}%</p>}</div>
                  <Button onClick={() => startExam(deck.id)}><Play className="h-4 w-4 fill-current" />התחל מבחן</Button>
                </div>
                {attempts.slice(0, 5).map((result) => <AttemptRow key={result.id} result={result} />)}
              </Card>
            );
          })}
          {(state.quizPlans ?? []).map((plan) => {
            const attempts = formal.filter((result) => result.sourceExamId === plan.id);
            const ids = new Set(filterCardsForPlan(state.cards, plan).map((card) => card.id));
            const priorKnowledge = general.filter((result) => result.questionIds.some((id) => ids.has(id)));
            const planTrend = calculatePracticeTrend(attempts);
            return <Card key={plan.id} className="space-y-3 border-2 border-gold/30 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">{plan.name}</h3><p className="text-xs text-muted-foreground">תוכנית בחינה · {attempts.length} ניסיונות{priorKnowledge.length ? ` · ${priorKnowledge.length} תרגולי ידע קודם` : ""} · {planTrend.label}</p></div><Button onClick={() => startQuizPlan(plan.id)}><Play className="h-4 w-4 fill-current" />התחל מבחן</Button></div>{attempts.slice(0, 5).map((result) => <AttemptRow key={result.id} result={result} />)}</Card>;
          })}
          {!state.decks.length && !(state.quizPlans ?? []).length && <Empty text="אין מבחנים פעילים. תוצאות של מבחנים שנמחקו נשמרות בתרגול הכללי." />}
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function Empty({ text = "עדיין אין תוצאות מתאימות. לאחר סיום תרגול הן יופיעו כאן לפי תאריך." }: { text?: string }) {
  return <div className="rounded-xl border-2 border-dashed border-gold/30 p-8 text-center text-sm text-muted-foreground"><CalendarDays className="mx-auto mb-2 h-7 w-7 text-gold" />{text}</div>;
}
