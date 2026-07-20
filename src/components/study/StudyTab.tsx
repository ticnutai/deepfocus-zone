import { useState, useMemo, useEffect, lazy, Suspense } from "react";
import { Brain, Play, BookOpen, ChevronDown, ChevronUp, Filter, Eye, EyeOff, Zap } from "lucide-react";
import { ReviewCalendar } from "./ReviewCalendar";
import { HeatmapPanel } from "./HeatmapPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStudy } from "@/lib/study/store";
import { isDue, buildStudyQueue } from "@/lib/study/srs";
import { StudySession } from "./StudySession";
import { StudyStats } from "./StudyStats";
const ForecastPanel = lazy(() => import("./ForecastPanel").then(m => ({ default: m.ForecastPanel })));
import { CustomStudyDialog } from "./CustomStudyDialog";
import { SrsAlgorithmSettings } from "./SrsAlgorithmSettings";
import { WidgetGrid } from "./WidgetGrid";
import { cn } from "@/lib/utils";
import type { StudyMode } from "@/lib/study/types";

interface Props {
  showBadge?: boolean;
  onToggleBadge?: () => void;
}

export function StudyTab({ showBadge = true, onToggleBadge }: Props) {
  const { state } = useStudy();
  const [activeDeckId, setActiveDeckId] = useState<string | null>(state.decks[0]?.id ?? null);
  const [session, setSession] = useState<{ deckId: string | null; mode: StudyMode; cardIds?: string[]; timeLimitSec?: number } | null>(null);
  const [showAllDecks, setShowAllDecks] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

  // All deck stats — computed before early return to satisfy Rules of Hooks
  const deckStats = useMemo(() => {
    const catNameById = new Map((state.categories ?? []).map((c) => [c.id, c.name]));
    const childrenOf = new Map<string | null, string[]>();
    (state.categories ?? []).forEach((c) => {
      const key = c.parentId ?? null;
      const arr = childrenOf.get(key) ?? [];
      arr.push(c.id);
      childrenOf.set(key, arr);
    });
    const expandCatIds = (rootIds: string[], includeSubs: boolean): Set<string> => {
      const result = new Set<string>(rootIds);
      if (!includeSubs) return result;
      const stack = [...rootIds];
      while (stack.length) {
        const id = stack.pop()!;
        (childrenOf.get(id) ?? []).forEach((childId) => {
          if (!result.has(childId)) { result.add(childId); stack.push(childId); }
        });
      }
      return result;
    };
    return state.decks.map((deck) => {
      const linkedIds = new Set((state.cardDecks ?? []).filter((l) => l.deckId === deck.id).map((l) => l.cardId));
      const effectiveCatIds = expandCatIds(deck.categoryIds ?? [], deck.includeSubCategories !== false);
      const catNames = new Set(
        [...effectiveCatIds].map((id) => catNameById.get(id)).filter(Boolean) as string[]
      );
      const cards = state.cards.filter((c) =>
        c.deckId === deck.id ||
        linkedIds.has(c.id) ||
        (catNames.size > 0 && c.tags?.some((t) => t.startsWith("cat:") && catNames.has(t.slice(4))))
      );
      const dueCount = cards.filter(isDue).length;
      return { deck, total: cards.length, dueCount };
    });
  }, [state.decks, state.cards, state.cardDecks, state.categories]);

  // Quick Review: top 10 most urgent cards across ALL decks (priority-ordered).
  // Computed before any early return to satisfy Rules of Hooks.
  const quickReviewIds = useMemo(() => {
    const queue = buildStudyQueue(state.cards);
    return queue.slice(0, 10).map((c) => c.id);
  }, [state.cards]);


  // Heavy derived data: memoize so it does not recompute on every store mutation.
  const { activeDeck, activeDeckCards, activeDeckDue } = useMemo(() => {
    const deck = state.decks.find((d) => d.id === activeDeckId);
    if (!deck) return { activeDeck: undefined, activeDeckCards: [] as typeof state.cards, activeDeckDue: 0 };
    const linkedIds = new Set((state.cardDecks ?? []).filter((l) => l.deckId === activeDeckId).map((l) => l.cardId));
    const childrenOf = new Map<string | null, string[]>();
    (state.categories ?? []).forEach((c) => {
      const key = c.parentId ?? null;
      const arr = childrenOf.get(key) ?? [];
      arr.push(c.id);
      childrenOf.set(key, arr);
    });
    const expanded = new Set<string>(deck.categoryIds ?? []);
    if (deck.includeSubCategories !== false) {
      const stack = [...(deck.categoryIds ?? [])];
      while (stack.length) {
        const id = stack.pop()!;
        (childrenOf.get(id) ?? []).forEach((childId) => {
          if (!expanded.has(childId)) { expanded.add(childId); stack.push(childId); }
        });
      }
    }
    const catNames = new Set(
      [...expanded].map((id) => state.categories?.find((c) => c.id === id)?.name).filter(Boolean) as string[]
    );
    const cards = state.cards.filter((c) =>
      c.deckId === activeDeckId ||
      linkedIds.has(c.id) ||
      (catNames.size > 0 && c.tags?.some((t) => t.startsWith("cat:") && catNames.has(t.slice(4))))
    );
    return { activeDeck: deck, activeDeckCards: cards, activeDeckDue: cards.filter(isDue).length };
  }, [state.decks, state.cards, state.cardDecks, state.categories, activeDeckId]);

  if (session) {
    return (
      <div className="space-y-4">
        <StudySession
          deckId={session.deckId}
          mode={session.mode}
          cardIds={session.cardIds}
          timeLimitSec={session.timeLimitSec}
          onExit={() => setSession(null)}
        />
      </div>
    );
  }

  const totalDue = deckStats.reduce((s, d) => s + d.dueCount, 0);
  const displayedDecks = showAllDecks ? deckStats : deckStats.slice(0, 5);


  const widgetMap: Record<string, React.ReactNode> = {
    "study-calendar": <ReviewCalendar deckId={activeDeckId ?? undefined} showTodayBadge={showBadge} />,

    "study-heatmap": <HeatmapPanel days={35} />,

    "study-stats": <StudyStats deckId={activeDeckId ?? undefined} />,

    "study-decks": (
      <Card className="gold-frame p-4 space-y-3" dir="rtl">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold flex items-center gap-1">
            <BookOpen className="h-4 w-4 text-gold" /> מערכות
          </h4>
          <div className="flex items-center gap-2">
            {totalDue > 0 && (
              <span className="text-xs rounded-full px-2 py-0.5 border border-gold/50 bg-gold/10 text-gold font-semibold">
                {totalDue} לחזרה בסה&quot;כ
              </span>
            )}
            {onToggleBadge && (
              <button
                onClick={onToggleBadge}
                title={showBadge ? 'הסתר מד "למדתי היום"' : 'הצג מד "למדתי היום"'}
                className="flex items-center justify-center h-7 w-7 rounded-lg border border-gold/50 bg-card text-muted-foreground hover:text-gold hover:border-gold transition-colors"
              >
                {showBadge ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>

        {state.decks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            אין מערכות עדיין. הוסף מערכת בלשונית &quot;שאלות חזרה&quot;.
          </p>
        ) : (
          <div className="space-y-1.5">
            {displayedDecks.map(({ deck, total, dueCount }) => (
              <button
                key={deck.id}
                onClick={() => setActiveDeckId(deck.id)}
                className={cn(
                  "w-full flex items-center justify-between gap-3 rounded-xl border-2 px-3 py-2.5 transition-colors text-right",
                  activeDeckId === deck.id
                    ? "border-gold bg-gold/10"
                    : "border-gold/30 bg-card hover:border-gold/60",
                )}
              >
                <div className="flex items-center gap-2 shrink-0">
                  {dueCount > 0 && (
                    <span className="text-[11px] font-bold rounded-full px-1.5 py-0.5 bg-gradient-navy text-primary-foreground min-w-[1.5rem] text-center">
                      {dueCount}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{total} כרטיסים</span>
                </div>
                <span className="font-medium text-sm text-foreground">{deck.name}</span>
              </button>
            ))}
            {deckStats.length > 5 && (
              <button
                onClick={() => setShowAllDecks((v) => !v)}
                className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
              >
                {showAllDecks ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showAllDecks ? "הצג פחות" : `הצג עוד ${deckStats.length - 5}`}
              </button>
            )}
          </div>
        )}
      </Card>
    ),

    "study-actions": (
      <Card className="gold-frame p-4 space-y-4" dir="rtl">
        <h4 className="text-sm font-semibold flex items-center gap-1">
          <Brain className="h-4 w-4 text-gold" /> פעולות לימוד
        </h4>
        {/* Quick Review — top 10 most urgent cards across ALL decks, 5-minute timer */}
        <Button
          disabled={quickReviewIds.length === 0}
          onClick={() => setSession({ deckId: null, mode: "srs", cardIds: quickReviewIds, timeLimitSec: 5 * 60 })}
          className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-xl py-5 shadow-elegant"
          title="10 הכרטיסים הדחופים ביותר מכל המערכות, עם טיימר 5 דקות"
        >
          <Zap className="h-5 w-5" /> חזרה מהירה — 5 דקות ({Math.min(quickReviewIds.length, 10)} כרטיסים)
        </Button>
        {!activeDeck ? (
          <p className="text-sm text-muted-foreground text-center py-4">בחר מערכת להתחיל</p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <Button
              disabled={activeDeckDue === 0}
              onClick={() => setSession({ deckId: activeDeck.id, mode: "srs", cardIds: activeDeckCards.map((c) => c.id) })}
              className="bg-gradient-navy text-primary-foreground rounded-xl py-5 shadow-elegant"
            >
              <Brain className="h-5 w-5" /> חזרה ממוקדת ({activeDeckDue})
            </Button>
            <Button
              disabled={activeDeckCards.length === 0}
              onClick={() => setSession({ deckId: activeDeck.id, mode: "practice", cardIds: activeDeckCards.map((c) => c.id) })}
              variant="outline"
              className="border-2 border-gold rounded-xl py-5 text-navy"
            >
              <Play className="h-5 w-5" /> תרגול חופשי
            </Button>
            <Button
              disabled={activeDeckCards.length === 0}
              onClick={() => setCustomOpen(true)}
              variant="outline"
              className="border-2 border-gold/60 rounded-xl py-5 text-navy"
            >
              <Filter className="h-5 w-5" /> לימוד מותאם
            </Button>
          </div>
        )}
        {activeDeck && (
          <CustomStudyDialog
            deckId={activeDeck.id}
            open={customOpen}
            onOpenChange={setCustomOpen}
            onStart={(cardIds) => setSession({ deckId: activeDeck.id, mode: "srs", cardIds })}
          />
        )}
      </Card>
    ),

    "study-forecast": activeDeck ? (
      <ForecastPanel deckId={activeDeck.id} />
    ) : (
      <Card className="gold-frame p-4 flex items-center justify-center text-sm text-muted-foreground min-h-[80px]">
        בחר מערכת לתחזית
      </Card>
    ),

    "study-settings": <SrsAlgorithmSettings />,
  };

  return (
    <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
      <WidgetGrid tabId="study" widgetMap={widgetMap} />
    </Suspense>
  );
}
