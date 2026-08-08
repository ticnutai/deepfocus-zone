import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Shield, Users, Layers, UserCheck, UserCog, Activity, LayoutDashboard, Monitor, UserX, Library, BarChart3 } from "lucide-react";
import { UsersTab } from "./UsersTab";
import { RolesTab } from "./RolesTab";
import { ApprovalTab } from "./ApprovalTab";
import { UserPermOverrides } from "./UserPermOverrides";
import { SyncMonitorTab } from "./SyncMonitorTab";
import { RoleDefaultsTab } from "./RoleDefaultsTab";
import { LayoutPreviewTab } from "./LayoutPreviewTab";
import { GuestProfilesTab } from "./GuestProfilesTab";
import { UserQuestionsTab } from "./UserQuestionsTab";
import { UserActivityTab } from "./UserActivityTab";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";

export function AdminPanel() {
  const { isAdmin, loading } = usePermissions();
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [pendingNotes, setPendingNotes] = useState(0);
  useEffect(() => { document.title = "ניהול | מעקב למידה"; }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const refresh = async () => {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      setPendingApprovals(count ?? 0);
    };
    void refresh();
    const channel = supabase
      .channel("admin-approval-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void refresh())
      .subscribe();
    const pollId = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const refresh = async () => {
      const { count } = await supabase.from("source_change_notes").select("id", { count: "exact", head: true }).eq("status", "open");
      setPendingNotes(count ?? 0);
    };
    void refresh();
    const channel = supabase.channel("admin-question-report-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "source_change_notes" }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [isAdmin]);

  if (loading) return <div className="p-8 text-center text-muted-foreground">טוען…</div>;
  if (!isAdmin) {
    return (
      <Card className="gold-frame p-8 text-center">
        <Shield className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h2 className="font-display text-xl font-semibold mb-1">אין הרשאת גישה</h2>
        <p className="text-sm text-muted-foreground">רק מנהל מערכת יכול לגשת לאזור זה.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-2xl font-bold text-foreground">מרכז ניהול</h2>
          <span className="gold-icon-circle"><Shield className="h-4 w-4" /></span>
        </div>
      </header>

      <Tabs defaultValue="users" className="w-full">
        <Card className="gold-frame p-2">
          <TabsList className="w-full bg-transparent justify-between gap-1 h-auto flex-wrap">
            <TabsTrigger value="users" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>משתמשים</span><Users className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="approval" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>אישורים</span><UserCheck className="h-4 w-4" />
              {pendingApprovals > 0 && (
                <span className="rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">
                  {pendingApprovals}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="roles" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>תפקידים</span><Layers className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="overrides" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>הרשאות אישיות</span><UserCog className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="sync-monitor" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>ניטור סנכרון</span><Activity className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="defaults" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>הרשאות ותצוגה</span><LayoutDashboard className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>תצוגה מקדימה</span><Monitor className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="guest-profiles" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>פרופילי אורח</span><UserX className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="user-questions" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>שאלות משתמשים</span><Library className="h-4 w-4" />
              {pendingNotes > 0 && <span className="rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">{pendingNotes}</span>}
            </TabsTrigger>
            <TabsTrigger value="usage" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>ניתוח שימוש</span><BarChart3 className="h-4 w-4" />
            </TabsTrigger>
          </TabsList>
        </Card>

        <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
        <TabsContent value="approval" className="mt-4"><ApprovalTab /></TabsContent>
        <TabsContent value="roles" className="mt-4"><RolesTab /></TabsContent>
        <TabsContent value="overrides" className="mt-4"><UserPermOverrides /></TabsContent>
        <TabsContent value="sync-monitor" className="mt-4"><SyncMonitorTab /></TabsContent>
        <TabsContent value="defaults" className="mt-4"><RoleDefaultsTab /></TabsContent>
        <TabsContent value="preview" className="mt-4"><LayoutPreviewTab /></TabsContent>
        <TabsContent value="guest-profiles" className="mt-4"><GuestProfilesTab /></TabsContent>
        <TabsContent value="user-questions" className="mt-4"><UserQuestionsTab /></TabsContent>
        <TabsContent value="usage" className="mt-4"><UserActivityTab /></TabsContent>
      </Tabs>
    </div>
  );
}
