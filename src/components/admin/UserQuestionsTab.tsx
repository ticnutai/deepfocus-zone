import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, Download, Eye, EyeOff, FileText, Loader2, Pencil, Printer,
  RefreshCw, Search, Send, Trash2, Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Card as StudyCard } from "@/lib/study/types";
import { defaultSrs } from "@/lib/study/srs";
import { exportCardsDocument, type UserQuestionExportFormat } from "@/lib/study/userQuestionsExport";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { ChangeNotesTab } from "./ChangeNotesTab";

type CardRow = Database["public"]["Tables"]["cards"]["Row"];
type ProfileRow = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "display_name" | "email">;
type ModerationStatus = "private" | "reviewed" | "hidden" | "published";

const STATUS_LABEL: Record<ModerationStatus, string> = {
  private: "טרם נבדקה",
  reviewed: "נבדקה",
  hidden: "מוסתרת",
  published: "הועברה למאגר",
};

const TYPE_LABEL: Record<string, string> = {
  flashcard: "כרטיסייה",
  multiple: "אמריקאי",
  boolean: "נכון / לא נכון",
  combo: "משולבת",
};

function stringArray(value: Json | null): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberArray(value: Json | null): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

function rowToCard(row: CardRow): StudyCard {
  const base = {
    id: row.id,
    deckId: row.deck_id,
    question: row.question,
    tags: stringArray(row.tags),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    srs: row.srs && typeof row.srs === "object" ? row.srs as StudyCard["srs"] : defaultSrs(),
    stats: row.stats && typeof row.stats === "object" ? row.stats as StudyCard["stats"] : { totalReviews: 0, correct: 0, incorrect: 0 },
    masechta: row.masechta,
    daf: row.daf,
    amud: (row.amud === 1 ? 1 : row.amud === 2 ? 2 : null) as 1 | 2 | null,
  };
  if (row.type === "flashcard") return { ...base, type: "flashcard", answer: row.answer ?? "" };
  if (row.type === "boolean") return { ...base, type: "boolean", correct: !!row.correct_boolean, explanation: row.explanation ?? undefined };
  if (row.type === "multiple") return { ...base, type: "multiple", options: stringArray(row.options), correctIndices: numberArray(row.correct_indices), explanation: row.explanation ?? undefined };
  return { ...base, type: "combo", answer: row.answer ?? undefined, options: stringArray(row.options), correctIndices: numberArray(row.correct_indices), explanation: row.explanation ?? undefined };
}

