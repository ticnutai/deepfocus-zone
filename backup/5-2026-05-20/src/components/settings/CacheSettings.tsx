import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Database, RefreshCw, Zap, Clock } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getFullRefreshTtlMs, setFullRefreshTtlMs } from "@/lib/study/store";

const HOUR = 60 * 60 * 1000;
const PRESETS = [
  { label: "שעה", value: 1 * HOUR },
  { label: "6 שעות", value: 6 * HOUR },
  { label: "12 שעות", value: 12 * HOUR },
  { label: "24 שעות", value: 24 * HOUR },
  { label: "3 ימים", value: 72 * HOUR },
  { label: "שבוע", value: 168 * HOUR },
];

export function CacheSettings() {
  const [ttlMs, setTtlMs] = useState<number>(getFullRefreshTtlMs());
  const [hoursInput, setHoursInput] = useState<string>(() => String(Math.round(getFullRefreshTtlMs() / HOUR)));

  useEffect(() => {
    setHoursInput(String(Math.round(ttlMs / HOUR)));
  }, [ttlMs]);

  const apply = (ms: number) => {
    setFullRefreshTtlMs(ms);
    setTtlMs(ms);
    toast({ title: "ההגדרה נשמרה", description: `Full Sync יבוצע אחרי ${Math.round(ms / HOUR)} שעות` });
  };

  const applyHours = () => {
    const h = Number(hoursInput);
    if (!Number.isFinite(h) || h <= 0) {
      toast({ title: "ערך לא תקין", description: "הזן מספר שעות חיובי", variant: "destructive" });
      return;
    }
    apply(h * HOUR);
  };

  const forceFullSync = () => {
    try {
      // מחיקת חותמות ה-Sync הגורמת לטעינה מלאה בריענון הבא
      Object.keys(localStorage)
        .filter((k) => k.startsWith("last-cloud-full-sync-at:") || k.startsWith("last-cloud-bootstrap-at:"))
        .forEach((k) => localStorage.removeItem(k));
      toast({ title: "המטמון אופס", description: "ריענון העמוד יבצע Full Sync מלא" });
    } catch {
      toast({ title: "שגיאה", description: "לא ניתן לאפס את המטמון", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="gold-frame p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle"><Database className="h-4 w-4" /></span>
          <div>
            <h3 className="font-display text-lg font-bold">מטמון וסנכרון</h3>
            <p className="text-xs text-muted-foreground">קבע מתי לבצע Full Sync מלא לעומת סנכרון מהיר של שינויים בלבד.</p>
          </div>
        </div>

        <div className="rounded-xl border-2 border-gold/30 bg-secondary/20 p-4 space-y-3">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Zap className="h-4 w-4 text-gold shrink-0 mt-0.5" />
            <div>
              <strong className="text-foreground">איך זה עובד:</strong> בכל פתיחה של האפליקציה, אם עברו פחות מהזמן שתבחר מאז ה-Full Sync האחרון — נטען רק את מה שהשתנה (Delta Sync, מהיר). אחרת — נטען מחדש את כל הנתונים מהענן (Full Sync, איטי יותר אבל מבטיח עדכניות מלאה כולל מחיקות מהתקנים אחרים).
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-gold" /> ערכים מהירים</Label>
          <ToggleGroup type="single" value={String(ttlMs)} onValueChange={(v) => v && apply(Number(v))} className="flex-wrap justify-start gap-1">
            {PRESETS.map((p) => (
              <ToggleGroupItem key={p.value} value={String(p.value)} className="border-2 border-gold/30 data-[state=on]:bg-gradient-navy data-[state=on]:text-primary-foreground">
                {p.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="space-y-2">
          <Label className="block text-right">מותאם אישית (שעות)</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
              className="border-2 border-gold/40 text-right max-w-32"
            />
            <Button onClick={applyHours} className="bg-gradient-navy text-primary-foreground rounded-xl">
              שמור
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            ערך נוכחי: כל <strong className="text-foreground">{(ttlMs / HOUR).toFixed(1)}</strong> שעות
          </p>
        </div>

        <div className="border-t-2 border-gold/20 pt-4">
          <Button onClick={forceFullSync} variant="outline" className="border-2 border-gold/50 gap-2">
            <RefreshCw className="h-4 w-4" /> אפס מטמון ובצע Full Sync עכשיו
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            יאלץ את האפליקציה לטעון את כל הנתונים מהענן בריענון הבא של הדף.
          </p>
        </div>
      </Card>
    </div>
  );
}