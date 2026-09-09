import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Shield, Users, Layers, UserCheck, UserCog, Activity, LayoutDashboard, Library, BarChart3, CircleHelp } from "lucide-react";
import { UsersTab } from "./UsersTab";
import { GuidesConfigTab } from "./GuidesConfigTab";
import { RolesTab } from "./RolesTab";
import { ApprovalTab } from "./ApprovalTab";
import { UserPermOverrides } from "./UserPermOverrides";
import { SyncMonitorTab } from "./SyncMonitorTab";
import { RoleDefaultsTab } from "./RoleDefaultsTab";
import { UserQuestionsTab } from "./UserQuestionsTab";
import { UserActivityTab } from "./UserActivityTab";
import { GuestContentSettings } from "./GuestProfilesTab";
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
    <div className="space-y-4 text-right" dir="rtl">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-2xl font-bold text-foreground">מרכז ניהול</h2>
          <span className="gold-icon-circle"><Shield className="h-4 w-4" /></span>
        </div>
      </header>

      <Tabs defaultValue="people" className="w-full" dir="rtl">
        <Card className="gold-frame p-2">
          <TabsList aria-label="תחומי מרכז הניהול" className="grid h-auto w-full grid-cols-2 gap-1 bg-transparent sm:grid-cols-3 xl:grid-cols-5">
            <TabsTrigger value="people" className="flex-row-reverse gap-2 rounded-xl px-3 py-3 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>משתמשים</span><Users className="h-4 w-4" />
              {pendingApprovals > 0 && <span className="rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">{pendingApprovals}</span>}
            </TabsTrigger>
            <TabsTrigger value="access" className="flex-row-reverse gap-2 rounded-xl px-3 py-3 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>גישה ותפקידים</span><Layers className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="operations" className="flex-row-reverse gap-2 rounded-xl px-3 py-3 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>תפעול</span><Activity className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="content" className="flex-row-reverse gap-2 rounded-xl px-3 py-3 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>תוכן והדרכה</span><Library className="h-4 w-4" />
              {pendingNotes > 0 && <span className="rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">{pendingNotes}</span>}
            </TabsTrigger>
            <TabsTrigger value="reports" className="flex-row-reverse gap-2 rounded-xl px-3 py-3 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>דוחות</span><BarChart3 className="h-4 w-4" />
            </TabsTrigger>
          </TabsList>
        </Card>

        <TabsContent value="people" className="mt-4">
          <Tabs defaultValue="users" dir="rtl" className="space-y-4">
            <Card className="gold-frame p-2">
              <TabsList aria-label="ניהול משתמשים" className="grid h-auto w-full grid-cols-1 gap-1 bg-transparent sm:grid-cols-3">
                <TabsTrigger value="users" className="gap-2 py-2.5"><Users className="h-4 w-4" /> רשימת משתמשים</TabsTrigger>
                <TabsTrigger value="approval" className="gap-2 py-2.5"><UserCheck className="h-4 w-4" /> אישורים {pendingApprovals > 0 && `(${pendingApprovals})`}</TabsTrigger>
                <TabsTrigger value="overrides" className="gap-2 py-2.5"><UserCog className="h-4 w-4" /> חריגות הרשאה</TabsTrigger>
              </TabsList>
            </Card>
            <TabsContent value="users"><UsersTab /></TabsContent>
            <TabsContent value="approval"><ApprovalTab /></TabsContent>
            <TabsContent value="overrides"><UserPermOverrides /></TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="access" forceMount className="mt-4 data-[state=inactive]:hidden">
          <Tabs defaultValue="profiles" dir="rtl" className="space-y-4">
            <Card className="gold-frame p-2">
              <TabsList aria-label="גישה ותפקידים" className="grid h-auto w-full grid-cols-1 gap-1 bg-transparent sm:grid-cols-2">
                <TabsTrigger value="profiles" className="gap-2 py-2.5"><LayoutDashboard className="h-4 w-4" /> פרופילי גישה</TabsTrigger>
                <TabsTrigger value="roles" className="gap-2 py-2.5"><Layers className="h-4 w-4" /> תפקידים ושיוכים</TabsTrigger>
              </TabsList>
            </Card>
            <TabsContent value="profiles" forceMount className="data-[state=inactive]:hidden"><RoleDefaultsTab /></TabsContent>
            <TabsContent value="roles"><RolesTab /></TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="operations" className="mt-4"><SyncMonitorTab /></TabsContent>

        <TabsContent value="content" className="mt-4">
          <Tabs defaultValue="user-questions" dir="rtl" className="space-y-4">
            <Card className="gold-frame p-2">
              <TabsList aria-label="תוכן והדרכה" className="grid h-auto w-full grid-cols-1 gap-1 bg-transparent sm:grid-cols-3">
                <TabsTrigger value="user-questions" className="gap-2 py-2.5"><Library className="h-4 w-4" /> שאלות משתמשים {pendingNotes > 0 && `(${pendingNotes})`}</TabsTrigger>
                <TabsTrigger value="shared-library" className="gap-2 py-2.5"><Layers className="h-4 w-4" /> ספרייה משותפת</TabsTrigger>
                <TabsTrigger value="guides" className="gap-2 py-2.5"><CircleHelp className="h-4 w-4" /> מדריכי כניסה</TabsTrigger>
              </TabsList>
            </Card>
            <TabsContent value="user-questions"><UserQuestionsTab /></TabsContent>
            <TabsContent value="shared-library"><GuestContentSettings /></TabsContent>
            <TabsContent value="guides"><GuidesConfigTab /></TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="reports" className="mt-4"><UserActivityTab /></TabsContent>
      </Tabs>
    </div>
  );
}
