import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "@/hooks/use-toast";
import { Check, MessageSquare, RefreshCw, User, X } from "lucide-react";

type Note = Database["public"]["Tables"]["source_change_notes"]["Row"];
type Profile = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "display_name" | "email">;

const statusLabel: Record<string, string> = {
  open: "ממתינה להחלטה",
  accepted: "התקבלה",
  rejected: "נדחתה",
  resolved: "טופלה בעבר",
};

export function ChangeNotesTab() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("source_change_notes").select("*").order("created_at", { ascending: false }).limit(1000);
    if (filter === "open") query = query.eq("status", "open");
    const { data, error } = await query;
    if (error) {
      toast({ title: "שגיאה בטעינת הערות", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const list = (data ?? []) as Note[];
    setNotes(list);
    const ids = [...new Set(list.map((note) => note.user_id))];
    if (ids.length) {
      const { data: profileRows } = await supabase.from("profiles").select("id,display_name,email").in("id", ids);
      setProfiles(Object.fromEntries(((profileRows ?? []) as Profile[]).map((profile) => [profile.id, profile])));
    } else {
      setProfiles({});
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const channel = supabase.channel("admin-question-reports-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "source_change_notes" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Note[]>();
    for (const note of notes) groups.set(note.user_id, [...(groups.get(note.user_id) ?? []), note]);
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [notes]);

  const decide = async (note: Note, status: "accepted" | "rejected") => {
    setBusyId(note.id);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("source_change_notes").update({
      status,
      admin_response: responses[note.id]?.trim() || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: auth.user?.id ?? null,
    }).eq("id", note.id);
    setBusyId(null);
    if (error) return toast({ title: "שמירת ההחלטה נכשלה", description: error.message, variant: "destructive" });
    toast({ title: status === "accepted" ? "ההערה התקבלה" : "ההערה נדחתה" });
    await load();
  };

  return (
    <Card className="gold-frame space-y-4 p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold"><MessageSquare className="h-5 w-5 text-gold" />הערות על שאלות ותשובות</h3>
          <p className="text-sm text-muted-foreground">הדיווחים מסודרים לפי המשתמש ששלח אותם. ניתן לקבל או לדחות כל הערה בנפרד.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={filter === "open" ? "default" : "outline"} onClick={() => setFilter("open")}>ממתינות ({notes.filter((note) => note.status === "open").length})</Button>
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>כל ההערות</Button>
          <Button size="icon" variant="ghost" onClick={() => void load()} disabled={loading} title="רענון"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </div>

      {loading ? <div className="py-8 text-center text-muted-foreground">טוען הערות…</div> : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">אין הערות להצגה.</div>
      ) : (
        <Accordion type="multiple" defaultValue={grouped.map(([userId]) => userId)} className="space-y-2">
          {grouped.map(([userId, userNotes]) => {
            const profile = profiles[userId];
            const name = profile?.display_name || profile?.email || `משתמש ${userId.slice(0, 8)}`;
            return <AccordionItem key={userId} value={userId} className="rounded-xl border-2 border-gold/30 px-3">
              <AccordionTrigger className="hover:no-underline">
                <span className="flex items-center gap-2"><User className="h-4 w-4 text-gold" /><b>{name}</b><Badge variant="outline">{userNotes.length} הערות</Badge></span>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                {userNotes.map((note) => <div key={note.id} className="space-y-3 rounded-xl border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><Badge variant={note.status === "open" ? "default" : "secondary"}>{statusLabel[note.status] || note.status}</Badge><Badge variant="outline">{note.target_kind === "answer" ? `תשובה${note.target_index != null ? ` ${note.target_index + 1}` : ""}` : "שאלה"}</Badge></div>
                    <span className="text-xs text-muted-foreground">{new Date(note.created_at).toLocaleString("he-IL")}</span>
                  </div>
                  {note.original_question && <div><span className="text-xs font-semibold text-muted-foreground">השאלה:</span><p className="whitespace-pre-wrap font-medium">{note.original_question}</p></div>}
                  {note.target_kind === "answer" && note.target_text && <div className="rounded-lg border border-gold/30 bg-card p-2"><span className="text-xs font-semibold text-muted-foreground">התשובה שעליה נכתבה ההערה:</span><p>{note.target_text}</p></div>}
                  <div className="rounded-lg bg-card p-3 whitespace-pre-wrap"><b>הערת המשתמש:</b> {note.note.replace(/^\[[^\]]+\]\s*/u, "")}</div>
                  {note.status === "open" ? <>
                    <Textarea value={responses[note.id] ?? ""} onChange={(event) => setResponses((current) => ({ ...current, [note.id]: event.target.value }))} placeholder="תגובה או הסבר למשתמש (אופציונלי)…" className="min-h-20" />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void decide(note, "accepted")} disabled={busyId === note.id} className="gap-1 bg-emerald-700 text-white hover:bg-emerald-800"><Check className="h-4 w-4" />קבל הערה</Button>
                      <Button variant="destructive" onClick={() => void decide(note, "rejected")} disabled={busyId === note.id} className="gap-1"><X className="h-4 w-4" />דחה הערה</Button>
                    </div>
                  </> : note.admin_response && <div className="text-sm text-muted-foreground"><b>תגובת המנהל:</b> {note.admin_response}</div>}
                </div>)}
              </AccordionContent>
            </AccordionItem>;
          })}
        </Accordion>
      )}
    </Card>
  );
}
