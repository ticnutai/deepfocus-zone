import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Check, Trash2, MessageSquare, RefreshCw } from "lucide-react";

type Note = {
  id: string;
  user_id: string;
  source_user_id: string;
  original_card_id: string | null;
  forked_card_id: string | null;
  original_question: string | null;
  note: string;
  status: string;
  created_at: string;
};

type Profile = { id: string; display_name: string | null; email: string | null };

export function ChangeNotesTab() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const load = async () => {
    setLoading(true);
    let q = supabase.from("source_change_notes").select("*").order("created_at", { ascending: false }).limit(500);
    if (filter === "open") q = q.eq("status", "open");
    const { data, error } = await q;
    if (error) {
      toast({ title: "שגיאה בטעינת הערות", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const list = (data ?? []) as Note[];
    setNotes(list);
    const ids = Array.from(new Set(list.map((n) => n.user_id)));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,display_name,email").in("id", ids);
      const map: Record<string, Profile> = {};
      for (const p of (profs ?? []) as Profile[]) map[p.id] = p;
      setProfiles(map);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("source_change_notes").update({ status }).eq("id", id);
    if (error) {
      toast({ title: "שגיאה בעדכון", description: error.message, variant: "destructive" });
      return;
    }
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("למחוק את ההערה?")) return;
    const { error } = await supabase.from("source_change_notes").delete().eq("id", id);
    if (error) {
      toast({ title: "שגיאה במחיקה", description: error.message, variant: "destructive" });
      return;
    }
    await load();
  };

  return (
    <Card className="gold-frame p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle"><MessageSquare className="h-4 w-4" /></span>
          <h3 className="font-display text-lg font-semibold">הערות שינוי על שאלות מהמקור</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={filter === "open" ? "default" : "outline"}
            onClick={() => setFilter("open")}
          >
            פתוחות בלבד
          </Button>
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
          >
            הכל
          </Button>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-6">טוען…</div>
      ) : notes.length === 0 ? (
        <div className="text-center text-muted-foreground py-6">אין הערות להצגה.</div>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => {
            const p = profiles[n.user_id];
            const who = p?.display_name || p?.email || n.user_id.slice(0, 8);
            return (
              <div key={n.id} className="rounded-xl border-2 border-gold/40 p-3 text-right space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={n.status === "open" ? "default" : "secondary"}>{n.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(n.created_at).toLocaleString("he-IL")}
                    </span>
                  </div>
                  <div className="text-sm font-medium">{who}</div>
                </div>
                {n.original_question && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-semibold">שאלה מקורית: </span>{n.original_question}
                  </div>
                )}
                <div className="text-sm whitespace-pre-wrap">{n.note}</div>
                <div className="flex items-center gap-2 pt-1">
                  {n.status === "open" && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(n.id, "resolved")}>
                      <Check className="h-4 w-4 ml-1" />סמן כטופל
                    </Button>
                  )}
                  {n.status !== "open" && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(n.id, "open")}>
                      החזר לפתוח
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => remove(n.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
