import { useCallback, useState } from "react";
import { CircleHelp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CardEditor } from "./CardEditor";

export function QuestionCreationPage() {
  const [editorKey, setEditorKey] = useState(0);
  const resetEditor = useCallback(() => setEditorKey((key) => key + 1), []);

  return (
    <Card className="gold-frame mx-auto max-w-4xl p-4 sm:p-6" dir="rtl">
      <div className="mb-5 flex items-center justify-end gap-3 text-right">
        <div>
          <h2 className="font-display text-xl font-bold text-foreground">יצירת שאלות</h2>
          <p className="text-sm text-muted-foreground">
            יצירת שאלה חדשה ושיוכה לקטגוריות או למערכת מבחנים.
          </p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-gold/60 text-gold">
          <CircleHelp className="h-5 w-5" />
        </span>
      </div>

      <CardEditor key={editorKey} deckId={null} onClose={resetEditor} />
    </Card>
  );
}