async function fetchAllCards(): Promise<CardRow[]> {
  const all: CardRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("cards").select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as CardRow[];
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

export function UserQuestionsTab() {
  const [rows, setRows] = useState<CardRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("visible");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editing, setEditing] = useState<CardRow | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [editExplanation, setEditExplanation] = useState("");
  const [editOptions, setEditOptions] = useState("");
  const [editCorrect, setEditCorrect] = useState("");
  const [deleting, setDeleting] = useState<CardRow | null>(null);
  const [sourceUserId, setSourceUserId] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<UserQuestionExportFormat | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: profileData, error: profileError }, cardRows, sourceResult, authResult] = await Promise.all([
        supabase.from("profiles").select("id,display_name,email"),
        fetchAllCards(),
        supabase.rpc("get_guest_source_user_id"),
        supabase.auth.getUser(),
      ]);
      if (profileError) throw profileError;
      const sourceId = typeof sourceResult.data === "string" ? sourceResult.data : null;
      setSourceUserId(sourceId);
      setMeId(authResult.data.user?.id ?? null);
      setProfiles((profileData ?? []) as ProfileRow[]);
      setRows(cardRows.filter((row) => {
        const tags = stringArray(row.tags);
        return row.user_id !== sourceId
          && !tags.some((tag) => tag.startsWith("source:builtin") || tag === "source:site_library");
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טעינת שאלות המשתמשים נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const profileMap = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const userChoices = useMemo(() => {
    const ids = [...new Set(rows.map((row) => row.user_id))];
    return ids.map((id) => ({ id, profile: profileMap.get(id), count: rows.filter((row) => row.user_id === id).length }));
  }, [profileMap, rows]);

  const filtered = useMemo(() => rows.filter((row) => {
    const status = (row.moderation_status || "private") as ModerationStatus;
    if (userFilter !== "all" && row.user_id !== userFilter) return false;
    if (statusFilter === "visible" && status === "hidden") return false;
    if (statusFilter !== "all" && statusFilter !== "visible" && status !== statusFilter) return false;
    if (typeFilter !== "all" && row.type !== typeFilter) return false;
    if (dateFrom && row.created_at.slice(0, 10) < dateFrom) return false;
    if (dateTo && row.created_at.slice(0, 10) > dateTo) return false;
    const q = search.trim().toLocaleLowerCase("he");
    if (!q) return true;
    const profile = profileMap.get(row.user_id);
    return [row.question, row.answer, row.explanation, ...stringArray(row.options), ...stringArray(row.tags), profile?.display_name, profile?.email]
      .some((value) => value?.toLocaleLowerCase("he").includes(q));
  }), [dateFrom, dateTo, profileMap, rows, search, statusFilter, typeFilter, userFilter]);

  const updateModeration = async (row: CardRow, status: ModerationStatus) => {
    setBusyId(row.id);
    const { error } = await supabase.from("cards").update({
      moderation_status: status,
      moderated_at: new Date().toISOString(),
      moderated_by: meId,
    }).eq("id", row.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(status === "hidden" ? "השאלה הוסתרה מרשימת ברירת המחדל" : "סטטוס השאלה עודכן");
    await load();
  };

  const startEdit = (row: CardRow) => {
    setEditing(row);
    setEditQuestion(row.question);
    setEditAnswer(row.answer ?? (row.type === "boolean" ? (row.correct_boolean ? "נכון" : "לא נכון") : ""));
    setEditExplanation(row.explanation ?? "");
    setEditOptions(stringArray(row.options).join("\n"));
    setEditCorrect(numberArray(row.correct_indices).map((index) => String(index + 1)).join(","));
  };

  const saveEdit = async () => {
    if (!editing || !editQuestion.trim()) return;
    setBusyId(editing.id);
    const options = editOptions.split("\n").map((value) => value.trim()).filter(Boolean);
    const correctIndices = editCorrect.split(",").map((value) => Number(value.trim()) - 1).filter((value) => Number.isInteger(value) && value >= 0 && value < options.length);
    const { error } = await supabase.from("cards").update({
      question: editQuestion.trim(),
      answer: editing.type === "flashcard" || editing.type === "combo" ? editAnswer.trim() : editing.answer,
      correct_boolean: editing.type === "boolean" ? editAnswer.trim() !== "לא נכון" : editing.correct_boolean,
      explanation: editExplanation.trim() || null,
      options: options as Json,
      correct_indices: correctIndices as Json,
      moderation_status: "reviewed",
      moderated_at: new Date().toISOString(),
      moderated_by: meId,
      updated_at: new Date().toISOString(),
    }).eq("id", editing.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("השאלה עודכנה וסומנה כנבדקה");
    setEditing(null);
    await load();
  };

  const publish = async (row: CardRow) => {
    if (!meId) return toast.error("לא נמצא משתמש מנהל מחובר");
    setBusyId(row.id);
    const publishedId = crypto.randomUUID();
    const tags = [...new Set([...stringArray(row.tags), "source:site_library", `source:user:${row.user_id}`])];
    const { error: insertError } = await supabase.from("cards").insert({
      id: publishedId,
      user_id: sourceUserId ?? meId,
      deck_id: null,
      type: row.type,
      question: row.question,
      answer: row.answer,
      options: row.options,
      correct_indices: row.correct_indices,
      correct_boolean: row.correct_boolean,
      explanation: row.explanation,
      tags,
      srs: defaultSrs() as unknown as Json,
      stats: { totalReviews: 0, correct: 0, incorrect: 0 },
      masechta: row.masechta,
      daf: row.daf,
      amud: row.amud,
      moderation_status: "published",
      moderated_at: new Date().toISOString(),
      moderated_by: meId,
    });
    if (insertError) {
      setBusyId(null);
      return toast.error(insertError.message);
    }
    const { error: updateError } = await supabase.from("cards").update({
      moderation_status: "published",
      published_card_id: publishedId,
      moderated_at: new Date().toISOString(),
      moderated_by: meId,
    }).eq("id", row.id);
    setBusyId(null);
    if (updateError) return toast.error(updateError.message);
    toast.success("השאלה אושרה והועתקה למאגר האתר");
    await load();
  };

  const softDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    const now = new Date().toISOString();
    const { error } = await supabase.from("cards").update({ deleted_at: now, updated_at: now }).eq("id", deleting.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("השאלה הוסרה וניתנת לשחזור מבסיס הנתונים");
    setDeleting(null);
    await load();
  };

  const doExport = async (format: UserQuestionExportFormat) => {
    if (!filtered.length) return;
    setExporting(format);
    try {
      const userName = userFilter === "all" ? "כל המשתמשים" : (profileMap.get(userFilter)?.display_name || profileMap.get(userFilter)?.email || "משתמש");
      await exportCardsDocument(filtered.map(rowToCard), format, `שאלות משתמשים — ${userName}`, "שאלות-משתמשים");
      toast.success(`יוצאו ${filtered.length.toLocaleString("he-IL")} שאלות`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הייצוא נכשל");
    } finally {
      setExporting(null);
    }
  };

  if (loading) return <Card className="gold-frame p-8 text-center text-muted-foreground"><Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />טוען שאלות משתמשים…</Card>;

  return (
    <div className="space-y-4" dir="rtl">
      <ChangeNotesTab />
      <Card className="gold-frame p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-xl font-bold"><Users className="h-5 w-5 text-gold" />שאלות משתמשים</h3>
            <p className="text-sm text-muted-foreground">תוכן פרטי נשאר פרטי עד לפעולת „אשר והעבר למאגר”. מאגר האתר אינו מוצג כאן.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void doExport("docx")} disabled={!filtered.length || exporting !== null}><FileText className="h-4 w-4 ml-1" />Word</Button>
            <Button variant="outline" onClick={() => void doExport("pdf")} disabled={!filtered.length || exporting !== null}><Printer className="h-4 w-4 ml-1" />PDF</Button>
            <Button size="icon" variant="outline" onClick={() => void load()} title="רענון"><RefreshCw className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <div className="relative md:col-span-2"><Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש בשאלה, תשובה, משתמש או סיווג…" className="pr-9" /></div>
          <Select value={userFilter} onValueChange={setUserFilter}><SelectTrigger><SelectValue placeholder="כל המשתמשים" /></SelectTrigger><SelectContent><SelectItem value="all">כל המשתמשים</SelectItem>{userChoices.map(({ id, profile, count }) => <SelectItem key={id} value={id}>{profile?.display_name || profile?.email || id.slice(0, 8)} ({count})</SelectItem>)}</SelectContent></Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="visible">הכול מלבד מוסתרות</SelectItem><SelectItem value="all">כל הסטטוסים</SelectItem>{Object.entries(STATUS_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל סוגי השאלות</SelectItem>{Object.entries(TYPE_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          <div className="flex gap-1"><Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} title="מתאריך" /><Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} title="עד תאריך" /></div>
        </div>
        <div className="flex flex-wrap gap-2 text-sm"><Badge variant="outline">{filtered.length.toLocaleString("he-IL")} מוצגות</Badge><Badge variant="outline">{rows.length.toLocaleString("he-IL")} שאלות משתמשים</Badge><Badge variant="outline">{userChoices.length.toLocaleString("he-IL")} משתמשים</Badge></div>
      </Card>

      <div className="grid gap-3">
        {filtered.map((row) => {
          const profile = profileMap.get(row.user_id);
          const status = (row.moderation_status || "private") as ModerationStatus;
          const options = stringArray(row.options);
          const correct = numberArray(row.correct_indices);
          return <Card key={row.id} className="gold-frame p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2"><Badge>{TYPE_LABEL[row.type] || row.type}</Badge><Badge variant="outline">{STATUS_LABEL[status]}</Badge><span className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString("he-IL")}</span></div>
                <p className="font-bold text-foreground whitespace-pre-wrap">{row.question}</p>
                <p className="mt-1 text-xs text-muted-foreground">{profile?.display_name || "ללא שם"} · {profile?.email || row.user_id}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="icon" variant="outline" title="עריכה" onClick={() => startEdit(row)}><Pencil className="h-4 w-4" /></Button>
                {status === "hidden" ? <Button size="icon" variant="outline" title="הצג מחדש" onClick={() => void updateModeration(row, "reviewed")}><Eye className="h-4 w-4" /></Button> : <Button size="icon" variant="outline" title="הסתר מרשימת ברירת המחדל" onClick={() => void updateModeration(row, "hidden")}><EyeOff className="h-4 w-4" /></Button>}
                <Button size="icon" variant="outline" title="סמן כנבדקה" onClick={() => void updateModeration(row, "reviewed")}><CheckCircle2 className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" title="אשר והעבר למאגר האתר" disabled={status === "published" || busyId === row.id} onClick={() => void publish(row)}><Send className="h-4 w-4" /></Button>
                <Button size="icon" variant="destructive" title="מחיקה" onClick={() => setDeleting(row)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              {row.type === "flashcard" && <p><b>תשובה:</b> {row.answer || "—"}</p>}
              {row.type === "boolean" && <p><b>תשובה:</b> {row.correct_boolean ? "נכון" : "לא נכון"}</p>}
              {options.map((option, index) => <p key={`${row.id}-${index}`} className={correct.includes(index) ? "font-bold text-emerald-700" : ""}>{correct.includes(index) ? "✓" : "○"} {option}</p>)}
              {row.explanation && <p className="mt-2"><b>הסבר:</b> {row.explanation}</p>}
            </div>
            {stringArray(row.tags).length > 0 && <div className="flex flex-wrap gap-1">{stringArray(row.tags).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div>}
          </Card>;
        })}
        {!filtered.length && <Card className="gold-frame p-10 text-center text-muted-foreground">לא נמצאו שאלות התואמות לסינון.</Card>}
      </div>

      <Dialog open={!!editing} onOpenChange={(value) => !value && setEditing(null)}>
        <DialogContent className="max-w-2xl" dir="rtl"><DialogHeader><DialogTitle>עריכת שאלת משתמש</DialogTitle><DialogDescription>השינוי נשמר אצל המשתמש ומסומן כבדיקת מנהל.</DialogDescription></DialogHeader>
          <div className="space-y-3"><div><Label>שאלה</Label><Textarea value={editQuestion} onChange={(event) => setEditQuestion(event.target.value)} rows={4} /></div>
            {(editing?.type === "flashcard" || editing?.type === "combo" || editing?.type === "boolean") && <div><Label>תשובה</Label><Textarea value={editAnswer} onChange={(event) => setEditAnswer(event.target.value)} rows={2} /></div>}
            {(editing?.type === "multiple" || editing?.type === "combo") && <><div><Label>אפשרויות — שורה לכל אפשרות</Label><Textarea value={editOptions} onChange={(event) => setEditOptions(event.target.value)} rows={5} /></div><div><Label>מספרי תשובות נכונות, לדוגמה 1,3</Label><Input value={editCorrect} onChange={(event) => setEditCorrect(event.target.value)} /></div></>}
            <div><Label>הסבר</Label><Textarea value={editExplanation} onChange={(event) => setEditExplanation(event.target.value)} rows={3} /></div>
          </div><DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>ביטול</Button><Button onClick={() => void saveEdit()} disabled={!editQuestion.trim() || busyId === editing?.id}>שמור וסמן כנבדקה</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(value) => !value && setDeleting(null)}><AlertDialogContent dir="rtl"><AlertDialogHeader><AlertDialogTitle>להסיר את השאלה?</AlertDialogTitle><AlertDialogDescription>השאלה תוסר מהמערכת, אך תישמר כמחיקה רכה בבסיס הנתונים לצורך שחזור.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>ביטול</AlertDialogCancel><AlertDialogAction onClick={() => void softDelete()} className="bg-destructive text-destructive-foreground">הסר שאלה</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
