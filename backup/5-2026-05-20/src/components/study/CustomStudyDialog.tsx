import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useStudy } from "@/lib/study/store";
import { Filter, Play } from "lucide-react";

export type CustomStudyFilter =
  | "due"
  | "lapses"
  | "young"
  | "mature"
  | "new"
  | "tag"
  | "hardest"
  | "recent";

interface Props {
  deckId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onStart: (cardIds: string[]) => void;
}

const FILTER_LABELS: Record<CustomStudyFilter, string> = {
  due: "כרטיסים לחזרה היום",
  lapses: "כרטיסים שנכשלו (leeches)",
  young: "כרטיסים צעירים (interval < 21 ימים)",
  mature: "כרטיסים בשלים (interval ≥ 21 ימים)",
  new: "כרטיסים חדשים (לא נלמדו)",
  tag: "לפי תגית",
  hardest: "הקשים ביותר (אחוז הצלחה נמוך)",
  recent: "נוספו לאחרונה (7 ימים)",
};

export function CustomStudyDialog({ deckId, open, onOpenChange, onStart }: Props) {
  const { state } = useStudy();
  const [filter, setFilter] = useState<CustomStudyFilter>("lapses");
  const [tag, setTag] = useState<string>("");
  const [limit, setLimit] = useState(20);

  const deckCards = useMemo(
    () => state.cards.filter((c) => c.deckId === deckId),
    [state.cards, deckId],
  );

  const allTags = useMemo(() => {
    const set = new Set<string>();
    deckCards.forEach((c) => c.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [deckCards]);

  const matched = useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    let pool = deckCards;
    switch (filter) {
      case "due":
        pool = pool.filter((c) => c.srs.dueAt <= now);
        break;
      case "lapses":
        pool = pool.filter((c) => (c.srs.lapses ?? 0) >= 2 || c.stats.incorrect >= 3);
        break;
      case "young":
        pool = pool.filter((c) => c.srs.interval > 0 && c.srs.interval < 21);
        break;
      case "mature":
        pool = pool.filter((c) => c.srs.interval >= 21);
        break;
      case "new":
        pool = pool.filter((c) => !c.srs.lastReviewedAt);
        break;
      case "tag":
        pool = tag ? pool.filter((c) => c.tags.includes(tag)) : [];
        break;
      case "hardest": {
        pool = pool
          .filter((c) => c.stats.totalReviews >= 3)
          .sort((a, b) => {
            const aAcc = a.stats.correct / a.stats.totalReviews;
            const bAcc = b.stats.correct / b.stats.totalReviews;
            return aAcc - bAcc;
          });
        break;
      }
      case "recent":
        pool = pool.filter((c) => now - c.createdAt <= 7 * day);
        break;
    }
    return pool.slice(0, Math.max(1, Math.min(200, limit)));
  }, [deckCards, filter, tag, limit]);

  const handleStart = () => {
    if (matched.length === 0) return;
    onStart(matched.map((c) => c.id));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 justify-end">
            <Filter className="h-5 w-5 text-gold" />
            לימוד מותאם
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>סוג סינון</Label>
            <Select value={filter} onValueChange={(v) => setFilter(v as CustomStudyFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(FILTER_LABELS) as CustomStudyFilter[]).map((k) => (
                  <SelectItem key={k} value={k}>{FILTER_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filter === "tag" && (
            <div className="space-y-2">
              <Label>תגית</Label>
              {allTags.length === 0 ? (
                <div className="text-sm text-muted-foreground">אין תגיות במערכת זו</div>
              ) : (
                <Select value={tag} onValueChange={setTag}>
                  <SelectTrigger><SelectValue placeholder="בחר תגית" /></SelectTrigger>
                  <SelectContent>
                    {allTags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>מספר כרטיסים מקסימלי</Label>
            <Input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value, 10) || 20)}
            />
          </div>

          <div className="rounded-xl border-2 border-gold/30 p-3 text-center">
            <Badge variant="outline" className="border-gold text-navy">
              {matched.length} כרטיסים יבחרו
            </Badge>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button
            onClick={handleStart}
            disabled={matched.length === 0}
            className="bg-gradient-navy text-primary-foreground"
          >
            <Play className="h-4 w-4" /> התחל
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
