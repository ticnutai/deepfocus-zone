import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Bell, BellOff, Repeat, Save } from "lucide-react";
import { useStudy } from "@/lib/study/store";
import { evaluateGoal, todayKey } from "@/lib/study/goals";
import { isDue } from "@/lib/study/srs";
import { toast } from "sonner";

const STORAGE_LAST_NOTIFIED = "study-last-notified";

export function ReminderSettings() {
  const { state, setNotificationsEnabled, setReminderTime, setReviewIntervals, setPlanReviewIntervals } = useStudy();
  const enabled = !!state.notificationsEnabled;
  const time = state.reminderTime ?? "20:00";
  const intervals = useMemo(() => state.reviewIntervals ?? [1, 3, 7, 14, 30], [state.reviewIntervals]);
  const intervalsKey = useMemo(() => intervals.join(","), [intervals]);
  const [draft, setDraft] = useState<string>(intervals.join(", "));
  useEffect(() => { setDraft(intervalsKey.split(",").join(", ")); }, [intervalsKey]);

  const planIntervals = useMemo(() => state.planReviewIntervals ?? [1, 7, 30, 90], [state.planReviewIntervals]);
  const planIntervalsKey = useMemo(() => planIntervals.join(","), [planIntervals]);
  const [planDraft, setPlanDraft] = useState<string>(planIntervals.join(", "));
  useEffect(() => { setPlanDraft(planIntervalsKey.split(",").join(", ")); }, [planIntervalsKey]);

  const parsed = useMemo(() => {
    return draft
      .split(/[,\s]+/)
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }, [draft]);
  const dirty = parsed.join(",") !== intervals.join(",");

  const planParsed = useMemo(() => {
    return planDraft
      .split(/[,\s]+/)
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }, [planDraft]);
  const planDirty = planParsed.join(",") !== planIntervals.join(",");

  const saveIntervals = () => {
    if (parsed.length === 0) { toast.error("יש להזין לפחות מרווח אחד"); return; }
    setReviewIntervals(parsed);
    toast.success("מרווחי החזרה עודכנו");
  };

  const savePlanIntervals = () => {
    if (planParsed.length === 0) { toast.error("יש להזין לפחות מרווח אחד"); return; }
    setPlanReviewIntervals(planParsed);
    toast.success("מרווחי חזרה לתוכניות עודכנו");
  };

  const [perm, setPerm] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );

  // request permission when enabling
  const handleToggle = async (v: boolean) => {
    if (v && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") {
        toast.error("דרושה הרשאה להתראות בדפדפן");
        return;
      }
    }
    setNotificationsEnabled(v);
    if (v) toast.success("התראות הופעלו");
  };

  // poll every minute - check time and dueness
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const today = todayKey();
      const lastNotified = localStorage.getItem(STORAGE_LAST_NOTIFIED);

      const dueCount = state.cards.filter(isDue).length;
      const goals = state.goals ?? [];
      const unfinished = goals.filter((g) => !evaluateGoal(g, state.logs).doneToday);

      // 1. scheduled time reminder
      if (`${hh}:${mm}` === time && lastNotified !== `time-${today}`) {
        if (dueCount > 0 || unfinished.length > 0) {
          new Notification("תזכורת לימוד", {
            body: `${dueCount} כרטיסים לחזרה · ${unfinished.length} יעדים פתוחים`,
            tag: "study-reminder",
          });
          localStorage.setItem(STORAGE_LAST_NOTIFIED, `time-${today}`);
        }
      }

      // 2. due cards check (once per day, after 1 hour past reminder if still pending)
      const [reminderH, reminderM] = time.split(":").map(Number);
      const reminderTotalMin = reminderH * 60 + reminderM;
      const nowTotalMin = now.getHours() * 60 + now.getMinutes();
      if (
        dueCount >= 5 &&
        nowTotalMin >= reminderTotalMin + 60 &&
        lastNotified !== `due-${today}`
      ) {
        new Notification("יש לך כרטיסים שמחכים", {
          body: `${dueCount} כרטיסים מחכים לחזרה היום`,
          tag: "study-due",
        });
        localStorage.setItem(STORAGE_LAST_NOTIFIED, `due-${today}`);
      }
    };
    check();
    const id = window.setInterval(check, 60_000);
    return () => window.clearInterval(id);
  }, [enabled, time, state.cards, state.goals, state.logs]);

  return (
    <Card className="gold-frame p-5 space-y-3 animate-fade-in" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-base font-semibold">תזכורות יומיות</h3>
          <span className="gold-icon-circle h-8 w-8">
            {enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </span>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </div>
      <div className="flex items-center gap-2 justify-start">
        <span className="text-xs text-muted-foreground">שעת תזכורת:</span>
        <Input
          type="time"
          value={time}
          onChange={(e) => setReminderTime(e.target.value)}
          disabled={!enabled}
          className="w-28 border-2 border-gold/40 text-right"
        />
      </div>
      {enabled && perm !== "granted" && (
        <p className="text-[11px] text-destructive text-right">
          הרשאת התראות בדפדפן לא ניתנה. אפשר אותה בהגדרות האתר.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground text-right leading-relaxed">
        תזכורת תישלח בשעה שנקבעה אם יש כרטיסים לחזרה או יעדים שלא הושלמו.
        אם נשארו לפחות 5 כרטיסים שעה אחרי התזכורת — תישלח תזכורת נוספת.
      </p>

      {/* Review intervals editor */}
      <div className="border-t border-gold/20 pt-3 space-y-2">
        <div className="flex items-center gap-2 justify-start">
          <Repeat className="h-4 w-4 text-gold" />
          <h4 className="text-sm font-semibold">מרווחי חזרה לדפי ש"ס</h4>
        </div>
        <p className="text-[11px] text-muted-foreground text-right">
          ימים לאחר הלימוד שבהם תיווצר תזכורת חזרה. הפרד בפסיק.
        </p>
        <div className="flex items-center gap-2 justify-start">
          <Button
            size="sm" disabled={!dirty} onClick={saveIntervals}
            className="bg-gradient-navy text-primary-foreground rounded-lg h-8"
          >
            <Save className="h-3.5 w-3.5" /> שמור
          </Button>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="1, 3, 7, 14, 30"
            className="border-2 border-gold/40 text-right h-8 w-56"
            dir="ltr"
          />
        </div>
        <div className="text-[11px] text-muted-foreground text-right">
          נוכחי: <span className="text-foreground font-semibold">{intervals.join(" · ")}</span> ימים
        </div>
      </div>

      {/* Plan review intervals editor */}
      <div className="border-t border-gold/20 pt-3 space-y-2">
        <div className="flex items-center gap-2 justify-start">
          <Repeat className="h-4 w-4 text-emerald-500" />
          <h4 className="text-sm font-semibold">מרווחי חזרה לתוכניות לימוד</h4>
        </div>
        <p className="text-[11px] text-muted-foreground text-right">
          ימים לאחר השלמת יחידה (חומש/רמב"ם/וכו') שבהם תיווצר חזרה. ברירת מחדל: 1, 7, 30, 90.
        </p>
        <div className="flex items-center gap-2 justify-start">
          <Button
            size="sm" disabled={!planDirty} onClick={savePlanIntervals}
            className="bg-gradient-navy text-primary-foreground rounded-lg h-8"
          >
            <Save className="h-3.5 w-3.5" /> שמור
          </Button>
          <Input
            value={planDraft}
            onChange={(e) => setPlanDraft(e.target.value)}
            placeholder="1, 7, 30, 90"
            className="border-2 border-gold/40 text-right h-8 w-56"
            dir="ltr"
          />
        </div>
        <div className="text-[11px] text-muted-foreground text-right">
          נוכחי: <span className="text-foreground font-semibold">{planIntervals.join(" · ")}</span> ימים
        </div>
      </div>
    </Card>
  );
}
