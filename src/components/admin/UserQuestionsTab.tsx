import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, Eye, EyeOff, FileSpreadsheet, FileText, Loader2, Pencil, Printer,
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
import { Checkbox } from "@/components/ui/checkbox";
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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

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
  // Filtering in SQL is essential: downloading the entire bundled library
  // (22K+ cards) made this admin screen time out before user questions appeared.
  const { data, error } = await supabase.rpc("get_admin_user_questions" as never);
  if (error) throw error;
  return (data ?? []) as CardRow[];
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
  const [meId, setMeId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<UserQuestionExportFormat | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const authResult = await supabase.auth.getUser();
      const [{ data: profileData, error: profileError }, cardRows] = await Promise.all([
        supabase.from("profiles").select("id,display_name,email"),
        fetchAllCards(),
      ]);
      if (profileError) throw profileError;
      setMeId(authResult.data.user?.id ?? null);
      setProfiles((profileData ?? []) as ProfileRow[]);
      setRows(cardRows.filter((row) => {
        const tags = stringArray(row.tags);
        return !tags.some((tag) => tag.startsWith("source:builtin") || tag === "source:site_library");
      }));
      setSelectedIds((current) => new Set([...current].filter((id) => cardRows.some((row) => row.id === id && row.moderation_status !== "published"))));
    } catch (error) {
      toast.error(errorMessage(error, "טעינת שאלות המשתמשים נכשלה"));
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
    const { error } = await supabase.rpc("publish_user_question" as never, { p_card_id: row.id } as never);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("השאלה אושרה ונוספה למאגר המרכזי בסיווג שנבחר");
    await load();
  };

  const selectableFiltered = useMemo(
    () => filtered.filter((row) => (row.moderation_status || "private") !== "published"),
    [filtered],
  );
  const allFilteredSelected = selectableFiltered.length > 0 && selectableFiltered.every((row) => selectedIds.has(row.id));

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleAllFiltered = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of selectableFiltered) {
        if (checked) next.add(row.id); else next.delete(row.id);
      }
      return next;
    });
  };

  const publishSelected = async () => {
    const ids = [...selectedIds].filter((id) => rows.some((row) => row.id === id && (row.moderation_status || "private") !== "published"));
    if (!ids.length) return;
    setBulkPublishing(true);
    const { error } = await supabase.rpc("publish_user_questions" as never, { p_card_ids: ids } as never);
    setBulkPublishing(false);
    if (error) return toast.error(error.message);
    toast.success(`${ids.length.toLocaleString("he-IL")} שאלות אושרו ונוספו למאגר לפי הסיווג שלהן`);
    setSelectedIds(new Set());
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

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  );

  const deleteSelected = async () => {
    const ids = selectedRows.map((row) => row.id);
    if (!ids.length) return;
    setBulkDeleting(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from("cards").update({ deleted_at: now, updated_at: now }).in("id", ids);
    setBulkDeleting(false);
    if (error) return toast.error(error.message);
    toast.success(`${ids.length.toLocaleString("he-IL")} שאלות הוסרו בהצלחה`);
    setConfirmBulkDelete(false);
    setSelectedIds(new Set());
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

  const exportSelected = async (format: UserQuestionExportFormat) => {
    if (!selectedRows.length) return;
    setExporting(format);
    try {
      await exportCardsDocument(selectedRows.map(rowToCard), format, "שאלות ותשובות שנבחרו", "שאלות-נבחרות");
      toast.success(`יוצאו ${selectedRows.length.toLocaleString("he-IL")} שאלות שנבחרו`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הייצוא נכשל");
    } finally {
      setExporting(null);
    }
  };

  if (loading) return (
    <div className="space-y-4" dir="rtl">
      <ChangeNotesTab />
      <Card className="gold-frame p-8 text-center text-muted-foreground">
        <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />טוען שאלות משתמשים… ההערות זמינות כבר עכשיו.
      </Card>
    </div>
  );

  return (
    <div className="space-y-4" dir="rtl">
      <ChangeNotesTab />
      <Card className="gold-frame p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-xl font-bold"><Users className="h-5 w-5 text-gold" />שאלות משתמשים</h3>
            <p className="text-sm text-muted-foreground">תוכן פרטי נשאר פרטי עד לפעולת „אשר והעבר למאגר”. מאגר האתר אינו מוצג כאן.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void doExport("docx")} disabled={!filtered.length || exporting !== null}><FileText className="h-4 w-4 ml-1" />Word</Button>
            <Button variant="outline" onClick={() => void doExport("xlsx")} disabled={!filtered.length || exporting !== null}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
            <Button variant="outline" onClick={() => void doExport("csv")} disabled={!filtered.length || exporting !== null}><FileSpreadsheet className="h-4 w-4 ml-1" />CSV</Button>
            <Button variant="outline" onClick={() => void doExport("pdf")} disabled={!filtered.length || exporting !== null}><Printer className="h-4 w-4 ml-1" />PDF</Button>
            <Button size="icon" variant="outline" onClick={() => void load()} title="רענון"><RefreshCw className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 rounded-lg border bg-muted/10 p-3 md:grid-cols-2 xl:grid-cols-12">
          <div className="relative min-w-0 md:col-span-2 xl:col-span-4">
            <Label htmlFor="user-questions-search" className="mb-1 block text-xs text-muted-foreground">חיפוש</Label>
            <Search className="absolute right-3 top-8 h-4 w-4 text-muted-foreground" />
            <Input id="user-questions-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="שאלה, תשובה, משתמש או סיווג…" className="min-w-0 pr-9" />
          </div>
          <div className="min-w-0 xl:col-span-2">
            <Label className="mb-1 block text-xs text-muted-foreground">משתמש</Label>
            <Select value={userFilter} onValueChange={setUserFilter}><SelectTrigger className="w-full min-w-0"><SelectValue placeholder="כל המשתמשים" /></SelectTrigger><SelectContent><SelectItem value="all">כל המשתמשים</SelectItem>{userChoices.map(({ id, profile, count }) => <SelectItem key={id} value={id}>{profile?.display_name || profile?.email || id.slice(0, 8)} ({count})</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="min-w-0 xl:col-span-2">
            <Label className="mb-1 block text-xs text-muted-foreground">סטטוס</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="visible">הכול מלבד מוסתרות</SelectItem><SelectItem value="all">כל הסטטוסים</SelectItem>{Object.entries(STATUS_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="min-w-0 xl:col-span-2">
            <Label className="mb-1 block text-xs text-muted-foreground">סוג שאלה</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל סוגי השאלות</SelectItem>{Object.entries(TYPE_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2 md:col-span-2 xl:col-span-2">
            <div className="min-w-0"><Label htmlFor="user-questions-from" className="mb-1 block text-xs text-muted-foreground">מתאריך</Label><Input id="user-questions-from" className="min-w-0 px-2" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></div>
            <div className="min-w-0"><Label htmlFor="user-questions-to" className="mb-1 block text-xs text-muted-foreground">עד תאריך</Label><Input id="user-questions-to" className="min-w-0 px-2" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-sm"><Badge variant="outline">{filtered.length.toLocaleString("he-IL")} מוצגות</Badge><Badge variant="outline">{rows.length.toLocaleString("he-IL")} שאלות משתמשים</Badge><Badge variant="outline">{userChoices.length.toLocaleString("he-IL")} משתמשים</Badge></div>
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 lg:grid-cols-[minmax(260px,1fr)_auto]">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 font-medium">
              <Checkbox checked={allFilteredSelected} onCheckedChange={(value) => toggleAllFiltered(value === true)} disabled={!selectableFiltered.length} />
              בחר את כל השאלות המוצגות
            </label>
            <Badge variant="secondary">{selectedIds.size.toLocaleString("he-IL")} נבחרו</Badge>
            <Button onClick={() => void publishSelected()} disabled={!selectedIds.size || bulkPublishing}>
              {bulkPublishing ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Send className="ml-1 h-4 w-4" />}
              אשר נבחרות לסיווג
            </Button>
            <Button variant="destructive" onClick={() => setConfirmBulkDelete(true)} disabled={!selectedRows.length || bulkDeleting}>
              {bulkDeleting ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Trash2 className="ml-1 h-4 w-4" />}
              מחק נבחרות
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background/70 p-2">
            <span className="w-full text-xs font-medium text-muted-foreground sm:w-auto">הורדת הנבחרות</span>
            <Button size="sm" variant="outline" onClick={() => void exportSelected("docx")} disabled={!selectedRows.length || exporting !== null}><FileText className="ml-1 h-4 w-4" />Word</Button>
            <Button size="sm" variant="outline" onClick={() => void exportSelected("xlsx")} disabled={!selectedRows.length || exporting !== null}><FileSpreadsheet className="ml-1 h-4 w-4" />Excel</Button>
            <Button size="sm" variant="outline" onClick={() => void exportSelected("csv")} disabled={!selectedRows.length || exporting !== null}><FileSpreadsheet className="ml-1 h-4 w-4" />CSV</Button>
            <Button size="sm" variant="outline" onClick={() => void exportSelected("pdf")} disabled={!selectedRows.length || exporting !== null}><Printer className="ml-1 h-4 w-4" />PDF</Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-3">
        {filtered.map((row) => {
          const profile = profileMap.get(row.user_id);
          const status = (row.moderation_status || "private") as ModerationStatus;
          const options = stringArray(row.options);
          const correct = numberArray(row.correct_indices);
          const classification = stringArray(row.tags).filter((tag) => tag.startsWith("cat:")).map((tag) => tag.slice(4));
          return <Card key={row.id} className="gold-frame p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Checkbox
                className="mt-1"
                checked={selectedIds.has(row.id)}
                disabled={status === "published"}
                aria-label={`בחר שאלה: ${row.question}`}
                onCheckedChange={(value) => toggleSelected(row.id, value === true)}
              />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2"><Badge>{TYPE_LABEL[row.type] || row.type}</Badge><Badge variant="outline">{STATUS_LABEL[status]}</Badge><span className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString("he-IL")}</span></div>
                <p className="font-bold text-foreground whitespace-pre-wrap">{row.question}</p>
                <p className="mt-1 text-xs text-muted-foreground">{profile?.display_name || "ללא שם"} · {profile?.email || row.user_id}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="icon" variant="outline" title="עריכה" onClick={() => startEdit(row)}><Pencil className="h-4 w-4" /></Button>
                {status === "hidden" ? <Button size="icon" variant="outline" title="הצג מחדש" onClick={() => void updateModeration(row, "reviewed")}><Eye className="h-4 w-4" /></Button> : <Button size="icon" variant="outline" title="הסתר מרשימת ברירת המחדל" onClick={() => void updateModeration(row, "hidden")}><EyeOff className="h-4 w-4" /></Button>}
                <Button size="icon" variant="outline" title="סמן כנבדקה" onClick={() => void updateModeration(row, "reviewed")}><CheckCircle2 className="h-4 w-4" /></Button>
                <Button variant="outline" title="אישור בלחיצה אחת לסיווג שנבחר" disabled={status === "published" || busyId === row.id} onClick={() => void publish(row)}><Send className="ml-1 h-4 w-4" />{status === "published" ? "אושרה" : "אשר לסיווג"}</Button>
                <Button size="icon" variant="destructive" title="מחיקה" onClick={() => setDeleting(row)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              {row.type === "flashcard" && <p><b>תשובה:</b> {row.answer || "—"}</p>}
              {row.type === "boolean" && <p><b>תשובה:</b> {row.correct_boolean ? "נכון" : "לא נכון"}</p>}
              {options.map((option, index) => <p key={`${row.id}-${index}`} className={correct.includes(index) ? "font-bold text-emerald-700" : ""}>{correct.includes(index) ? "✓" : "○"} {option}</p>)}
              {row.explanation && <p className="mt-2"><b>הסבר:</b> {row.explanation}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-1 text-sm">
              <b>סיווג:</b>
              {classification.length > 0
                ? classification.map((name, index) => <span key={`${name}-${index}`} className="flex items-center gap-1"><Badge variant="outline">{name}</Badge>{index < classification.length - 1 && <span className="text-muted-foreground">←</span>}</span>)
                : <Badge variant="outline">ללא סיווג</Badge>}
            </div>
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
      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק {selectedRows.length.toLocaleString("he-IL")} שאלות שנבחרו?</AlertDialogTitle>
            <AlertDialogDescription>השאלות יוסרו יחד מהרשימה באמצעות מחיקה רכה, כך שהמידע יישאר בבסיס הנתונים לצורך שחזור.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteSelected()} disabled={bulkDeleting} className="bg-destructive text-destructive-foreground">
              {bulkDeleting && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
              מחק את השאלות
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
