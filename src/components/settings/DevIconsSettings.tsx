import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Activity, Cloud } from "lucide-react";
import { useStudy } from "@/lib/study/store";

export function DevIconsSettings() {
  const { state, setUiPref } = useStudy();
  const showPerf = !!state.uiPrefs?.devShowPerfMonitor;
  const showSync = !!state.uiPrefs?.devShowSyncIndicator;

  return (
    <Card className="gold-frame p-4 space-y-4" dir="rtl">
      <div>
        <h3 className="font-display text-lg font-bold text-foreground">איקוני פיתוח</h3>
        <p className="text-xs text-muted-foreground mt-1">
          הצגה או הסתרה של כפתורי הדיבאג הצפים בפינת המסך. ברירת מחדל: כבוי. נשמר לחשבון שלך ומסונכרן בין מכשירים.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-gold/30 bg-card p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-gold/70 bg-card text-navy">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <Label htmlFor="dev-perf" className="text-sm font-semibold cursor-pointer">מוניטור ביצועים (Debug)</Label>
            <div className="text-[11px] text-muted-foreground">סמן ביצועים צף לפיתוח</div>
          </div>
        </div>
        <Switch
          id="dev-perf"
          checked={showPerf}
          onCheckedChange={(v) => setUiPref("devShowPerfMonitor", v)}
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-gold/30 bg-card p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-gold/70 bg-card text-navy">
            <Cloud className="h-4 w-4" />
          </span>
          <div>
            <Label htmlFor="dev-sync" className="text-sm font-semibold cursor-pointer">סטטוס סנכרון</Label>
            <div className="text-[11px] text-muted-foreground">אינדיקטור הענן שמראה אם הנתונים מסונכרנים</div>
          </div>
        </div>
        <Switch
          id="dev-sync"
          checked={showSync}
          onCheckedChange={(v) => setUiPref("devShowSyncIndicator", v)}
        />
      </div>
    </Card>
  );
}
