import { useMemo } from "react";
import { Layers, BookOpen } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useStudy } from "@/lib/study/store";
import type { Card as StudyCardType } from "@/lib/study/types";
import { toast } from "@/hooks/use-toast";

interface Props {
  card: StudyCardType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CardDecksDialog({ card, open, onOpenChange }: Props) {
  const { state, setCardDecks } = useStudy();

  const linkedDeckIds = useMemo(() => {
    if (!card) return new Set<string>();
    const ids = new Set<string>([card.deckId]);
    (state.cardDecks ?? []).forEach((l) => {
      if (l.cardId === card.id) ids.add(l.deckId);
    });
    return ids;
  }, [card, state.cardDecks]);

  if (!card) return null;

  const toggle = (deckId: string) => {
    const next = new Set(linkedDeckIds);
    // can't remove the primary deck via this dialog (use Copy/Move instead)
    if (deckId === card.deckId) {
      toast({ title: "זוהי המערכת הראשית", description: "כדי להחליף מערכת ראשית - גרור את השאלה למערכת אחרת." });
      return;
    }
    if (next.has(deckId)) next.delete(deckId);
    else next.add(deckId);
    // exclude primary - it's auto-included via cards.deck_id
    setCardDecks(card.id, Array.from(next).filter((id) => id !== card.deckId));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gold-frame" dir="rtl">
        <DialogHeader>
          <DialogTitle className="font-display text-right flex items-center gap-2 justify-end">
            <Layers className="h-5 w-5" /> שיוך למערכות
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground text-right">
            סמן את כל המערכות שהשאלה הזו צריכה להופיע בהן.
          </p>
          <div className="max-h-[400px] overflow-y-auto space-y-1">
            {state.decks.map((d) => {
              const checked = linkedDeckIds.has(d.id);
              const isPrimary = d.id === card.deckId;
              return (
                <label
                  key={d.id}
                  className="flex items-center gap-2 p-2 rounded-lg border-2 border-gold/30 hover:bg-secondary cursor-pointer"
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(d.id)} disabled={isPrimary} />
                  <BookOpen className="h-4 w-4 text-navy" />
                  <span className="flex-1 text-right text-sm">{d.name}</span>
                  {isPrimary && <span className="text-[10px] text-gold font-bold">ראשית</span>}
                </label>
              );
            })}
            {state.decks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">אין מערכות</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} className="bg-gradient-navy text-primary-foreground rounded-xl">
            סגור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}