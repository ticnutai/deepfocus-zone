import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BookOpen, CheckCircle2, Info, LockKeyhole, UserRound, UsersRound } from "lucide-react";

/** Content source only. Guest permissions belong to the central role profiles. */
export function GuestContentSettings() {
  // Guest cloud source — when enabled, guests read this user's data from the cloud
  // (read-only). When disabled, guests get an empty/clean app like before.
  const [sourceEnabled, setSourceEnabled] = useState(false);
  const [sourceUserId, setSourceUserId] = useState<string | null>(null);
  const [sourceUserLabel, setSourceUserLabel] = useState<string>("");
  const [adminCandidates, setAdminCandidates] = useState<Array<{ id: string; email: string | null; display_name: string | null }>>([]);
  const [sourceBusy, setSourceBusy] = useState(false);
  // Same source, separate toggle for authenticated registered users (overlay).
  const [overlayForUsersEnabled, setOverlayForUsersEnabled] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);

  const loadGuestSource = useCallback(async () => {
    const { data: srcRow } = await supabase
      .from("site_settings").select("value").eq("key", "guest_source").maybeSingle();
    const val = (srcRow?.value ?? {}) as { enabled?: boolean; user_id?: string | null };
    setSourceEnabled(!!val.enabled);
    setSourceUserId(val.user_id ?? null);

    const { data: overlayRow } = await supabase
      .from("site_settings").select("value").eq("key", "source_overlay_for_users").maybeSingle();
    const overlayVal = (overlayRow?.value ?? {}) as { enabled?: boolean };
    setOverlayForUsersEnabled(!!overlayVal.enabled);

    // List ALL user profiles as candidates for the source (not just admins).
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,email,display_name")
      .order("display_name", { ascending: true });
    const list = (profs ?? []) as Array<{ id: string; email: string | null; display_name: string | null }>;
    setAdminCandidates(list);
    const cur = list.find((p) => p.id === val.user_id);
    setSourceUserLabel(cur ? (cur.display_name || cur.email || cur.id) : "");
  }, []);

  const saveGuestSource = async (enabled: boolean, userId: string | null) => {
    setSourceBusy(true);
    try {
      const value = { enabled, user_id: userId };
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: "guest_source", value }, { onConflict: "key" });
      if (error) throw error;
      setSourceEnabled(enabled);
      setSourceUserId(userId);
      const cur = adminCandidates.find((p) => p.id === userId);
      setSourceUserLabel(cur ? (cur.display_name || cur.email || cur.id) : "");
      toast.success(enabled ? "האורח יקרא מהענן" : "האורח לא יקרא מהענן");
    } catch (e) {
      toast.error("שגיאה בשמירת הגדרת מקור האורח");
      console.error(e);
    } finally {
      setSourceBusy(false);
    }
  };

  const saveOverlayForUsers = async (enabled: boolean) => {
    setOverlayBusy(true);
    try {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: "source_overlay_for_users", value: { enabled } }, { onConflict: "key" });
      if (error) throw error;
      setOverlayForUsersEnabled(enabled);
      toast.success(enabled ? "משתמשים רשומים יקראו מהמקור" : "משתמשים רשומים יראו רק את המידע שלהם");
    } catch (e) {
      toast.error("שגיאה בשמירת הגדרת מקור למשתמשים");
      console.error(e);
    } finally {
      setOverlayBusy(false);
    }
  };

  useEffect(() => { void loadGuestSource(); }, [loadGuestSource]);
  return (
    <Card className="gold-frame overflow-hidden" dir="rtl">
      <div className="border-b-2 border-gold/25 bg-gradient-to-l from-gold/10 to-transparent p-5">
        <div className="flex items-center gap-3">
          <span className="gold-icon-circle"><BookOpen className="h-5 w-5" /></span>
          <div>
            <h2 className="font-display text-xl font-bold">ספריית תוכן משותפת</h2>
            <p className="text-sm text-muted-foreground">מאגר שאלות וקטגוריות מרכזי שאפשר להציג לאורחים ולמשתמשים רשומים.</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="flex items-start gap-3 rounded-xl border border-blue-300/60 bg-blue-50 p-3 text-sm text-blue-950 dark:bg-blue-950/25 dark:text-blue-100">
          <Info className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <strong>מה ההגדרה עושה?</strong>
            <p className="mt-1 text-xs leading-5">היא משתפת תוכן בקריאה בלבד. המשתמשים יכולים ללמוד מהספרייה, אבל הבעלות נשארת אצל בעל הספרייה. ההגדרה אינה מעניקה הרשאות מנהל ואינה מחליפה פרופיל גישה.</p>
          </div>
        </div>

        <section className="rounded-xl border-2 border-gold/30 bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
            <div>
              <h3 className="font-bold">בחר בעל ספרייה</h3>
              <p className="text-xs text-muted-foreground">הקטגוריות והשאלות של משתמש זה יהיו המקור המשותף.</p>
            </div>
          </div>
          <div className="max-w-2xl space-y-1.5">
            <Label className="flex items-center gap-1.5"><UserRound className="h-4 w-4" /> בעל הספרייה</Label>
            <Select
              value={sourceUserId ?? ""}
              onValueChange={(v) => void saveGuestSource(sourceEnabled, v || null)}
              disabled={sourceBusy}
            >
              <SelectTrigger><SelectValue placeholder="בחר משתמש מקור" /></SelectTrigger>
              <SelectContent>
                {adminCandidates.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {(p.display_name || p.email || p.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="rounded-xl border-2 border-gold/30 bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
            <div>
              <h3 className="font-bold">בחר למי הספרייה מוצגת</h3>
              <p className="text-xs text-muted-foreground">הפעלת הספרייה מציגה אותה לאורחים. לאחר מכן אפשר לצרף גם משתמשים רשומים.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className={`flex items-center justify-between gap-4 rounded-xl border-2 p-4 ${sourceEnabled ? "border-emerald-400/70 bg-emerald-50 dark:bg-emerald-950/20" : "border-border bg-muted/20"}`}>
              <div className="flex items-start gap-3">
                <UserRound className="mt-0.5 h-5 w-5 text-gold" />
                <div>
                  <div className="font-semibold">אורחים — הפעלת הספרייה</div>
                  <div className="text-xs text-muted-foreground">זו ההפעלה הראשית של מקור התוכן המשותף.</div>
                </div>
              </div>
              <Switch
                checked={sourceEnabled}
                onCheckedChange={(checked) => void saveGuestSource(checked, sourceUserId)}
                disabled={sourceBusy || (!sourceEnabled && !sourceUserId)}
                aria-label="הצג ספרייה משותפת לאורחים"
              />
            </label>

            <label className={`flex items-center justify-between gap-4 rounded-xl border-2 p-4 ${overlayForUsersEnabled ? "border-emerald-400/70 bg-emerald-50 dark:bg-emerald-950/20" : "border-border bg-muted/20"}`}>
              <div className="flex items-start gap-3">
                <UsersRound className="mt-0.5 h-5 w-5 text-gold" />
                <div>
                  <div className="font-semibold">משתמשים רשומים — קהל נוסף</div>
                  <div className="text-xs text-muted-foreground">מוסיף את הספרייה לתוכן האישי שלהם לאחר שהספרייה הופעלה.</div>
                </div>
              </div>
              <Switch
                checked={sourceEnabled && overlayForUsersEnabled}
                onCheckedChange={(checked) => void saveOverlayForUsers(checked)}
                disabled={overlayBusy || !sourceUserId || !sourceEnabled}
                aria-label="הצג ספרייה משותפת למשתמשים רשומים"
              />
            </label>
          </div>
        </section>

        <div className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${sourceUserId && sourceEnabled ? "border-emerald-400/60 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100" : "bg-muted/30 text-muted-foreground"}`}>
          {sourceUserId && sourceEnabled ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />}
          <div>
            <strong>{sourceUserId && sourceEnabled ? "הספרייה המשותפת פעילה" : "הספרייה המשותפת אינה מוצגת"}</strong>
            <p className="mt-0.5 text-xs">
              {sourceUserId && sourceEnabled
                ? `בעל הספרייה: ${sourceUserLabel || "המשתמש שנבחר"}. מוצגת לאורחים${overlayForUsersEnabled ? " וגם למשתמשים רשומים" : " בלבד"}, בקריאה בלבד.`
                : sourceUserId ? "בעל הספרייה נבחר, אך הספרייה עדיין כבויה." : "בחר בעל ספרייה ולאחר מכן הפעל אותה לאורחים."}
            </p>
          </div>
        </div>
      </div>
    </Card>


  );
}
