/**
 * GlobalRestoreHost — mounted once at app root.
 *
 * Hosts <RestoreDiffDialog /> and the floating "background restore" widget
 * so the restore engine and its controls survive navigation between pages.
 */
import { lazy, Suspense } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Minimize2, PauseCircle, PlayCircle, RefreshCw } from "lucide-react";
import { useRestoreContext } from "@/lib/study/RestoreContext";

const RestoreDiffDialog = lazy(() =>
  import("@/components/study/RestoreDiffDialog").then((m) => ({ default: m.RestoreDiffDialog })),
);

export function GlobalRestoreHost() {
  const {
    snapshot,
    dialogOpen,
    runtime,
    command,
    widgetExpanded,
    setDialogOpen,
    setRuntime,
    sendCommand,
    setWidgetExpanded,
  } = useRestoreContext();

  const showWidget = !dialogOpen && (runtime.running || runtime.resumeAvailable);

  return (
    <>
      {/* Engine — always mounted while a snapshot is loaded so background work survives navigation */}
      {snapshot && (
        <Suspense fallback={null}>
          <RestoreDiffDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            snapshot={snapshot}
            onRuntimeStatusChange={setRuntime}
            backgroundCommand={command}
          />
        </Suspense>
      )}

      {/* Floating background-restore widget */}
      {showWidget && (
        <div className="fixed bottom-5 left-5 z-[60] flex items-end gap-2">
          {widgetExpanded && (
            <Card className="border-gold/40 bg-card/95 backdrop-blur px-3 py-2 shadow-elegant min-w-[250px]">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setWidgetExpanded(false)}
                    title="מזער"
                    aria-label="מזער"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                  </Button>
                  <div className="text-xs font-semibold text-right">שחזור</div>
                </div>
                <div className="text-[11px] text-muted-foreground text-right">
                  {runtime.running
                    ? `${runtime.phase || "מעבד..."} · ${runtime.percent}%`
                    : "השחזור הופסק - אפשר להמשיך מאותה נקודה"}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => setDialogOpen(true)}
                    disabled={!snapshot}
                  >
                    פתח
                  </Button>
                  {runtime.running ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1 border-amber-500/50 text-amber-600"
                      onClick={() => sendCommand("stop")}
                    >
                      <PauseCircle className="h-3.5 w-3.5" />
                      עצור
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1 bg-gradient-navy text-primary-foreground"
                      onClick={() => sendCommand("resume")}
                      disabled={!runtime.resumeAvailable}
                    >
                      <PlayCircle className="h-3.5 w-3.5" />
                      המשך
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )}

          <div className="flex gap-2">
            <Button
              size="icon"
              className="h-10 w-10 rounded-full bg-gradient-navy text-primary-foreground shadow-elegant"
              onClick={() => setWidgetExpanded((v) => !v)}
              title={runtime.running ? "שחזור רץ ברקע" : "שחזור מושהה"}
              aria-label={runtime.running ? "שחזור רץ ברקע" : "שחזור מושהה"}
            >
              {runtime.running ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <PauseCircle className="h-4 w-4" />
              )}
            </Button>

            {runtime.running && (
              <Button
                size="icon"
                variant="outline"
                className="h-10 w-10 rounded-full border-amber-500/50 text-amber-600 bg-card/95"
                onClick={() => sendCommand("stop")}
                title="עצור שחזור ברקע"
                aria-label="עצור שחזור ברקע"
              >
                <PauseCircle className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
