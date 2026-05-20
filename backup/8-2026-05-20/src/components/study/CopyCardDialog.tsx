import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useStudy } from "@/lib/study/store";
import type { Card as StudyCardType } from "@/lib/study/types";
import { toast } from "@/hooks/use-toast";

// Local helper: union-accessible card type for reading optional variant fields
type AnyCard = StudyCardType & { answer?: string; options?: string[]; correctIndices?: number[]; explanation?: string; correct?: boolean };

interface Props {
  card: StudyCardType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CopyCardDialog({ card, open, onOpenChange }: Props) {
  const { state, duplicateCard, updateCard } = useStudy();
  const [mode, setMode] = useState<"duplicate" | "move" | "text">("duplicate");
  const [targetDeckId, setTargetDeckId] = useState<string>("");

  if (!card) return null;

  const currentDeck = state.decks.find((d) => d.id === card.deckId);
  const target = targetDeckId || card.deckId;

  const cardToText = (c: StudyCardType): string => {
    const ac = c as AnyCard;
    let text = `שאלה: ${c.question}\n`;
    if (c.type === "flashcard") text += `תשובה: ${ac.answer}\n`;
    if (c.type === "multiple") {
      text += `אפשרויות:\n`;
      (ac.options ?? []).forEach((o: string, i: number) => {
        const mark = (ac.correctIndices ?? []).includes(i) ? "✓ " : "  ";
        text += `${mark}${o}\n`;
      });
    }
    if (c.type === "boolean") {
      text += `תשובה: ${ac.correct ? "נכון" : "לא נכון"}\n`;
      if (ac.explanation) text += `הסבר: ${ac.explanation}\n`;
    }
    if (c.type === "combo") {
      if (ac.answer) text += `תשובה פתוחה: ${ac.answer}\n`;
      if (ac.options) {
        text += `אפשרויות:\n`;
        ac.options.forEach((o: string, i: number) => {
          const mark = (ac.correctIndices ?? []).includes(i) ? "✓ " : "  ";
          text += `${mark}${o}\n`;
        });
      }
    }
    if (c.tags.length) text += `תגיות: ${c.tags.join(", ")}\n`;
    return text;
  };

  const handleAction = async () => {
    if (mode === "duplicate") {
      duplicateCard(card.id, target);
      toast({ title: "השאלה הוכפלה", description: `נוצר עותק ב"${state.decks.find((d) => d.id === target)?.name}"` });
    } else if (mode === "move") {
      if (target === card.deckId) {
        toast({ title: "אותה מערכת", description: "בחר מערכת יעד אחרת" });
        return;
      }
      updateCard(card.id, { deckId: target });
      toast({ title: "השאלה הועברה", description: `הועברה ל"${state.decks.find((d) => d.id === target)?.name}"` });
    } else {
      try {
        await navigator.clipboard.writeText(cardToText(card));
        toast({ title: "הועתק ללוח!", description: "הטקסט מוכן להדבקה" });
      } catch {
        toast({ title: "שגיאה בהעתקה", variant: "destructive" });
      }
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gold-frame" dir="rtl">
        <DialogHeader>
          <DialogTitle className="font-display text-right flex items-center gap-2 justify-end">
            העתקה / העברה
            <Copy className="h-5 w-5 text-gold" />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-secondary/50 p-3 text-sm text-right">
            <span className="text-muted-foreground">שאלה: </span>
            <span className="font-medium">{card.question}</span>
            <div className="text-xs text-muted-foreground mt-1">
              מ: {currentDeck?.name}
            </div>
          </div>

          <div className="space-y-2">
            <Label>פעולה</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "duplicate" | "move" | "text")} className="space-y-1">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-secondary">
                <RadioGroupItem value="duplicate" />
                <div className="flex-1 text-right">
                  <div className="text-sm font-medium">שכפל למערכת</div>
                  <div className="text-xs text-muted-foreground">צור עותק חדש (איפוס סטטיסטיקות)</div>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-secondary">
                <RadioGroupItem value="move" />
                <div className="flex-1 text-right">
                  <div className="text-sm font-medium">העבר למערכת אחרת</div>
                  <div className="text-xs text-muted-foreground">מעביר את אותה שאלה (שומר היסטוריה)</div>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-secondary">
                <RadioGroupItem value="text" />
                <div className="flex-1 text-right">
                  <div className="text-sm font-medium">העתק טקסט ללוח</div>
                  <div className="text-xs text-muted-foreground">להעתק/הדבק לכל מקום</div>
                </div>
              </label>
            </RadioGroup>
          </div>

          {mode !== "text" && (
            <div className="space-y-2">
              <Label>מערכת יעד</Label>
              <Select value={target} onValueChange={setTargetDeckId}>
                <SelectTrigger><SelectValue placeholder="בחר מערכת..." /></SelectTrigger>
                <SelectContent>
                  {state.decks.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} {d.id === card.deckId && "(נוכחית)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleAction} className="bg-gradient-navy text-primary-foreground rounded-xl">
            <Check className="h-4 w-4" /> בצע
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
