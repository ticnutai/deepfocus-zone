import { useEffect, useState } from "react";
import { CircleArrowUp, Download, RefreshCw, RotateCcw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type UpdateStatus =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version?: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "development"; version: string }
  | { type: "error"; message: string };

export function DesktopUpdateButton() {
  const updates = window.desktop?.updates;
  // Application updates belong to the installed desktop application, not to a
  // cloud account. Keep them available for guests and local/offline accounts.
  const enabled = Boolean(window.desktop?.isElectron && updates);
  const [status, setStatus] = useState<UpdateStatus>({ type: "idle" });
  const [currentVersion, setCurrentVersion] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled || !updates) return;
    let active = true;
    void updates.getVersion().then((version) => { if (active) setCurrentVersion(version); });
    const unsubscribe = updates.onStatus((next) => {
      if (!active) return;
      setStatus(next);
      if (next.type === "available" || next.type === "downloaded") setOpen(true);
    });
    const check = () => {
      if (!navigator.onLine) return;
      setStatus({ type: "checking" });
      void updates.check();
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    check();
    const intervalId = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(intervalId);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [enabled, updates]);

  if (!enabled) return null;

  const hasUpdate = status.type === "available" || status.type === "downloading" || status.type === "downloaded";
  const checkNow = () => {
    setOpen(true);
    if (!navigator.onLine) {
      setStatus({ type: "error", message: "אין כרגע חיבור לאינטרנט." });
      return;
    }
    setStatus({ type: "checking" });
    void updates?.check();
  };

  return (
    <>
      <button
        type="button"
        onClick={checkNow}
        title={hasUpdate ? "קיים עדכון חדש" : "בדוק עדכוני תוכנה"}
        aria-label={hasUpdate ? "קיים עדכון חדש" : "בדוק עדכוני תוכנה"}
        className={cn(
          "relative flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
          hasUpdate ? "border-gold bg-gold text-navy shadow-gold" : "border-gold/70 bg-card text-navy hover:bg-secondary",
        )}
      >
        <CircleArrowUp className="h-4 w-4" />
        {hasUpdate && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-md text-right">
          <DialogHeader className="text-right">
            <DialogTitle>עדכוני תוכנה</DialogTitle>
            <DialogDescription className="text-right">
              הגרסה המותקנת: {currentVersion || "בודק…"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 rounded-xl border-2 border-gold/35 bg-secondary/15 p-4">
            {status.type === "idle" && <p>אפשר לבדוק אם קיימת גרסה חדשה של „למען”.</p>}
            {status.type === "checking" && <p className="flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> בודק אם קיים עדכון…</p>}
            {status.type === "not-available" && <p>הגרסה המותקנת היא הגרסה העדכנית ביותר.</p>}
            {status.type === "development" && <p>בדיקת עדכונים זמינה בגרסה המותקנת בלבד, ולא במצב פיתוח.</p>}
            {status.type === "available" && (
              <div className="space-y-2">
                <p className="font-bold text-foreground">גרסה חדשה {status.version} זמינה להתקנה.</p>
                <p className="text-sm text-muted-foreground">אפשר להמשיך לעבוד בזמן הורדת העדכון.</p>
              </div>
            )}
            {status.type === "downloading" && (
              <div className="space-y-2">
                <p className="font-semibold">מוריד את העדכון — {status.percent}%</p>
                <Progress value={status.percent} />
              </div>
            )}
            {status.type === "downloaded" && (
              <div className="space-y-2">
                <p className="font-bold text-foreground">גרסה {status.version} מוכנה להתקנה.</p>
                <p className="text-sm text-muted-foreground">המערכת תיסגר, תתקין את העדכון ותיפתח מחדש.</p>
              </div>
            )}
            {status.type === "error" && <p className="flex items-start gap-2 text-destructive"><WifiOff className="mt-0.5 h-4 w-4 shrink-0" /> {status.message}</p>}
          </div>

          <DialogFooter className="flex-row-reverse gap-2 sm:justify-start">
            {status.type === "available" && (
              <Button onClick={() => void updates.download()} className="gap-2 bg-navy text-white">
                <Download className="h-4 w-4" /> הורד עדכון
              </Button>
            )}
            {status.type === "downloaded" && (
              <Button onClick={() => void updates.install()} className="gap-2 bg-navy text-white">
                <RotateCcw className="h-4 w-4" /> הפעל מחדש והתקן
              </Button>
            )}
            {(status.type === "idle" || status.type === "not-available" || status.type === "error") && (
              <Button variant="outline" onClick={checkNow} className="gap-2">
                <RefreshCw className="h-4 w-4" /> בדוק שוב
              </Button>
            )}
            <Button variant="ghost" onClick={() => setOpen(false)}>סגור</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
