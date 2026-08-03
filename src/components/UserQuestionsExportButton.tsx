import { useEffect, useState } from "react";
import { Download, FileText, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useStudy } from "@/lib/study/store";
import { exportUserQuestions, selectUserOwnedCards, type UserQuestionExportFormat } from "@/lib/study/userQuestionsExport";

export function UserQuestionsExportButton() {
  const { state } = useStudy();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<UserQuestionExportFormat | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void selectUserOwnedCards(state.cards ?? []).then((cards) => {
      if (!cancelled) setCount(cards.length);
    });
    return () => { cancelled = true; };
  }, [open, state.cards]);

  const handleExport = async (format: UserQuestionExportFormat) => {
    setBusy(format);
    try {
      const exported = await exportUserQuestions(state.cards ?? [], format);
      if (!exported) {
        toast({
          title: "אין שאלות אישיות לייצוא",
          description: "הייצוא כולל רק שאלות שהוספת בעצמך, ולא את מאגר האתר.",
        });
        return;
      }
      toast({
        title: format === "docx" ? "קובץ Word הוכן" : "תצוגת PDF נפתחה",
        description: `נכללו ${exported.toLocaleString("he-IL")} שאלות שהוספת בעצמך בלבד.`,
      });
      setOpen(false);
    } catch (error) {
      toast({
        title: "הייצוא נכשל",
        description: error instanceof Error ? error.message : "אירעה שגיאה לא ידועה",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="הורדת השאלות והתשובות שהוספתי"
        aria-label="הורדת השאלות והתשובות שהוספתי"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gold/50 text-navy transition-colors hover:bg-gold/10"
      >
        <Download className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-gold" />
              הורדת השאלות והתשובות שלי
            </DialogTitle>
            <DialogDescription className="text-right">
              הקובץ יכלול רק שאלות שהוספת בעצמך. שאלות מובנות של האתר ותוכן של משתמשים אחרים לא ייכללו.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-gold/35 bg-gold/5 p-3 text-sm">
            {count === null ? "סופר שאלות אישיות…" : `${count.toLocaleString("he-IL")} שאלות אישיות זמינות להורדה`}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button
              variant="outline"
              className="h-auto min-h-20 flex-col gap-2 border-gold/45"
              onClick={() => void handleExport("docx")}
              disabled={busy !== null || count === 0}
            >
              {busy === "docx" ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5 text-gold" />}
              <span className="font-bold">Word</span>
              <span className="text-xs font-normal text-muted-foreground">קובץ הניתן לעריכה</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-20 flex-col gap-2 border-gold/45"
              onClick={() => void handleExport("pdf")}
              disabled={busy !== null || count === 0}
            >
              {busy === "pdf" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5 text-gold" />}
              <span className="font-bold">PDF</span>
              <span className="text-xs font-normal text-muted-foreground">נפתח בחלון שמירה כ־PDF</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
