import { Card } from "@/components/ui/card";
import { Smartphone, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MOBILE_LAYOUT_MODE_OPTIONS,
  useMobileLayoutMode,
  setMobileLayoutMode,
  type MobileLayoutMode,
} from "@/lib/study/mobileLayoutMode";

export function MobileLayoutSettings() {
  const current = useMobileLayoutMode();

  return (
    <Card className="gold-frame p-4 space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <span className="gold-icon-circle"><Smartphone className="h-4 w-4" /></span>
        <div>
          <h3 className="font-display text-lg font-bold">פריסה למובייל</h3>
          <p className="text-xs text-muted-foreground">בחר איך הוויד׳גטים מוצגים במסך קטן. במצב "אוטומטי" המערכת מזהה לבד.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {MOBILE_LAYOUT_MODE_OPTIONS.map((opt) => {
          const active = current === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setMobileLayoutMode(opt.value as MobileLayoutMode)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-right transition-all",
                active
                  ? "border-gold bg-gradient-to-l from-gold/15 to-transparent shadow"
                  : "border-gold/30 bg-card hover:border-gold/60",
              )}
            >
              <div className={cn(
                "flex items-center justify-center h-6 w-6 rounded-full border-2",
                active ? "border-gold bg-gold text-navy" : "border-gold/40",
              )}>
                {active && <Check className="h-3.5 w-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-foreground">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground border-t border-gold/20 pt-2">
        כל הפריסות תומכות בערכת הנושא הפעילה (בהיר/כהה/זהב).
      </p>
    </Card>
  );
}
