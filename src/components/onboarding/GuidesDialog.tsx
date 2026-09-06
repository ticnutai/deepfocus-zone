import { useEffect, useState } from "react";
import { Sparkles, ArrowLeft, PlayCircle, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GUIDE_TOPICS, type GuideTopic } from "@/lib/onboarding/guideTopics";
import { requestGuideOpen } from "@/lib/onboarding/guideTriggers";
import { loadGuidesConfig, applyGuidesConfig } from "@/lib/onboarding/guidesAdminConfig";

interface GuidesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (id: string) => void;
  /** Explicit "already read" acknowledgment — the ONLY action that stops the
   * hub from reopening on the next visit. Closing via X/Escape does not. */
  onMarkRead: () => void;
}

export function GuidesDialog({ open, onOpenChange, onNavigate, onMarkRead }: GuidesDialogProps) {
  const [topics, setTopics] = useState<GuideTopic[]>(GUIDE_TOPICS);

  useEffect(() => {
    let cancelled = false;
    void loadGuidesConfig().then((config) => {
      if (cancelled || config.length === 0) return;
      const orderedIds = applyGuidesConfig(GUIDE_TOPICS.map((t) => t.id), config);
      const byId = new Map(GUIDE_TOPICS.map((t) => [t.id, t]));
      const ordered = orderedIds.map((id) => byId.get(id)).filter((t): t is GuideTopic => !!t);
      if (ordered.length > 0) setTopics(ordered);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="max-w-2xl p-0 gap-0"
        dir="rtl"
        showOverlay={false}
        // Non-blocking: stays open while the user clicks around the app
        // behind it (e.g. to try a guide's target screen without losing it).
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6 pb-2 text-center items-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-gold shadow-gold">
            <Sparkles className="h-5 w-5 text-navy" />
          </div>
          <DialogTitle className="text-xl font-display">ברוכים הבאים למעקב למידה</DialogTitle>
          <p className="text-sm text-muted-foreground">כמה מדריכים קצרים כדי להתחיל — יופיעו כל כניסה עד שתסמן שקראת</p>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-6 pt-4 max-h-[65vh] overflow-y-auto">
          {topics.map((topic) => {
            const Icon = topic.icon;
            return (
              <div
                key={topic.id}
                className="flex flex-col gap-2 rounded-xl border-2 border-gold/30 bg-card p-4 text-right"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-gold">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h3 className="font-semibold text-sm text-foreground">{topic.title}</h3>
                  {topic.guideTriggerId && (
                    <span className="mr-auto flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-medium text-gold">
                      <PlayCircle className="h-3 w-3" /> מדריך אינטראקטיבי
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{topic.description}</p>
                {topic.navigateTo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-auto self-start gap-1 text-xs text-gold hover:text-gold hover:bg-gold/10 px-2 h-7"
                    onClick={() => {
                      if (topic.guideTriggerId) requestGuideOpen(topic.guideTriggerId);
                      onNavigate(topic.navigateTo!);
                    }}
                  >
                    {topic.guideTriggerId ? "פתח מדריך" : "עבור לשם"}
                    <ArrowLeft className="h-3 w-3" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-2 border-t border-gold/20 px-6 py-4">
          <Button onClick={onMarkRead} className="gap-2 bg-gradient-navy text-primary-foreground px-8">
            <Check className="h-4 w-4" /> כבר קראתי, אל תציג שוב
          </Button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            סגור להפעם — יופיע שוב בכניסה הבאה
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
