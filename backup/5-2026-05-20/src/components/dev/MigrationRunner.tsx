import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Play, Loader2, CheckCircle2, AlertTriangle, Database, Trash2, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type RunResult = {
  success: boolean;
  rows_affected?: number;
  duration_ms?: number;
  statement_type?: string;
  error?: string;
  detail?: string;
  hint?: string;
  ranAt: string;
  preview: string;
};

const EXAMPLES: { label: string; sql: string }[] = [
  {
    label: "בדיקת חיבור (SELECT now())",
    sql: "SELECT now() AS server_time;",
  },
  {
    label: "ספירת שאלות",
    sql: "SELECT count(*) FROM public.cards;",
  },
  {
    label: "תבנית: ALTER TABLE — הוסף עמודה",
    sql: "ALTER TABLE public.cards\n  ADD COLUMN IF NOT EXISTS notes TEXT;",
  },
];

export function MigrationRunner() {
  const [sql, setSql] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<RunResult[]>([]);
  const { toast } = useToast();

  const run = async () => {
    const query = sql.trim();
    if (!query) {
      toast({ title: "אין SQL להרצה", variant: "destructive" });
      return;
    }
    setRunning(true);
    try {
      const { data, error } = await supabase.rpc("exec_sql" as never, { query } as never);
      const preview = query.slice(0, 200) + (query.length > 200 ? "…" : "");
      const ranAt = new Date().toLocaleTimeString("he-IL");
      if (error) {
        const r: RunResult = { success: false, error: error.message, ranAt, preview };
        setHistory((h) => [r, ...h].slice(0, 20));
        toast({ title: "❌ שגיאה בהרצה", description: error.message, variant: "destructive" });
      } else {
        const res = data as Record<string, unknown>;
        const r: RunResult = { ...(res as Partial<RunResult>), success: !!res?.success, ranAt, preview };
        setHistory((h) => [r, ...h].slice(0, 20));
        if (r.success) {
          toast({
            title: "✅ הרצה הושלמה",
            description: `${r.statement_type ?? ""} • ${r.rows_affected ?? 0} שורות • ${r.duration_ms ?? 0}ms`,
          });
        } else {
          toast({ title: "❌ נכשל", description: r.error, variant: "destructive" });
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "❌ שגיאת רשת", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="gold-frame p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="border-2 border-amber-500/60 text-amber-700 dark:text-amber-400">
            ⚠ כלי פיתוח — מנהל בלבד
          </Badge>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold">הרצת מיגרציות SQL</h3>
            <span className="gold-icon-circle"><Database className="h-4 w-4" /></span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          {EXAMPLES.map((ex) => (
            <Button
              key={ex.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSql(ex.sql)}
              className="border-2 border-gold/50"
            >
              {ex.label}
            </Button>
          ))}
        </div>

        <Textarea
          dir="ltr"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder={"-- כתוב כאן SQL...\nSELECT now();"}
          className="border-2 border-gold/40 font-mono text-sm min-h-[220px] text-left"
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSql("")}
              disabled={!sql || running}
              className="border-2 border-gold/50"
            >
              <Trash2 className="h-4 w-4" /> נקה
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => { navigator.clipboard.writeText(sql); toast({ title: "הועתק" }); }}
              disabled={!sql}
              className="border-2 border-gold/50"
            >
              <Copy className="h-4 w-4" /> העתק
            </Button>
          </div>
          <Button
            onClick={run}
            disabled={running || !sql.trim()}
            className="bg-gradient-navy text-primary-foreground rounded-xl px-6 shadow-elegant"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "מריץ..." : "הרץ"}
          </Button>
        </div>
      </Card>

      <Card className="gold-frame p-5 space-y-3">
        <div className="flex items-center justify-between">
          {history.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setHistory([])}>
              נקה היסטוריה
            </Button>
          )}
          <h3 className="font-display text-lg font-semibold">היסטוריית הרצות</h3>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">עדיין לא הורצו פקודות</p>
        ) : (
          <div className="space-y-2">
            {history.map((r, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-xl border-2 p-3 space-y-1 text-sm",
                  r.success
                    ? "border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30"
                    : "border-destructive/50 bg-destructive/5",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{r.ranAt}</span>
                  <div className="flex items-center gap-2">
                    {r.success ? (
                      <>
                        <Badge variant="outline" className="border-emerald-500/60">
                          {r.statement_type ?? "OK"} • {r.rows_affected ?? 0} שורות • {r.duration_ms ?? 0}ms
                        </Badge>
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      </>
                    ) : (
                      <>
                        <Badge variant="destructive">שגיאה</Badge>
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                      </>
                    )}
                  </div>
                </div>
                <pre dir="ltr" className="text-xs font-mono bg-background/60 rounded p-2 overflow-x-auto whitespace-pre-wrap text-left">
{r.preview}
                </pre>
                {!r.success && r.error && (
                  <div className="text-xs text-destructive font-mono" dir="ltr">{r.error}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}