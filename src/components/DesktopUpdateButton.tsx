import { useEffect, useRef, useState } from "react";
import { CircleArrowUp, Download, RefreshCw, RotateCcw, WifiOff, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { usePreUpdateBackup, type PreUpdateBackupResult } from "@/hooks/usePreUpdateBackup";

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BACKUP_TIMEOUT_MS = 25000;
const INSTALL_COUNTDOWN_S = 6;

type UpdateStatus =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version?: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string; installInMs?: number }
  | { type: "development"; version: string }
  | { type: "error"; message: string };

type BackupPhase = "idle" | "running" | "done" | "failed";
type BackupMethod = PreUpdateBackupResult["method"] | null;
type LocalCopyChoice = "pending" | "downloading" | "downloaded" | "skipped" | "failed" | null;

export function DesktopUpdateButton() {
  const updates = window.desktop?.updates;
  // Application updates belong to the installed desktop application, not to a
  // cloud account. Keep them available for guests and local/offline accounts.
  const enabled = Boolean(window.desktop?.isElectron && updates);
  const [status, setStatus] = useState<UpdateStatus>({ type: "idle" });
  const [currentVersion, setCurrentVersion] = useState("");
  const [open, setOpen] = useState(false);
  const [installCountdown, setInstallCountdown] = useState(0);
  const [backupPhase, setBackupPhase] = useState<BackupPhase>("idle");
  const [backupMethod, setBackupMethod] = useState<BackupMethod>(null);
  const [localCopyChoice, setLocalCopyChoice] = useState<LocalCopyChoice>(null);
  const runPreUpdateBackup = usePreUpdateBackup();
  const backupRunnerRef = useRef(runPreUpdateBackup);
  backupRunnerRef.current = runPreUpdateBackup;
  const downloadedVersion = status.type === "downloaded" ? status.version : null;

  // Mandatory update, step 1: back up everything the user added BEFORE
  // installing, so a forced update can never lose local work. Bounded by a
  // timeout so a stalled network still lets the (equally mandatory) update
  // proceed instead of hanging forever.
  useEffect(() => {
    if (!downloadedVersion) {
      setBackupPhase("idle");
      setBackupMethod(null);
      setLocalCopyChoice(null);
      return;
    }
    let cancelled = false;
    setBackupPhase("running");
    const withTimeout = Promise.race<PreUpdateBackupResult>([
      backupRunnerRef.current(),
      new Promise((resolve) => window.setTimeout(() => resolve({ ok: false, method: "error" }), BACKUP_TIMEOUT_MS)),
    ]);
    void withTimeout.then((result) => {
      if (cancelled) return;
      setBackupMethod(result.method);
      setBackupPhase(result.ok ? "done" : "failed");
      setLocalCopyChoice(result.ok && result.method === "cloud" ? "pending" : null);
    });
    return () => { cancelled = true; };
  }, [downloadedVersion]);

  // Mandatory update, step 2: once the backup attempt is settled (done OR
  // failed — it must not block the update forever), install automatically
  // after a short, visible countdown. The renderer drives this; the main
  // process (electron/main.cjs) keeps a much longer fallback timer in case
  // this component never runs at all.
  useEffect(() => {
    if (
      status.type !== "downloaded"
      || backupPhase === "idle"
      || backupPhase === "running"
      || localCopyChoice === "pending"
      || localCopyChoice === "downloading"
    ) return;
    setInstallCountdown(INSTALL_COUNTDOWN_S);
    const intervalId = window.setInterval(() => {
      setInstallCountdown((s) => Math.max(0, s - 1));
    }, 1000);
    const timeoutId = window.setTimeout(() => {
      void updates?.install();
    }, INSTALL_COUNTDOWN_S * 1000);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [status, backupPhase, localCopyChoice, updates]);

  const downloadLocalCopy = async () => {
    setLocalCopyChoice("downloading");
    const result = await runPreUpdateBackup({ localCopyOnly: true });
    setLocalCopyChoice(result.ok ? "downloaded" : "failed");
  };

  useEffect(() => {
    if (!enabled || !updates) return;
    let active = true;
    void updates.getVersion().then((version) => { if (active) setCurrentVersion(version); });
    const unsubscribe = updates.onStatus((next) => {
      if (!active) return;
      setStatus(next);
      if (next.type === "available" || next.type === "downloading" || next.type === "downloaded") setOpen(true);
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
          "relative flex h-7 w-7 items-center justify-center rounded-full border transition-all",
          hasUpdate
            ? "border-red-600 bg-red-600 text-white shadow-[0_0_8px_rgba(220,38,38,0.95),0_0_18px_rgba(239,68,68,0.75)] motion-safe:animate-pulse"
            : "border-gold/70 bg-card text-navy hover:bg-secondary",
        )}
      >
        {hasUpdate && (
          <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-red-500 bg-red-600 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow-[0_0_10px_rgba(239,68,68,0.7)]">
            לעדכון
          </span>
        )}
        <CircleArrowUp className="h-4 w-4" />
        {hasUpdate && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-200 ring-2 ring-red-700" />}
      </button>

      {/* Mandatory update: once a download starts, the dialog can't be
          dismissed — the update proceeds and installs regardless either way,
          this just keeps the user informed instead of letting them forget
          about it mid-way. */}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && (status.type === "downloading" || status.type === "downloaded")) return;
          setOpen(next);
        }}
      >
        <DialogContent
          dir="rtl"
          className="max-w-md text-right"
          onPointerDownOutside={(e) => {
            if (status.type === "downloading" || status.type === "downloaded") e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (status.type === "downloading" || status.type === "downloaded") e.preventDefault();
          }}
        >
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
                <p className="font-bold text-foreground">גרסה חדשה {status.version} זמינה — ההורדה מתחילה אוטומטית.</p>
                <p className="text-sm text-muted-foreground">אפשר להמשיך לעבוד בזמן הורדת העדכון ברקע.</p>
              </div>
            )}
            {status.type === "downloading" && (
              <div className="space-y-2">
                <p className="font-semibold flex items-center gap-2"><Download className="h-4 w-4" /> מוריד עדכון ברקע — {status.percent}%</p>
                <Progress value={status.percent} />
                <p className="text-xs text-muted-foreground">העדכון חובה ומתבצע אוטומטית. אפשר להמשיך לעבוד בינתיים.</p>
              </div>
            )}
            {status.type === "downloaded" && (
              <div className="space-y-2">
                <p className="font-bold text-foreground">גרסה {status.version} מוכנה — מעדכן גרסה…</p>
                {backupPhase === "running" && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> מגבה את הנתונים שלך (שאלות, מבחנים, קטגוריות…) לפני ההתקנה…
                  </p>
                )}
                {backupPhase === "done" && (
                  <div className="space-y-2">
                    <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="h-4 w-4" /> הגיבוי הושלם בהצלחה.
                    </p>
                    {backupMethod === "cloud" && (
                      <p className="text-sm text-muted-foreground">
                        שני גיבויי העדכון האחרונים נשמרים בענן ומתחלפים אוטומטית.
                      </p>
                    )}
                  </div>
                )}
                {backupPhase === "failed" && (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    הגיבוי לא הושלם כרגע (יתבצע שוב מאוחר יותר) — העדכון ממשיך בכל זאת.
                  </p>
                )}
                {backupMethod === "cloud" && localCopyChoice === "pending" && (
                  <div className="rounded-lg border border-gold/50 bg-card p-3">
                    <p className="mb-3 text-sm font-semibold">רוצה להוריד גם עותק גיבוי למחשב?</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => void downloadLocalCopy()} className="gap-2 bg-navy text-white">
                        <Download className="h-4 w-4" /> הורד למחשב
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setLocalCopyChoice("skipped")}>
                        לא עכשיו
                      </Button>
                    </div>
                  </div>
                )}
                {localCopyChoice === "downloading" && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> מכין עותק להורדה למחשב…
                  </p>
                )}
                {localCopyChoice === "downloaded" && (
                  <p className="text-sm text-emerald-700 dark:text-emerald-400">עותק הגיבוי הורד גם למחשב.</p>
                )}
                {localCopyChoice === "failed" && (
                  <p className="text-sm text-amber-700 dark:text-amber-400">ההורדה למחשב לא הצליחה. הגיבוי בענן נשמר.</p>
                )}
                {(backupPhase === "done" || backupPhase === "failed")
                  && localCopyChoice !== "pending"
                  && localCopyChoice !== "downloading" && (
                  <p className="text-sm text-muted-foreground">
                    המערכת תיסגר ותתקין את העדכון אוטומטית בעוד {installCountdown} {installCountdown === 1 ? "שנייה" : "שניות"}, ותיפתח מחדש.
                  </p>
                )}
              </div>
            )}
            {status.type === "error" && <p className="flex items-start gap-2 text-destructive"><WifiOff className="mt-0.5 h-4 w-4 shrink-0" /> {status.message}</p>}
          </div>

          <DialogFooter className="flex-row-reverse gap-2 sm:justify-start">
            {status.type === "downloaded" && (
              <Button
                onClick={() => void updates.install()}
                disabled={backupPhase === "running" || localCopyChoice === "pending" || localCopyChoice === "downloading"}
                className="gap-2 bg-navy text-white"
              >
                <RotateCcw className="h-4 w-4" /> התקן עכשיו
              </Button>
            )}
            {(status.type === "idle" || status.type === "not-available" || status.type === "error") && (
              <Button variant="outline" onClick={checkNow} className="gap-2">
                <RefreshCw className="h-4 w-4" /> בדוק שוב
              </Button>
            )}
            {status.type !== "downloading" && status.type !== "downloaded" && (
              <Button variant="ghost" onClick={() => setOpen(false)}>סגור</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
