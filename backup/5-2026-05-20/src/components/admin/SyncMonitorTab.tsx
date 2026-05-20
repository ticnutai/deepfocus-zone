import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { getIndexedMonitorSnapshot, type IndexedMonitorSnapshot } from "@/lib/study/indexedStateCache";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Activity, Database as DatabaseIcon, Cloud, Split } from "lucide-react";
import { toast } from "sonner";

type MonitoredTable =
  | "categories"
  | "decks"
  | "cards"
  | "goals"
  | "day_notes"
  | "card_decks"
  | "shas_reviews"
  | "learning_sessions"
  | "user_settings";

type ProfileLite = { id: string; display_name: string | null; email: string | null };

type MonitorSource = {
  key: MonitoredTable;
  label: string;
  timeField: "updated_at" | "created_at";
  idField: string;
};

type SourceSummary = {
  key: MonitoredTable;
  label: string;
  totalRows: number;
  latestAt: string | null;
  latestUserId: string | null;
  latestUserName: string | null;
  latestUserEmail: string | null;
};

type SyncEvent = {
  table: string;
  recordId: string;
  at: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
};

const SOURCES: MonitorSource[] = [
  { key: "categories", label: "קטגוריות", timeField: "updated_at", idField: "id" },
  { key: "decks", label: "מערכות", timeField: "updated_at", idField: "id" },
  { key: "cards", label: "כרטיסים", timeField: "updated_at", idField: "id" },
  { key: "goals", label: "יעדים", timeField: "updated_at", idField: "id" },
  { key: "day_notes", label: "הערות יומיות", timeField: "updated_at", idField: "date" },
  { key: "card_decks", label: "שיוכי כרטיס-מערכת", timeField: "updated_at", idField: "card_id" },
  { key: "shas_reviews", label: "חזרות ש" + "ס", timeField: "updated_at", idField: "id" },
  { key: "learning_sessions", label: "סשנים", timeField: "updated_at", idField: "id" },
  { key: "user_settings", label: "הגדרות משתמש", timeField: "updated_at", idField: "user_id" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function shortId(v: string | null): string {
  if (!v) return "—";
  return v.length > 10 ? `${v.slice(0, 8)}...` : v;
}

export function SyncMonitorTab() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<SourceSummary[]>([]);
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [indexedSnapshot, setIndexedSnapshot] = useState<IndexedMonitorSnapshot | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, display_name, email");
      if (profilesError) throw profilesError;

      const profilesMap = new Map<string, ProfileLite>();
      for (const p of (profilesData ?? []) as ProfileLite[]) {
        profilesMap.set(p.id, p);
      }

      const summaryRows = await Promise.all(
        SOURCES.map(async (src): Promise<SourceSummary> => {
          const countRes = await supabase
            .from(src.key)
            .select("id", { count: "exact", head: true });

          if (countRes.error) throw countRes.error;

          const latestRes = await (supabase
            .from(src.key)
            .select(`user_id, ${src.timeField}`)
            .order(src.timeField, { ascending: false })
            .limit(1)
            .maybeSingle() as unknown as Promise<{
              data: { user_id: string | null; updated_at?: string | null; created_at?: string | null } | null;
              error: unknown;
            }>);

          if (latestRes.error) throw latestRes.error;

          const latestUserId = latestRes.data?.user_id ?? null;
          const who = latestUserId ? profilesMap.get(latestUserId) : null;
          const latestAt = src.timeField === "updated_at"
            ? (latestRes.data?.updated_at ?? null)
            : (latestRes.data?.created_at ?? null);

          return {
            key: src.key,
            label: src.label,
            totalRows: countRes.count ?? 0,
            latestAt,
            latestUserId,
            latestUserName: who?.display_name ?? null,
            latestUserEmail: who?.email ?? null,
          };
        }),
      );

      const eventBuckets = await Promise.all(
        SOURCES.map(async (src) => {
          const evRes = await (supabase
            .from(src.key)
            .select(`${src.idField}, user_id, ${src.timeField}`)
            .order(src.timeField, { ascending: false })
            .limit(8) as unknown as Promise<{
              data: Array<Record<string, string | null>> | null;
              error: unknown;
            }>);

          if (evRes.error) throw evRes.error;

          return (evRes.data ?? []).map((row): SyncEvent => {
            const userId = (row.user_id as string | null) ?? null;
            const who = userId ? profilesMap.get(userId) : null;
            const at = (row[src.timeField] as string | null) ?? new Date(0).toISOString();
            return {
              table: src.label,
              recordId: (row[src.idField] as string | null) ?? "",
              at,
              userId,
              userName: who?.display_name ?? null,
              userEmail: who?.email ?? null,
            };
          });
        }),
      );

      const mergedEvents = eventBuckets
        .flat()
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 40);

      if (user?.id) {
        const localSnapshot = await getIndexedMonitorSnapshot(user.id);
        setIndexedSnapshot(localSnapshot);
      } else {
        setIndexedSnapshot(null);
      }

      setSummaries(summaryRows);
      setEvents(mergedEvents);
      setLastRefreshAt(new Date().toISOString());
    } catch (error) {
      const msg = error instanceof Error ? error.message : "שגיאה לא צפויה";
      toast.error(`ניטור סנכרון נכשל: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const totals = useMemo(() => {
    const rows = summaries.reduce((acc, s) => acc + s.totalRows, 0);
    const activeSources = summaries.filter((s) => s.totalRows > 0).length;
    return { rows, activeSources };
  }, [summaries]);

  const compareRows = useMemo(() => {
    if (!indexedSnapshot) return [];
    const mapLocalCount = (key: MonitoredTable): number | null => {
      switch (key) {
        case "categories": return indexedSnapshot.counts.categories;
        case "decks": return indexedSnapshot.counts.decks;
        case "cards": return indexedSnapshot.counts.cards;
        case "goals": return indexedSnapshot.counts.goals;
        case "day_notes": return indexedSnapshot.counts.dayNotes;
        case "card_decks": return indexedSnapshot.counts.cardDecks;
        case "shas_reviews": return indexedSnapshot.counts.shasReviews;
        case "learning_sessions": return indexedSnapshot.counts.learningSessions;
        case "user_settings": return 1;
      }
    };

    return summaries.map((s) => {
      const local = mapLocalCount(s.key);
      const diff = local == null ? null : s.totalRows - local;
      return {
        label: s.label,
        cloud: s.totalRows,
        local,
        diff,
        latestAt: s.latestAt,
        latestUser: s.latestUserName ?? s.latestUserEmail ?? shortId(s.latestUserId),
      };
    });
  }, [summaries, indexedSnapshot]);

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="gold-frame p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            onClick={() => {
              void load();
            }}
            disabled={loading}
            className="gap-1.5"
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            רענן עכשיו
          </Button>
          <div className="text-right">
            <h3 className="font-display text-lg font-semibold">ניטור סנכרון בזמן אמת</h3>
            <p className="text-xs text-muted-foreground">
              ריענון אוטומטי כל 30 שניות · עודכן לאחרונה: {fmtDate(lastRefreshAt)} · זיהוי נוכחי: {user?.email ?? shortId(user?.id ?? null)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <Badge variant="outline" className="border-gold/60">סך רשומות: {totals.rows}</Badge>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">מקורות פעילים: {totals.activeSources}</Badge>
          <Badge variant="outline" className="border-blue-500/40 text-blue-600">אירועים אחרונים: {events.length}</Badge>
          <Badge variant="outline" className="border-purple-500/40 text-purple-600">IndexedDB: {indexedSnapshot ? "פעיל" : "לא זוהה"}</Badge>
        </div>
      </Card>

      <Tabs defaultValue="cloud" className="w-full">
        <Card className="gold-frame p-2">
          <TabsList className="w-full bg-transparent h-auto flex-wrap justify-between gap-1">
            <TabsTrigger value="cloud" className="flex-1 gap-1.5 rounded-xl px-2 py-2 text-sm data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>סופאבייס</span><Cloud className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="indexed" className="flex-1 gap-1.5 rounded-xl px-2 py-2 text-sm data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>IndexedDB</span><DatabaseIcon className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="compare" className="flex-1 gap-1.5 rounded-xl px-2 py-2 text-sm data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>השוואה</span><Split className="h-4 w-4" />
            </TabsTrigger>
          </TabsList>
        </Card>

        <TabsContent value="cloud" className="mt-4 space-y-4">
          <Card className="gold-frame p-4">
            <h4 className="font-semibold text-right mb-3">סטטוס מקורות נתונים בענן</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 text-right">מקור</th>
                    <th className="py-2 text-right">סה"כ</th>
                    <th className="py-2 text-right">עדכון אחרון</th>
                    <th className="py-2 text-right">ממי (שם / אימייל / מזהה)</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((s) => (
                    <tr key={s.key} className="border-b last:border-0">
                      <td className="py-2 text-right">{s.label}</td>
                      <td className="py-2 text-right">{s.totalRows}</td>
                      <td className="py-2 text-right">{fmtDate(s.latestAt)}</td>
                      <td className="py-2 text-right text-xs">
                        {s.latestUserId
                          ? `${s.latestUserName ?? "ללא שם"} / ${s.latestUserEmail ?? "ללא אימייל"} / ${shortId(s.latestUserId)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="gold-frame p-4">
            <h4 className="font-semibold text-right mb-3">ציר אירועי סנכרון (ענן)</h4>
            <div className="max-h-[420px] overflow-y-auto space-y-2">
              {events.length === 0 ? (
                <div className="text-sm text-muted-foreground text-right">אין אירועים להצגה</div>
              ) : (
                events.map((ev, idx) => (
                  <div key={`${ev.table}-${ev.recordId}-${ev.at}-${idx}`} className="rounded-lg border border-gold/20 p-2.5 bg-card/50">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{fmtDate(ev.at)}</span>
                      <span className="font-medium text-foreground flex items-center gap-1">
                        <Activity className="h-3.5 w-3.5" />
                        {ev.table}
                      </span>
                    </div>
                    <div className="text-xs text-right mt-1">מזהה רשומה: {ev.recordId || "—"}</div>
                    <div className="text-xs text-right text-muted-foreground">
                      משתמש: {ev.userName ?? "ללא שם"} · {ev.userEmail ?? "ללא אימייל"} · {shortId(ev.userId)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="indexed" className="mt-4">
          <Card className="gold-frame p-4 space-y-3">
            <h4 className="font-semibold text-right">תמונת IndexedDB</h4>
            {!indexedSnapshot ? (
              <div className="text-sm text-muted-foreground text-right">לא נמצאה תמונת אינדקס למשתמש הנוכחי</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 justify-end">
                  <Badge variant="outline" className="border-gold/60">משתמש: {shortId(indexedSnapshot.userId)}</Badge>
                  <Badge variant="outline" className="border-blue-500/40 text-blue-600">שמירה אחרונה: {fmtDate(indexedSnapshot.cacheSavedAt ? new Date(indexedSnapshot.cacheSavedAt).toISOString() : null)}</Badge>
                  <Badge variant="outline" className="border-amber-500/40 text-amber-600">תור סנכרון: {indexedSnapshot.syncJobsCount}</Badge>
                  <Badge variant="outline" className="border-purple-500/40 text-purple-600">מחיקות ממתינות: {indexedSnapshot.pendingDeletesCount}</Badge>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="py-2 text-right">מקור</th>
                        <th className="py-2 text-right">רשומות באינדקס</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b"><td className="py-2 text-right">קטגוריות</td><td className="py-2 text-right">{indexedSnapshot.counts.categories}</td></tr>
                      <tr className="border-b"><td className="py-2 text-right">מערכות</td><td className="py-2 text-right">{indexedSnapshot.counts.decks}</td></tr>
                      <tr className="border-b"><td className="py-2 text-right">כרטיסים</td><td className="py-2 text-right">{indexedSnapshot.counts.cards}</td></tr>
                      <tr className="border-b"><td className="py-2 text-right">יעדים</td><td className="py-2 text-right">{indexedSnapshot.counts.goals}</td></tr>
                      <tr className="border-b"><td className="py-2 text-right">הערות יומיות</td><td className="py-2 text-right">{indexedSnapshot.counts.dayNotes}</td></tr>
                      <tr className="border-b"><td className="py-2 text-right">שיוכי כרטיס-מערכת</td><td className="py-2 text-right">{indexedSnapshot.counts.cardDecks}</td></tr>
                      <tr className="border-b"><td className="py-2 text-right">חזרות ש"ס</td><td className="py-2 text-right">{indexedSnapshot.counts.shasReviews}</td></tr>
                      <tr><td className="py-2 text-right">סשנים</td><td className="py-2 text-right">{indexedSnapshot.counts.learningSessions}</td></tr>
                    </tbody>
                  </table>
                </div>

                <div className="text-xs text-muted-foreground text-right">
                  דוח מחיקות באינדקס: queued={indexedSnapshot.deleteAuditCounts.queued} · success={indexedSnapshot.deleteAuditCounts.success} · failed={indexedSnapshot.deleteAuditCounts.failed} · noop={indexedSnapshot.deleteAuditCounts.noop}
                </div>
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="compare" className="mt-4">
          <Card className="gold-frame p-4 space-y-3">
            <h4 className="font-semibold text-right">השוואת ענן מול אינדקס + לוח זמנים + זיהוי</h4>
            <div className="text-xs text-muted-foreground text-right">
              לוח זמנים פעיל: ריענון דוח כל 30 שניות · סנכרון ענן-אינדקס ראשון אחרי 2 דקות מעלייה · משתמש מזוהה: {user?.email ?? shortId(user?.id ?? null)}
            </div>

            {compareRows.length === 0 ? (
              <div className="text-sm text-muted-foreground text-right">אין נתונים להשוואה כרגע</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 text-right">מקור</th>
                      <th className="py-2 text-right">ענן</th>
                      <th className="py-2 text-right">IndexedDB</th>
                      <th className="py-2 text-right">פער</th>
                      <th className="py-2 text-right">עדכון אחרון</th>
                      <th className="py-2 text-right">מי עדכן</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareRows.map((r) => (
                      <tr key={r.label} className="border-b last:border-0">
                        <td className="py-2 text-right">{r.label}</td>
                        <td className="py-2 text-right">{r.cloud}</td>
                        <td className="py-2 text-right">{r.local ?? "—"}</td>
                        <td className="py-2 text-right">
                          {r.diff == null ? "—" : (
                            <span className={r.diff === 0 ? "text-emerald-600" : "text-amber-600"}>{r.diff}</span>
                          )}
                        </td>
                        <td className="py-2 text-right">{fmtDate(r.latestAt)}</td>
                        <td className="py-2 text-right text-xs">{r.latestUser ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
