import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  UserPlus, X, Search, CheckCircle2, XCircle, Clock, Pencil, Trash2, Plus,
} from "lucide-react";

interface Profile { id: string; display_name: string | null; email: string | null; created_at: string; status: string; }
interface Role { id: string; name: string; description: string | null; }
interface UR { user_id: string; role_id: string; }

const STATUS_LABEL: Record<string, string> = { approved: "מאושר", pending: "ממתין", blocked: "חסום" };
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default", pending: "secondary", blocked: "destructive",
};

export function UsersTab() {
  const { user: me } = useAuth();
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
                <div className="space-y-1">
                  <Label className="text-right block">שם תצוגה</Label>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="לא חובה" className="text-right" />
                </div>
                <div className="space-y-1">
                  <Label className="text-right block">דוא"ל *</Label>
                  <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" dir="ltr" />
                </div>
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

        {/* User list */}
        <div className="space-y-2">
          {visible.map((p) => {
            const userRolesList = rolesOf(p.id);
            const availableRoles = roles.filter((r) => !userRolesList.find((ur) => ur.id === r.id));
            const isMe = p.id === me?.id;
            return (
              <div key={p.id} className="rounded-xl border-2 border-gold/40 bg-card p-3 space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
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
                  </div>
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
