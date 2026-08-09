import { useEffect, useMemo, useState } from "react";
import { Activity, AppWindow, Clock3, Download, Globe2, LogIn, RefreshCw, TrendingUp, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type ActivityRow = {
  user_id: string;
  activity_date: string;
  login_count: number;
  active_seconds: number;
  last_seen_at: string;
  last_login_at: string | null;
  web_login_count: number;
  desktop_login_count: number;
  web_active_seconds: number;
  desktop_active_seconds: number;
};

type InstallEvent = { id: string; user_id: string; event_type: "install" | "update"; from_version: string | null; to_version: string; occurred_at: string };

type ProfileRow = {
  id: string;
  display_name: string | null;
  username: string | null;
  email: string | null;
};

const isTechnicalEmail = (email: string | null) => !email || email.endsWith("@users.local") || email === "guest@local";
const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${seconds} שנ׳`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ש׳ ${rest} דק׳` : `${hours} ש׳`;
};

const identity = (profile?: ProfileRow) =>
  profile?.username || profile?.display_name || (!isTechnicalEmail(profile?.email ?? null) ? profile?.email : null) || "משתמש מקומי";

export function UserActivityTab() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [installEvents, setInstallEvents] = useState<InstallEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - 29);
    const date = since.toISOString().slice(0, 10);
    const [{ data: activity }, { data: people }, { data: installs }] = await Promise.all([
      supabase.from("user_activity_daily").select("user_id,activity_date,login_count,active_seconds,last_seen_at,last_login_at,web_login_count,desktop_login_count,web_active_seconds,desktop_active_seconds").gte("activity_date", date).order("activity_date"),
      supabase.from("profiles").select("id,display_name,username,email"),
      supabase.from("desktop_install_events").select("id,user_id,event_type,from_version,to_version,occurred_at").order("occurred_at", { ascending: false }).limit(100),
    ]);
    setRows((activity ?? []) as ActivityRow[]);
    setProfiles((people ?? []) as ProfileRow[]);
    setInstallEvents((installs ?? []) as InstallEvent[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const profileMap = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const daily = useMemo(() => {
    const map = new Map<string, { date: string; users: Set<string>; logins: number; seconds: number }>();
    for (const row of rows) {
      const item = map.get(row.activity_date) ?? { date: row.activity_date, users: new Set<string>(), logins: 0, seconds: 0 };
      item.users.add(row.user_id);
      item.logins += row.login_count;
      item.seconds += row.active_seconds;
      map.set(row.activity_date, item);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  const perUser = useMemo(() => {
    const map = new Map<string, { userId: string; days: Set<string>; logins: number; webLogins: number; desktopLogins: number; seconds: number; lastSeen: string }>();
    for (const row of rows) {
      const item = map.get(row.user_id) ?? { userId: row.user_id, days: new Set<string>(), logins: 0, webLogins: 0, desktopLogins: 0, seconds: 0, lastSeen: row.last_seen_at };
      item.days.add(row.activity_date);
      item.logins += row.login_count;
      item.webLogins += row.web_login_count;
      item.desktopLogins += row.desktop_login_count;
      item.seconds += row.active_seconds;
      if (row.last_seen_at > item.lastSeen) item.lastSeen = row.last_seen_at;
      map.set(row.user_id, item);
    }
    return [...map.values()].sort((a, b) => b.seconds - a.seconds);
  }, [rows]);

  const uniqueUsers = new Set(rows.map((row) => row.user_id)).size;
  const totalLogins = rows.reduce((sum, row) => sum + row.login_count, 0);
  const totalSeconds = rows.reduce((sum, row) => sum + row.active_seconds, 0);
  const webLogins = rows.reduce((sum, row) => sum + row.web_login_count, 0);
  const desktopLogins = rows.reduce((sum, row) => sum + row.desktop_login_count, 0);
  const webSeconds = rows.reduce((sum, row) => sum + row.web_active_seconds, 0);
  const desktopSeconds = rows.reduce((sum, row) => sum + row.desktop_active_seconds, 0);
  const installs = installEvents.filter((event) => event.event_type === "install").length;
  const updates = installEvents.filter((event) => event.event_type === "update").length;
  const maxDailyUsers = Math.max(1, ...daily.map((day) => day.users.size));

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">ניתוח שימוש באפליקציה</h3>
          <p className="text-sm text-muted-foreground">משתמשים פעילים, כניסות וזמן שימוש ב־30 הימים האחרונים.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> רענן
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gold-frame flex items-center gap-3 p-4"><span className="gold-icon-circle"><Globe2 className="h-4 w-4" /></span><div><div className="text-xs text-muted-foreground">כניסות דרך האתר</div><div className="text-xl font-bold">{webLogins}</div><div className="text-xs text-muted-foreground">{formatDuration(webSeconds)}</div></div></Card>
        <Card className="gold-frame flex items-center gap-3 p-4"><span className="gold-icon-circle"><AppWindow className="h-4 w-4" /></span><div><div className="text-xs text-muted-foreground">כניסות דרך האפליקציה</div><div className="text-xl font-bold">{desktopLogins}</div><div className="text-xs text-muted-foreground">{formatDuration(desktopSeconds)}</div></div></Card>
        <Card className="gold-frame flex items-center gap-3 p-4"><span className="gold-icon-circle"><Download className="h-4 w-4" /></span><div><div className="text-xs text-muted-foreground">התקנות שדווחו</div><div className="text-xl font-bold">{installs}</div></div></Card>
        <Card className="gold-frame flex items-center gap-3 p-4"><span className="gold-icon-circle"><RefreshCw className="h-4 w-4" /></span><div><div className="text-xs text-muted-foreground">עדכונים שדווחו</div><div className="text-xl font-bold">{updates}</div></div></Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "משתמשים פעילים", value: uniqueUsers, icon: Users },
          { label: "כניסות", value: totalLogins, icon: LogIn },
          { label: "זמן שימוש", value: formatDuration(totalSeconds), icon: Clock3 },
          { label: "ימים עם פעילות", value: daily.length, icon: TrendingUp },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="gold-frame flex items-center gap-3 p-4">
            <span className="gold-icon-circle"><Icon className="h-4 w-4" /></span>
            <div><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-bold">{value}</div></div>
          </Card>
        ))}
      </div>

      <Card className="gold-frame p-4">
        <div className="mb-4 flex items-center gap-2 font-bold"><Activity className="h-4 w-4 text-gold" /> משתמשים פעילים בכל יום</div>
        {daily.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">הנתונים יופיעו לאחר הכניסה הבאה למערכת.</p> : (
          <div className="flex min-h-52 items-end gap-2 overflow-x-auto pb-2">
            {daily.map((day) => (
              <div key={day.date} className="flex min-w-14 flex-1 flex-col items-center justify-end gap-1" title={`${day.users.size} משתמשים · ${day.logins} כניסות · ${formatDuration(day.seconds)}`}>
                <span className="text-xs font-bold">{day.users.size}</span>
                <div className="w-full rounded-t-md bg-gradient-navy" style={{ height: `${Math.max(10, (day.users.size / maxDailyUsers) * 150)}px` }} />
                <span className="text-[10px] text-muted-foreground">{new Date(`${day.date}T12:00:00`).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="gold-frame overflow-hidden">
        <div className="border-b border-gold/30 p-4 font-bold">פירוט לפי משתמש</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-secondary/50 text-muted-foreground"><tr><th className="p-3 text-right">משתמש</th><th className="p-3">ימים פעילים</th><th className="p-3">כניסות באתר</th><th className="p-3">כניסות באפליקציה</th><th className="p-3">סה״כ כניסות</th><th className="p-3">זמן שימוש</th><th className="p-3">פעילות אחרונה</th></tr></thead>
            <tbody>
              {perUser.map((item) => {
                const profile = profileMap.get(item.userId);
                return <tr key={item.userId} className="border-t border-gold/20"><td className="p-3"><div className="font-semibold">{identity(profile)}</div>{profile?.email && !isTechnicalEmail(profile.email) && <div dir="ltr" className="text-xs text-muted-foreground">{profile.email}</div>}</td><td className="p-3 text-center">{item.days.size}</td><td className="p-3 text-center">{item.webLogins}</td><td className="p-3 text-center">{item.desktopLogins}</td><td className="p-3 text-center font-semibold">{item.logins}</td><td className="p-3 text-center">{formatDuration(item.seconds)}</td><td className="p-3 text-center">{new Date(item.lastSeen).toLocaleString("he-IL")}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="gold-frame overflow-hidden">
        <div className="border-b border-gold/30 p-4 font-bold">התקנות ועדכוני אפליקציה</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-secondary/50 text-muted-foreground"><tr><th className="p-3 text-right">משתמש</th><th className="p-3">פעולה</th><th className="p-3">גרסה קודמת</th><th className="p-3">גרסה חדשה</th><th className="p-3">מועד</th></tr></thead>
            <tbody>
              {installEvents.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">אירועים חדשים יופיעו לאחר התקנה או עדכון של הגרסה הבאה.</td></tr> : installEvents.map((event) => <tr key={event.id} className="border-t border-gold/20"><td className="p-3 font-semibold">{identity(profileMap.get(event.user_id))}</td><td className="p-3 text-center">{event.event_type === "install" ? "התקנה" : "עדכון"}</td><td className="p-3 text-center">{event.from_version || "—"}</td><td className="p-3 text-center font-semibold">{event.to_version}</td><td className="p-3 text-center">{new Date(event.occurred_at).toLocaleString("he-IL")}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
