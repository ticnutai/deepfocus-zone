import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Activity, Cloud, RefreshCw } from "lucide-react";
import { useStudy } from "@/lib/study/store";

const MIN_SIZE = 32;
const MAX_SIZE = 56;
const DEFAULT_SIZE = 44;

function clampSize(raw: number): number {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(raw)));
}

export function DevIconsSettings() {
  const { state, setUiPref } = useStudy();
  const showPerf = !!state.uiPrefs?.devShowPerfMonitor;
  const showSync = !!state.uiPrefs?.devShowSyncIndicator;
  const showDeepRefresh = !!state.uiPrefs?.devShowDeepRefreshFab;
  const deepRefreshSize = clampSize(Number(state.uiPrefs?.devDeepRefreshSize ?? DEFAULT_SIZE));

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

      <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-gold/30 bg-card p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-gold/70 bg-card text-navy">
            <RefreshCw className="h-4 w-4" />
          </span>
          <div>
            <Label htmlFor="dev-deep-refresh" className="text-sm font-semibold cursor-pointer">ריענון עמוק</Label>
            <div className="text-[11px] text-muted-foreground">כפתור צף שמנקה cache ומרענן חזק מכל מסך</div>
          </div>
        </div>
        <Switch
          id="dev-deep-refresh"
          checked={showDeepRefresh}
          onCheckedChange={(v) => {
            setUiPref("devShowDeepRefreshFab", v);
            if (v && typeof state.uiPrefs?.devDeepRefreshSize !== "number") {
              setUiPref("devDeepRefreshSize", DEFAULT_SIZE);
            }
          }}
        />
      </div>

      {showDeepRefresh && (
        <div className="rounded-xl border-2 border-gold/30 bg-card p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="dev-deep-refresh-size" className="text-sm font-semibold cursor-pointer">גודל כפתור ריענון עמוק</Label>
            <span className="text-xs text-muted-foreground font-mono">{deepRefreshSize}px</span>
          </div>
          <input
            id="dev-deep-refresh-size"
            type="range"
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={1}
            value={deepRefreshSize}
            onChange={(e) => setUiPref("devDeepRefreshSize", clampSize(Number(e.target.value)))}
            className="w-full accent-gold"
          />
          <div className="text-[11px] text-muted-foreground">הכפתור נגרר על המסך, נשמר מקומית ובענן, ונשמר גם אחרי ריענון ובמכשירים אחרים.</div>
        </div>
      )}
    </Card>
  );
}
