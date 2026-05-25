import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  getActiveGuestViewProfileId,
  hydrateGuestProfilesFromSiteSettings,
  listGuestViewProfiles,
  loadGuestDefaultProfileIdFromSiteSettings,
  removeGuestViewProfile,
  saveGuestViewProfile,
  saveGuestDefaultProfileIdToSiteSettings,
  saveGuestViewProfilesToSiteSettings,
  setActiveGuestViewProfile,
  type GuestViewProfile,
} from "@/lib/auth/guestViewProfile";
import type { SidebarConfig, WidgetLayout } from "@/lib/study/types";
import { toast } from "sonner";
import { CheckCircle2, RefreshCw, Trash2, UserPlus } from "lucide-react";

interface AppRole {
  id: string;
  name: string;
}

interface RolePermissionRow {
  module: string;
  action: string;
  allowed: boolean;
}

interface RoleLayoutDefaultsRow {
  sidebar_config: SidebarConfig[] | null;
  widget_layout: WidgetLayout | null;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "מנהל",
  user: "משתמש רגיל",
  moderator: "מנחה",
  editor: "אדיטור",
};

const roleLabel = (name: string) => ROLE_LABEL[name] ?? name;

const generateId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `guest-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export function GuestProfilesTab() {
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profiles, setProfiles] = useState<GuestViewProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [profileLabel, setProfileLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("app_roles").select("id,name").order("name");
    const roleRows = (data ?? []) as AppRole[];
    setRoles(roleRows);

    const { profiles: hydratedProfiles } = await hydrateGuestProfilesFromSiteSettings();
    const localProfiles = listGuestViewProfiles();
    const needsMigration = hydratedProfiles.length === 0 && localProfiles.length > 0;

    if (needsMigration) {
      await saveGuestViewProfilesToSiteSettings(localProfiles);
      const localDefault = getActiveGuestViewProfileId() ?? localProfiles[0]?.id ?? null;
      await saveGuestDefaultProfileIdToSiteSettings(localDefault);
    }

    const defaultProfileId = await loadGuestDefaultProfileIdFromSiteSettings();
    const allProfiles = hydratedProfiles.length > 0 ? hydratedProfiles : localProfiles;
    setProfiles(allProfiles);
    const activeId = defaultProfileId ?? getActiveGuestViewProfileId();
    setActiveProfileId(activeId);

    if (!selectedRoleId && roleRows.length > 0) {
      setSelectedRoleId(roleRows[0].id);
      setProfileLabel(`תצוגת אורח: ${roleLabel(roleRows[0].name)}`);
    }
  }, [selectedRoleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );

  const buildProfileFromRole = useCallback(async (opts: { roleId: string; id?: string; label?: string }) => {
    const role = roles.find((r) => r.id === opts.roleId);
    if (!role) throw new Error("תפקיד לא נמצא");

    const [{ data: perms, error: permsError }, { data: defaults, error: defaultsError }] = await Promise.all([
      supabase
        .from("role_permissions")
        .select("module,action,allowed")
        .eq("role_id", role.id),
      supabase
        .from("role_layout_defaults")
        .select("sidebar_config,widget_layout")
        .eq("role_id", role.id)
        .maybeSingle(),
    ]);

    if (permsError) throw new Error(permsError.message);
    if (defaultsError) throw new Error(defaultsError.message);

    const matrix: Record<string, boolean> = {};
    ((perms ?? []) as RolePermissionRow[]).forEach((row) => {
      if (row.allowed) matrix[`${row.module}:${row.action}`] = true;
    });

    const defaultLabel = `תצוגת אורח: ${roleLabel(role.name)}`;
    return saveGuestViewProfile({
      id: opts.id ?? generateId(),
      label: (opts.label ?? "").trim() || defaultLabel,
      roleId: role.id,
      roleName: role.name,
      isAdmin: role.name === "admin",
      roles: [{ id: role.id, name: role.name }],
      matrix,
      sidebarConfig: ((defaults as RoleLayoutDefaultsRow | null)?.sidebar_config ?? undefined) ?? undefined,
      widgetLayout: ((defaults as RoleLayoutDefaultsRow | null)?.widget_layout ?? undefined) ?? undefined,
    });
  }, [roles]);

  const resetForm = () => {
    setEditingId(null);
    if (roles.length > 0) {
      setSelectedRoleId(roles[0].id);
      setProfileLabel(`תצוגת אורח: ${roleLabel(roles[0].name)}`);
    } else {
      setSelectedRoleId("");
      setProfileLabel("");
    }
  };

  const submit = async () => {
    if (!selectedRoleId) {
      toast.error("בחר תפקיד");
      return;
    }
    setBusy(true);
    try {
      const saved = await buildProfileFromRole({
        roleId: selectedRoleId,
        id: editingId ?? undefined,
        label: profileLabel,
      });

      const allProfiles = listGuestViewProfiles();
      await saveGuestViewProfilesToSiteSettings(allProfiles);
      const currentDefault = await loadGuestDefaultProfileIdFromSiteSettings();
      const nextDefault = currentDefault && allProfiles.some((p) => p.id === currentDefault)
        ? currentDefault
        : saved.id;
      await saveGuestDefaultProfileIdToSiteSettings(nextDefault);

      toast.success(editingId ? "פרופיל אורח עודכן" : "פרופיל אורח נוצר");
      await load();
      resetForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "שמירת פרופיל נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (profile: GuestViewProfile) => {
    setEditingId(profile.id);
    setSelectedRoleId(profile.roleId ?? "");
    setProfileLabel(profile.label);
  };

  const markAsDefault = async (profileId: string) => {
    setBusy(true);
    try {
      setActiveGuestViewProfile(profileId);
      await saveGuestDefaultProfileIdToSiteSettings(profileId);
      setActiveProfileId(profileId);
      toast.success("פרופיל ברירת המחדל לאורח עודכן");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "עדכון ברירת מחדל נכשל");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (profile: GuestViewProfile) => {
    setBusy(true);
    try {
    removeGuestViewProfile(profile.id);
    const nextProfiles = listGuestViewProfiles();
    await saveGuestViewProfilesToSiteSettings(nextProfiles);

    const currentDefault = await loadGuestDefaultProfileIdFromSiteSettings();
    let nextDefault: string | null = currentDefault;
    if (!nextDefault || nextDefault === profile.id || !nextProfiles.some((p) => p.id === nextDefault)) {
      nextDefault = nextProfiles[0]?.id ?? null;
    }
    await saveGuestDefaultProfileIdToSiteSettings(nextDefault);

    setActiveProfileId(nextDefault);
    setProfiles(nextProfiles);
    toast.success("פרופיל אורח נמחק");
    if (editingId === profile.id) resetForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "מחיקת פרופיל נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const refreshFromRole = async (profile: GuestViewProfile) => {
    if (!profile.roleId) {
      toast.error("לפרופיל אין תפקיד מקור");
      return;
    }
    setBusy(true);
    try {
      await buildProfileFromRole({
        roleId: profile.roleId,
        id: profile.id,
        label: profile.label,
      });
      const nextProfiles = listGuestViewProfiles();
      await saveGuestViewProfilesToSiteSettings(nextProfiles);
      setProfiles(nextProfiles);
      toast.success("הפרופיל רוענן מהגדרות התפקיד");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "רענון נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="gold-frame p-4 space-y-3">
        <h3 className="font-display text-lg font-semibold">
          {editingId ? "עריכת פרופיל אורח" : "יצירת פרופיל אורח"}
        </h3>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>תפקיד מקור</Label>
            <Select
              value={selectedRoleId}
              onValueChange={(v) => {
                setSelectedRoleId(v);
                const role = roles.find((r) => r.id === v);
                if (!editingId && role) setProfileLabel(`תצוגת אורח: ${roleLabel(role.name)}`);
              }}
            >
              <SelectTrigger><SelectValue placeholder="בחר תפקיד" /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{roleLabel(r.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>שם פרופיל להצגה במסך כניסה</Label>
            <Input
              value={profileLabel}
              onChange={(e) => setProfileLabel(e.target.value)}
              placeholder="למשל: אורח מנהל"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void submit()} disabled={busy || !selectedRole} className="bg-gradient-navy text-primary-foreground">
            <UserPlus className="h-4 w-4" />
            {editingId ? "עדכן פרופיל" : "צור פרופיל"}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={resetForm}>בטל עריכה</Button>
          )}
        </div>
      </Card>

      <Card className="gold-frame p-4 space-y-2">
        <h3 className="font-display text-lg font-semibold">פרופילי אורח קיימים</h3>
        {profiles.map((p) => (
          <div key={p.id} className="rounded-xl border-2 border-gold/30 p-3 bg-card flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{p.label}</span>
                {activeProfileId === p.id && (
                  <Badge className="bg-emerald-600 hover:bg-emerald-600">ברירת מחדל</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                תפקיד: {p.roleName ? roleLabel(p.roleName) : "לא הוגדר"} · עודכן {new Date(p.updatedAt).toLocaleString("he-IL")}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => void markAsDefault(p.id)} disabled={busy || activeProfileId === p.id}>
                <CheckCircle2 className="h-4 w-4" /> ברירת מחדל
              </Button>
              <Button size="sm" variant="outline" onClick={() => void refreshFromRole(p)} disabled={busy}>
                <RefreshCw className="h-4 w-4" /> רענן
              </Button>
              <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                ערוך
              </Button>
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => void remove(p)} disabled={busy}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {profiles.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-6">אין פרופילי אורח עדיין</div>
        )}
      </Card>
    </div>
  );
}
