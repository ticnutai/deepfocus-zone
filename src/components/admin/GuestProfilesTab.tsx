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
import { buildGuestStudySeed } from "@/lib/auth/guestStudySeed";
import { useStudy } from "@/lib/study/store";
import { resolveRoleLayoutProfile } from "@/lib/study/layoutProfiles";
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
  const { state: studyState } = useStudy();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profiles, setProfiles] = useState<GuestViewProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [profileLabel, setProfileLabel] = useState("");
  const [profileSourceUserId, setProfileSourceUserId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Guest cloud source — when enabled, guests read this user's data from the cloud
  // (read-only). When disabled, guests get an empty/clean app like before.
  const [sourceEnabled, setSourceEnabled] = useState(false);
  const [sourceUserId, setSourceUserId] = useState<string | null>(null);
  const [sourceUserLabel, setSourceUserLabel] = useState<string>("");
  const [adminCandidates, setAdminCandidates] = useState<Array<{ id: string; email: string | null; display_name: string | null }>>([]);
  const [sourceBusy, setSourceBusy] = useState(false);
  // Same source, separate toggle for authenticated registered users (overlay).
  const [overlayForUsersEnabled, setOverlayForUsersEnabled] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);

  const loadGuestSource = useCallback(async () => {
    const { data: srcRow } = await supabase
      .from("site_settings").select("value").eq("key", "guest_source").maybeSingle();
    const val = (srcRow?.value ?? {}) as { enabled?: boolean; user_id?: string | null };
    setSourceEnabled(!!val.enabled);
    setSourceUserId(val.user_id ?? null);

    const { data: overlayRow } = await supabase
      .from("site_settings").select("value").eq("key", "source_overlay_for_users").maybeSingle();
    const overlayVal = (overlayRow?.value ?? {}) as { enabled?: boolean };
    setOverlayForUsersEnabled(!!overlayVal.enabled);

    // List ALL user profiles as candidates for the source (not just admins).
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,email,display_name")
      .order("display_name", { ascending: true });
    const list = (profs ?? []) as Array<{ id: string; email: string | null; display_name: string | null }>;
    setAdminCandidates(list);
    const cur = list.find((p) => p.id === val.user_id);
    setSourceUserLabel(cur ? (cur.display_name || cur.email || cur.id) : "");
  }, []);

  const saveGuestSource = async (enabled: boolean, userId: string | null) => {
    setSourceBusy(true);
    try {
      const value = { enabled, user_id: userId };
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: "guest_source", value }, { onConflict: "key" });
      if (error) throw error;
      setSourceEnabled(enabled);
      setSourceUserId(userId);
      const cur = adminCandidates.find((p) => p.id === userId);
      setSourceUserLabel(cur ? (cur.display_name || cur.email || cur.id) : "");
      toast.success(enabled ? "האורח יקרא מהענן" : "האורח לא יקרא מהענן");
    } catch (e) {
      toast.error("שגיאה בשמירת הגדרת מקור האורח");
      console.error(e);
    } finally {
      setSourceBusy(false);
    }
  };

  const saveOverlayForUsers = async (enabled: boolean) => {
    setOverlayBusy(true);
    try {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: "source_overlay_for_users", value: { enabled } }, { onConflict: "key" });
      if (error) throw error;
      setOverlayForUsersEnabled(enabled);
      toast.success(enabled ? "משתמשים רשומים יקראו מהמקור" : "משתמשים רשומים יראו רק את המידע שלהם");
    } catch (e) {
      toast.error("שגיאה בשמירת הגדרת מקור למשתמשים");
      console.error(e);
    } finally {
      setOverlayBusy(false);
    }
  };



  const load = useCallback(async () => {
    const { data } = await supabase.from("app_roles").select("id,name").order("name");
    // Administrator is an authenticated identity, never a guest preset.
    const roleRows = ((data ?? []) as AppRole[]).filter((role) => role.name !== "admin");
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

    await loadGuestSource();
  }, [selectedRoleId, loadGuestSource]);

  useEffect(() => {
    void load();
  }, [load]);


  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );


  const buildProfileFromRole = useCallback(async (opts: { roleId: string; id?: string; label?: string; sourceUserId?: string | null }) => {
    const role = roles.find((r) => r.id === opts.roleId);
    if (!role) throw new Error("תפקיד לא נמצא");
    if (role.name === "admin") throw new Error("לא ניתן ליצור פרופיל אורח מתפקיד מנהל");

    const existing = opts.id
      ? listGuestViewProfiles().find((profile) => profile.id === opts.id)
      : null;

    const [{ data: perms, error: permsError }, resolvedLayout, studySeed] = await Promise.all([
      supabase
        .from("role_permissions")
        .select("module,action,allowed")
        .eq("role_id", role.id),
      resolveRoleLayoutProfile(role.id, { force: true, scope: "desktop" }),
      buildGuestStudySeed(studyState),
    ]);

    if (permsError) throw new Error(permsError.message);

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
      isAdmin: false,
      roles: [{ id: role.id, name: role.name }],
      matrix,
      sidebarConfig: resolvedLayout?.sidebarConfig,
      widgetLayout: resolvedLayout?.widgetLayout,
      studySeed: studySeed ?? existing?.studySeed,
      sourceUserId: opts.sourceUserId !== undefined ? opts.sourceUserId : (existing?.sourceUserId ?? null),
    });
  }, [roles, studyState]);

  const resetForm = () => {
    setEditingId(null);
    setProfileSourceUserId("");
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
        sourceUserId: profileSourceUserId || null,
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
    setProfileSourceUserId(profile.sourceUserId ?? "");
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
        <h3 className="font-display text-lg font-semibold">מקור נתונים לאורח (קריאה מהענן)</h3>
        <p className="text-xs text-muted-foreground">
          כאשר מופעל — האורח קורא את הקטגוריות והשאלות של המשתמש שנבחר (קריאה בלבד). בחירה במנהל כמקור מעבירה תוכן בלבד ולעולם אינה מעבירה את הרשאות המנהל.
        </p>
        <div className="grid md:grid-cols-3 gap-3 items-end">
          <div className="space-y-1 md:col-span-2">
            <Label>משתמש מקור</Label>
            <Select
              value={sourceUserId ?? ""}
              onValueChange={(v) => void saveGuestSource(sourceEnabled, v || null)}
              disabled={sourceBusy}
            >
              <SelectTrigger><SelectValue placeholder="בחר משתמש מקור" /></SelectTrigger>
              <SelectContent>
                {adminCandidates.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {(p.display_name || p.email || p.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void saveGuestSource(!sourceEnabled, sourceUserId)}
              disabled={sourceBusy || (!sourceEnabled && !sourceUserId)}
              className={sourceEnabled ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-muted text-foreground"}
            >
              {sourceEnabled ? "פעיל — לחץ לכיבוי" : "כבוי — לחץ להפעלה"}
            </Button>
          </div>
        </div>
        {sourceEnabled && sourceUserLabel && (
          <div className="text-xs text-emerald-700">
            ✓ אורחים יקראו כעת מהמשתמש: <strong>{sourceUserLabel}</strong>
          </div>
        )}
        <div className="mt-3 border-t pt-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">משתמשים רשומים קוראים מהמקור</div>
              <div className="text-xs text-muted-foreground">
                כל משתמש רשום יראה גם את השאלות/קטגוריות של משתמש המקור (קריאה בלבד) — בנוסף למה ששייך לו.
              </div>
            </div>
            <Button
              onClick={() => void saveOverlayForUsers(!overlayForUsersEnabled)}
              disabled={overlayBusy || !sourceUserId}
              className={overlayForUsersEnabled ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-muted text-foreground"}
            >
              {overlayForUsersEnabled ? "פעיל — לחץ לכיבוי" : "כבוי — לחץ להפעלה"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="gold-frame p-4 space-y-3">

        <h3 className="font-display text-lg font-semibold">
          {editingId ? "עריכת פרופיל אורח" : "יצירת פרופיל אורח"}
        </h3>
        <p className="text-xs text-muted-foreground">
          פרופיל אורח קובע תצוגה והרשאות לימוד מוגבלות. תפקיד מנהל אינו זמין כאן בכוונה.
        </p>
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
              placeholder="למשל: אורח לימוד"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>משתמש מקור לפרופיל זה (אופציונלי)</Label>
          <Select
            value={profileSourceUserId || "__default__"}
            onValueChange={(v) => setProfileSourceUserId(v === "__default__" ? "" : v)}
          >
            <SelectTrigger><SelectValue placeholder="ברירת מחדל גלובלית" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">— ברירת מחדל גלובלית —</SelectItem>
              {adminCandidates.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {(p.display_name || p.email || p.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            כשמוגדר — האורח שיפעיל את הפרופיל הזה יקרא קטגוריות/כרטיסים של המשתמש שנבחר. אם לא בוחרים — חוזרים למקור הגלובלי מהכרטיס למעלה.
          </p>
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
              <div className="text-xs text-muted-foreground">
                מקור נתונים: {(() => {
                  if (!p.sourceUserId) return "ברירת מחדל גלובלית";
                  const u = adminCandidates.find((x) => x.id === p.sourceUserId);
                  return u ? (u.display_name || u.email || u.id) : p.sourceUserId;
                })()}
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
