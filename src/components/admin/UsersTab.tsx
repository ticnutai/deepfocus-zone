import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  UserPlus, X, Search, CheckCircle2, XCircle, Clock, Pencil, Trash2, Plus, MoreHorizontal, KeyRound,
  CheckSquare2, Square,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface Profile { id: string; display_name: string | null; email: string | null; created_at: string; status: string; }
interface Role { id: string; name: string; description: string | null; }
interface UR { user_id: string; role_id: string; }

const STATUS_LABEL: Record<string, string> = { approved: "מאושר", pending: "ממתין", blocked: "חסום" };
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default", pending: "secondary", blocked: "destructive",
};

export function UsersTab() {
  const { user: me } = useAuth();
  const isMobile = useIsMobile();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [userRoles, setUserRoles] = useState<UR[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"email" | "username">("email");
  const [newEmail, setNewEmail] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<string>("user");
  const [newStatus, setNewStatus] = useState<string>("approved");

  const [editing, setEditing] = useState<Profile | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");

  const [deleting, setDeleting] = useState<Profile | null>(null);

  const [pwdTarget, setPwdTarget] = useState<Profile | null>(null);
  const [newPwd, setNewPwd] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDelConfirm, setBulkDelConfirm] = useState(false);

  const load = async () => {
    const [{ data: p }, { data: r }, { data: ur }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, email, created_at, status").order("created_at", { ascending: false }),
      supabase.from("app_roles").select("id, name, description").order("name"),
      supabase.from("user_roles").select("user_id, role_id"),
    ]);
    setProfiles((p ?? []) as Profile[]);
    setRoles((r ?? []) as Role[]);
    setUserRoles((ur ?? []) as UR[]);
  };
  useEffect(() => { load(); }, []);

  const rolesOf = (uid: string) =>
    userRoles.filter((u) => u.user_id === uid).map((u) => roles.find((r) => r.id === u.role_id)).filter(Boolean) as Role[];

  const assign = async (uid: string, roleId: string) => {
    if (!roleId) return;
    setBusy(true);
    const { error } = await supabase.from("user_roles").insert({ user_id: uid, role_id: roleId, assigned_by: me?.id ?? null });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("התפקיד נוסף");
    load();
  };

  const remove = async (uid: string, roleId: string) => {
    setBusy(true);
    const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role_id", roleId);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("התפקיד הוסר");
    load();
  };

  const setStatus = async (id: string, status: "approved" | "pending" | "blocked") => {
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(status === "approved" ? "אושר" : status === "blocked" ? "נחסם" : "הועבר להמתנה");
    load();
  };

  const resetAddForm = () => {
    setCreateMode("email");
    setNewEmail(""); setNewUsername(""); setUsernameSuggestions([]);
    setNewPassword(""); setNewName(""); setNewRole("user"); setNewStatus("approved");
  };

  const loadSuggestions = async (base: string) => {
    const clean = base.trim();
    if (!clean) { setUsernameSuggestions([]); return; }
    const { data } = await supabase.rpc("suggest_usernames", { p_base: clean, p_count: 5 });
    setUsernameSuggestions((data as string[] | null) ?? []);
  };

  const createUser = async () => {
    if (newPassword.length < 6) {
      toast.error("סיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }
    if (createMode === "email" && !newEmail.trim()) {
      toast.error('דוא"ל נדרש');
      return;
    }
    if (createMode === "username" && !newUsername.trim()) {
      toast.error("שם משתמש נדרש");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("admin_create_user", {
      p_email: createMode === "email" ? newEmail.trim() : null,
      p_password: newPassword,
      p_display_name: newName.trim() || null,
      p_role_name: newRole,
      p_status: newStatus,
      p_username: createMode === "username" ? newUsername.trim() : null,
    } as never);
    setBusy(false);
    if (error) {
      if (createMode === "username" && /taken/i.test(error.message)) {
        await loadSuggestions(newUsername.trim());
      }
      return toast.error(error.message);
    }
    toast.success(`המשתמש ${createMode === "username" ? newUsername : newEmail} נוצר בהצלחה`);
    setAddOpen(false);
    resetAddForm();
    load();
  };

  const startEdit = (p: Profile) => {
    setEditing(p);
    setEditName(p.display_name ?? "");
    setEditEmail(p.email ?? "");
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_update_user", {
      p_user_id: editing.id,
      p_display_name: editName.trim() || null,
      p_email: editEmail.trim() || null,
      p_status: null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("הפרטים עודכנו");
    setEditing(null);
    load();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_delete_user", { p_user_id: deleting.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("המשתמש נמחק");
    setDeleting(null);
    load();
  };

  const savePassword = async () => {
    if (!pwdTarget) return;
    if (newPwd.length < 6) { toast.error("סיסמה חייבת להכיל לפחות 6 תווים"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("admin_set_password", { p_user_id: pwdTarget.id, p_password: newPwd } as never);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("הסיסמה עודכנה — המשתמש יכול כעת להיכנס עם דוא\"ל וסיסמה");
    setPwdTarget(null);
    setNewPwd("");
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((p) => p.id)));
    }
  };

  const bulkDelete = async () => {
    setBusy(true);
    let ok = 0, fail = 0;
    for (const id of selected) {
      const { error } = await supabase.rpc("admin_delete_user", { p_user_id: id });
      if (error) fail++; else ok++;
    }
    setBusy(false);
    setBulkDelConfirm(false);
    setSelected(new Set());
    if (ok) toast.success(`${ok} משתמשים נמחקו`);
    if (fail) toast.error(`${fail} נכשלו`);
    load();
  };

  const visible = profiles.filter((p) =>
    !filter ||
    p.display_name?.toLowerCase().includes(filter.toLowerCase()) ||
    (p.email ?? "").toLowerCase().includes(filter.toLowerCase()) ||
    p.id.includes(filter)
  );

  return (
    <TooltipProvider>
      <Card className="gold-frame p-4 space-y-4" dir="rtl">
        {/* Header: search + add */}
        <div className="flex items-center gap-2 flex-wrap">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder='חיפוש לפי שם / דוא"ל…'
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 min-w-[200px] text-right"
          />
          <Badge variant="outline" className="border-gold/60 shrink-0">{visible.length}</Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleSelectAll}
                className={`h-8 w-8 shrink-0 transition-colors ${allVisibleSelected ? "text-gold" : "text-muted-foreground hover:text-gold"}`}
              >
                {allVisibleSelected
                  ? <CheckSquare2 className="h-4 w-4" />
                  : <Square className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{allVisibleSelected ? "נקה הכל" : "בחר הכל"}</TooltipContent>
          </Tooltip>
          <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) resetAddForm(); }}>
            <DialogTrigger asChild>
              <Button className="gap-1 bg-gradient-navy text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4" />
                הוסף משתמש
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md" dir="rtl">
              <DialogHeader>
                <DialogTitle className="text-right">הוספת משתמש חדש</DialogTitle>
                <DialogDescription className="text-right">צור חשבון חדש ושייך לתפקיד התחלתי</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={createMode === "email" ? "default" : "outline"}
                    onClick={() => setCreateMode("email")}
                    className="flex-1"
                  >
                    דוא"ל
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={createMode === "username" ? "default" : "outline"}
                    onClick={() => setCreateMode("username")}
                    className="flex-1"
                  >
                    שם משתמש בלבד
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-right block">שם תצוגה</Label>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="לא חובה" className="text-right" />
                </div>
                {createMode === "email" ? (
                  <div className="space-y-1">
                    <Label className="text-right block">דוא"ל *</Label>
                    <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" dir="ltr" />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-right block">שם משתמש * (אותיות/ספרות/_/. — לפחות 3)</Label>
                    <Input
                      value={newUsername}
                      onChange={(e) => { setNewUsername(e.target.value); setUsernameSuggestions([]); }}
                      dir="ltr"
                      placeholder="yossi"
                    />
                    {usernameSuggestions.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        <span className="text-xs text-muted-foreground">הצעות:</span>
                        {usernameSuggestions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => { setNewUsername(s); setUsernameSuggestions([]); }}
                            className="text-xs px-2 py-0.5 rounded border border-gold/40 hover:bg-gold/10"
                            dir="ltr"
                          >{s}</button>
                        ))}
                      </div>
                    )}
                    {newUsername.trim() && (
                      <p className="text-[10px] text-muted-foreground" dir="ltr">
                        login email will be: {newUsername.trim().toLowerCase()}@users.local
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-right block">סיסמה * (לפחות 6 תווים)</Label>
                  <Input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" dir="ltr" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-right block">תפקיד</Label>
                    <Select value={newRole} onValueChange={setNewRole}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-right block">סטטוס</Label>
                    <Select value={newStatus} onValueChange={setNewStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="approved">מאושר</SelectItem>
                        <SelectItem value="pending">ממתין</SelectItem>
                        <SelectItem value="blocked">חסום</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>ביטול</Button>
                <Button onClick={createUser} disabled={busy}>צור משתמש</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 bg-gold/10 border border-gold/40 rounded-lg px-3 py-2 flex-wrap">
            <span className="text-sm font-medium">{selected.size} נבחרו</span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())} className="h-7 text-xs border-gold/50">
              נקה בחירה
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setBulkDelConfirm(true)} disabled={busy} className="h-7 text-xs gap-1">
              <Trash2 className="h-3 w-3" />
              מחק {selected.size} נבחרים
            </Button>
          </div>
        )}

        {/* User list */}
        <div className="space-y-2">
          {visible.map((p) => {
            const userRolesList = rolesOf(p.id);
            const availableRoles = roles.filter((r) => !userRolesList.find((ur) => ur.id === r.id));
            const isMe = p.id === me?.id;
            return (
              <div key={p.id} className={`rounded-xl border-2 p-3 space-y-2 transition-colors ${selected.has(p.id) ? "border-gold bg-gold/5" : "border-gold/40 bg-card"}`}>
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="flex-1 min-w-0 flex items-start justify-between gap-2 flex-wrap">
                  <div className="space-y-0.5 min-w-0 flex-1 text-right">
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {isMe && <Badge variant="outline" className="text-xs border-gold/60">אתה</Badge>}
                      <Badge variant={STATUS_VARIANT[p.status] ?? "outline"} className="text-xs">
                        {STATUS_LABEL[p.status] ?? p.status}
                      </Badge>
                      <span className="font-medium text-foreground">{p.display_name || "(ללא שם)"}</span>
                    </div>
                    {p.email && <div className="text-xs text-muted-foreground" dir="ltr">{p.email}</div>}
                    <div className="text-[10px] text-muted-foreground/70 font-mono" dir="ltr">{p.id}</div>
                  </div>

                  <div className="flex items-center gap-1 flex-wrap">
                    {isMobile ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline" className="h-8 border-gold/50 gap-1">
                            <MoreHorizontal className="h-4 w-4" />
                            עוד
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!isMe && p.status !== "approved" && (
                            <DropdownMenuItem onClick={() => void setStatus(p.id, "approved")} disabled={busy}>
                              אשר
                            </DropdownMenuItem>
                          )}
                          {!isMe && p.status !== "pending" && (
                            <DropdownMenuItem onClick={() => void setStatus(p.id, "pending")} disabled={busy}>
                              השהה
                            </DropdownMenuItem>
                          )}
                          {!isMe && p.status !== "blocked" && (
                            <DropdownMenuItem onClick={() => void setStatus(p.id, "blocked")} disabled={busy}>
                              חסום
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => startEdit(p)} disabled={busy}>
                            עריכה
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setPwdTarget(p); setNewPwd(""); }} disabled={busy}>
                            הגדר סיסמה
                          </DropdownMenuItem>
                          {!isMe && (
                            <DropdownMenuItem onClick={() => setDeleting(p)} disabled={busy}>
                              מחיקה
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <>
                        {!isMe && p.status !== "approved" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" onClick={() => setStatus(p.id, "approved")} disabled={busy}
                                className="h-8 w-8 text-emerald-600 hover:bg-emerald-50">
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>אשר</TooltipContent>
                          </Tooltip>
                        )}
                        {!isMe && p.status !== "pending" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" onClick={() => setStatus(p.id, "pending")} disabled={busy}
                                className="h-8 w-8 text-amber-500 hover:bg-amber-50">
                                <Clock className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>השהה</TooltipContent>
                          </Tooltip>
                        )}
                        {!isMe && p.status !== "blocked" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" onClick={() => setStatus(p.id, "blocked")} disabled={busy}
                                className="h-8 w-8 text-destructive hover:bg-destructive/10">
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>חסום</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon" variant="ghost" onClick={() => startEdit(p)} disabled={busy}
                              className="h-8 w-8 text-blue-600 hover:bg-blue-50">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>עריכה</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon" variant="ghost" onClick={() => { setPwdTarget(p); setNewPwd(""); }} disabled={busy}
                              className="h-8 w-8 text-violet-600 hover:bg-violet-50">
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>הגדר סיסמה</TooltipContent>
                        </Tooltip>
                        {!isMe && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" onClick={() => setDeleting(p)} disabled={busy}
                                className="h-8 w-8 text-destructive hover:bg-destructive/10">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>מחיקה</TooltipContent>
                          </Tooltip>
                        )}
                      </>
                    )}
                  </div>
                  </div>
                  <button
                    onClick={() => toggleSelect(p.id)}
                    className="shrink-0 mt-0.5 text-muted-foreground hover:text-gold transition-colors"
                    title={selected.has(p.id) ? "בטל בחירה" : "בחר"}
                  >
                    {selected.has(p.id)
                      ? <CheckSquare2 className="h-5 w-5 text-gold" />
                      : <Square className="h-5 w-5" />}
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {availableRoles.length > 0 && (
                    <Select onValueChange={(v) => assign(p.id, v)}>
                      <SelectTrigger className="w-44 h-7 text-xs">
                        <UserPlus className="h-3 w-3 ml-1" />
                        <SelectValue placeholder="הוסף תפקיד" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableRoles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name}{r.description ? ` – ${r.description}` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {userRolesList.map((r) => (
                    <Badge key={r.id} variant={r.name === "admin" ? "default" : "secondary"} className="gap-1">
                      <button
                        onClick={() => remove(p.id, r.id)}
                        disabled={busy || (r.name === "admin" && isMe)}
                        className="hover:text-destructive disabled:opacity-50"
                        aria-label="הסר תפקיד"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      {r.name}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          })}
          {!visible.length && <div className="text-center text-sm text-muted-foreground py-6">אין משתמשים להצגה</div>}
        </div>

        {/* Edit dialog */}
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-right">עריכת משתמש</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-right block">שם תצוגה</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="text-right" />
              </div>
              <div className="space-y-1">
                <Label className="text-right block">דוא"ל</Label>
                <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} type="email" dir="ltr" />
              </div>
            </div>
            <DialogFooter className="flex-row-reverse">
              <Button onClick={saveEdit} disabled={busy}>שמור</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>ביטול</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Set password dialog */}
        <Dialog open={!!pwdTarget} onOpenChange={(o) => { if (!o) { setPwdTarget(null); setNewPwd(""); } }}>
          <DialogContent className="max-w-sm" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-right">הגדרת סיסמה</DialogTitle>
              <DialogDescription className="text-right">
                {pwdTarget?.display_name || pwdTarget?.email} — המשתמש יוכל להיכנס עם דוא"ל וסיסמה.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label className="text-right block">סיסמה חדשה (לפחות 6 תווים)</Label>
              <Input
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                type="password"
                dir="ltr"
                placeholder="••••••••"
                onKeyDown={(e) => e.key === "Enter" && savePassword()}
              />
            </div>
            <DialogFooter className="flex-row-reverse">
              <Button onClick={savePassword} disabled={busy || newPwd.length < 6}>שמור סיסמה</Button>
              <Button variant="outline" onClick={() => { setPwdTarget(null); setNewPwd(""); }}>ביטול</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk delete confirm */}
        <AlertDialog open={bulkDelConfirm} onOpenChange={(o) => !o && setBulkDelConfirm(false)}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-right">מחיקת {selected.size} משתמשים</AlertDialogTitle>
              <AlertDialogDescription className="text-right">
                האם למחוק את {selected.size} המשתמשים הנבחרים? פעולה זו אינה הפיכה.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row-reverse">
              <AlertDialogAction onClick={bulkDelete} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                מחק הכל
              </AlertDialogAction>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete confirm */}
        <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-right">מחיקת משתמש</AlertDialogTitle>
              <AlertDialogDescription className="text-right">
                האם למחוק את <strong>{deleting?.display_name || deleting?.email}</strong>? פעולה זו אינה הפיכה.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row-reverse">
              <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                מחק
              </AlertDialogAction>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </TooltipProvider>
  );
}
