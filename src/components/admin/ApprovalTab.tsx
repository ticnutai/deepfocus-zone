import { useEffect, useState } from "react";
import { toHebrewDate } from "@/lib/hebrewDate";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Plus, Trash2, CheckCircle2, XCircle, MailCheck, Clock } from "lucide-react";

interface PendingProfile {
  id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
  status: string;
}

interface ApprovedEmail {
  id: string;
  email: string;
  note: string | null;
  created_at: string;
}

export function ApprovalTab() {
  const { user: me } = useAuth();
  const [pending, setPending] = useState<PendingProfile[]>([]);
  const [approvedEmails, setApprovedEmails] = useState<ApprovedEmail[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: p }, { data: ae }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, email, created_at, status")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("approved_emails")
        .select("id, email, note, created_at")
        .order("created_at", { ascending: false }),
    ]);
    setPending((p ?? []) as PendingProfile[]);
    setApprovedEmails((ae ?? []) as ApprovedEmail[]);
  };

  useEffect(() => { load(); }, []);

  const setStatus = async (id: string, status: "approved" | "blocked") => {
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(status === "approved" ? "החשבון אושר" : "החשבון נחסם");
    load();
  };

  const addEmail = async () => {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) return toast.error('הזן כתובת דוא"ל');
    setBusy(true);
    const { error } = await supabase.from("approved_emails").insert({
      email: trimmed,
      note: newNote.trim() || null,
      added_by: me?.id ?? null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('הדוא"ל נוסף לרשימה המאושרת');
    setNewEmail(""); setNewNote("");
    load();
  };

  const removeEmail = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.from("approved_emails").delete().eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("הוסר מהרשימה");
    load();
  };

  return (
    <div className="space-y-4">
      {/* Pending accounts */}
      <Card className="gold-frame p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-gold" />
          <h3 className="font-display text-lg font-semibold">חשבונות ממתינים לאישור</h3>
          {pending.length > 0 && (
            <Badge className="bg-gradient-navy text-primary-foreground">{pending.length}</Badge>
          )}
        </div>

        {pending.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6 rounded-xl border-2 border-dashed border-gold/30">
            אין חשבונות ממתינים לאישור
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl border-2 border-gold/40 bg-card p-3 flex-wrap"
              >
                <div className="space-y-0.5">
                  <div className="font-medium text-foreground">{p.display_name || "(ללא שם)"}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">{p.email ?? p.id}</div>
                  <div className="text-xs text-muted-foreground">
                    נרשם: {new Date(p.created_at).toLocaleString("he-IL")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => setStatus(p.id, "approved")}
                    disabled={busy}
                    className="bg-gradient-navy text-primary-foreground gap-1"
                  >
                    <CheckCircle2 className="h-4 w-4" /> אשר
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStatus(p.id, "blocked")}
                    disabled={busy}
                    className="border-destructive text-destructive hover:bg-destructive/10 gap-1"
                  >
                    <XCircle className="h-4 w-4" /> חסום
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Pre-approved emails */}
      <Card className="gold-frame p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MailCheck className="h-4 w-4 text-gold" />
          <h3 className="font-display text-lg font-semibold">דוא"ל מאושר מראש</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          כל מי שנרשם עם כתובות אלו יאושר אוטומטית בלי המתנה.
        </p>

        <div className="grid sm:grid-cols-3 gap-2">
          <Input
            dir="ltr"
            placeholder="user@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEmail()}
          />
          <Input
            placeholder="הערה (אופציונלי)"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEmail()}
          />
          <Button onClick={addEmail} disabled={busy} className="bg-gradient-navy text-primary-foreground">
            <Plus className="h-4 w-4" /> הוסף
          </Button>
        </div>

        <Separator className="border-gold/20" />

        <div className="space-y-2">
          {approvedEmails.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-4">אין כתובות מאושרות מראש</div>
          ) : (
            approvedEmails.map((ae) => (
              <div
                key={ae.id}
                className="flex items-center justify-between gap-2 rounded-xl border-2 border-gold/40 bg-card p-3"
              >
                <div>
                  <div className="font-medium text-foreground" dir="ltr">{ae.email}</div>
                  {ae.note && <div className="text-xs text-muted-foreground">{ae.note}</div>}
                  <div className="text-xs text-muted-foreground">
                    נוסף: {toHebrewDate(new Date(ae.created_at))}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeEmail(ae.id)}
                  disabled={busy}
                  className="text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
