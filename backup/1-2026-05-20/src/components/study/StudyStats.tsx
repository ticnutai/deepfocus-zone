import { useMemo } from "react";
import { TrendingUp, Target, Flame, Clock, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useStudy } from "@/lib/study/store";

export function StudyStats({ deckId }: { deckId?: string }) {
  const { state } = useStudy();

  const stats = useMemo(() => {
    const cards = deckId ? state.cards.filter((c) => c.deckId === deckId) : state.cards;
    const logs = deckId ? state.logs.filter((l) => l.deckId === deckId) : state.logs;

    const total = cards.length;
    const totalReviews = logs.length;
    const correctReviews = logs.filter((l) => l.correct).length;
    const accuracy = totalReviews ? Math.round((correctReviews / totalReviews) * 100) : 0;
    const dueNow = cards.filter((c) => c.srs.dueAt <= Date.now()).length;
    const mastered = cards.filter((c) => c.srs.repetitions >= 3 && c.srs.ease >= 2.3).length;

    // Streak: consecutive days with at least one review
    const days = new Set<string>();
    logs.forEach((l) => days.add(new Date(l.at).toDateString()));
    let streak = 0;
    const d = new Date();
    while (days.has(d.toDateString())) {
      streak++;
      d.setDate(d.getDate() - 1);
    }

    const avgDuration = totalReviews
      ? Math.round(logs.reduce((a, l) => a + l.durationMs, 0) / totalReviews / 1000)
      : 0;

    return { total, totalReviews, accuracy, dueNow, mastered, streak, avgDuration };
  }, [state, deckId]);

  const items = [
    { label: "כרטיסים", value: stats.total, icon: Target },
    { label: "לחזרה היום", value: stats.dueNow, icon: Clock },
    { label: "% הצלחה", value: `${stats.accuracy}%`, icon: TrendingUp },
    { label: "נשלטו", value: stats.mastered, icon: CheckCircle2 },
    { label: "רצף ימים", value: stats.streak, icon: Flame },
    { label: "סהכ חזרות", value: stats.totalReviews, icon: TrendingUp },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {items.map(({ label, value, icon: Icon }) => (
        <Card key={label} className="gold-frame p-4 text-center">
          <span className="gold-icon-circle h-8 w-8 mx-auto"><Icon className="h-4 w-4" /></span>
          <div className="font-display text-2xl font-bold text-foreground mt-2">{value}</div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </Card>
      ))}
    </div>
  );
}
