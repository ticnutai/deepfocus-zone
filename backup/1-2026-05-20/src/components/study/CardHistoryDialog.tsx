import { useMemo } from "react";
import { History, Check, X, Clock, TrendingUp, Target } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useStudy } from "@/lib/study/store";
import type { Card as StudyCard } from "@/lib/study/types";
import { cn } from "@/lib/utils";

interface Props {
  card: StudyCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function relativeDue(ts: number) {
  const diff = ts - Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (diff < 0) {
    const days = Math.ceil(-diff / day);
    return `באיחור של ${days} ימים`;
  }
  const days = Math.ceil(diff / day);
  if (days === 0) return "היום";
  if (days === 1) return "מחר";
  return `בעוד ${days} ימים`;
}

export function CardHistoryDialog({ card, open, onOpenChange }: Props) {
  const { state } = useStudy();

  const logs = useMemo(() => {
    if (!card) return [];
    return state.logs.filter((l) => l.cardId === card.id).sort((a, b) => b.at - a.at);
  }, [state.logs, card]);

  if (!card) return null;

  const accuracy = card.stats.totalReviews
    ? Math.round((card.stats.correct / card.stats.totalReviews) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gold-frame max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="font-display text-right flex items-center gap-2 justify-end">
            היסטוריית חזרות
            <span className="gold-icon-circle"><History className="h-4 w-4" /></span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-secondary/40 border-2 border-gold/30 text-right">
            <Badge variant="outline" className="border-gold mb-2">
              {card.type === "flashcard" ? "כרטיסיה" : card.type === "multiple" ? "אמריקאית" : "נכון/לא נכון"}
            </Badge>
            <p className="font-medium text-foreground">{card.question}</p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border-2 border-gold/40 p-3 bg-card">
              <span className="gold-icon-circle h-7 w-7 mx-auto"><Target className="h-3.5 w-3.5" /></span>
              <div className="font-display text-xl font-bold mt-1">{card.stats.totalReviews}</div>
              <div className="text-[10px] text-muted-foreground">חזרות</div>
            </div>
            <div className="rounded-xl border-2 border-gold/40 p-3 bg-card">
              <span className="gold-icon-circle h-7 w-7 mx-auto"><TrendingUp className="h-3.5 w-3.5" /></span>
              <div className="font-display text-xl font-bold mt-1">{accuracy}%</div>
              <div className="text-[10px] text-muted-foreground">הצלחה</div>
            </div>
            <div className="rounded-xl border-2 border-gold/40 p-3 bg-card">
              <span className="gold-icon-circle h-7 w-7 mx-auto"><Clock className="h-3.5 w-3.5" /></span>
              <div className="font-display text-xl font-bold mt-1">{card.srs.repetitions}</div>
              <div className="text-[10px] text-muted-foreground">רצף SRS</div>
            </div>
          </div>

          <div className="rounded-xl border-2 border-gold/40 p-3 bg-card text-right space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground font-medium">{relativeDue(card.srs.dueAt)}</span>
              <span className="text-muted-foreground">חזרה הבאה:</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground font-medium">{card.srs.interval} ימים</span>
              <span className="text-muted-foreground">מרווח נוכחי:</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground font-medium">{(card.srs.ease ?? 2.5).toFixed(2)}</span>
              <span className="text-muted-foreground">מקדם קלות:</span>
            </div>
            <div className="flex justify-between">
              <span className="text-green-600 font-medium">✓ {card.stats.correct}</span>
              <span className="text-muted-foreground">נכונות:</span>
            </div>
            <div className="flex justify-between">
              <span className="text-destructive font-medium">✗ {card.stats.incorrect}</span>
              <span className="text-muted-foreground">שגיאות:</span>
            </div>
          </div>

          <div>
            <h4 className="font-display text-sm font-semibold text-right mb-2">לוג חזרות ({logs.length})</h4>
            <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
              {logs.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">עדיין לא נערכו חזרות</p>
              )}
              {logs.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg border border-gold/30 p-2 text-xs bg-card">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-gold/50 text-[10px]">איכות {l.quality}</Badge>
                    <span className="text-muted-foreground">{Math.round(l.durationMs / 1000)} ש'</span>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <span className="text-muted-foreground">{formatDate(l.at)}</span>
                    <span className={cn("h-6 w-6 rounded-full flex items-center justify-center",
                      l.correct ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                : "bg-destructive/10 text-destructive")}>
                      {l.correct ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
