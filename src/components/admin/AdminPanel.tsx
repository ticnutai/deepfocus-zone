import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Shield, Users, Layers, ListChecks, UserCheck, UserCog, Activity, LayoutDashboard } from "lucide-react";
import { UsersTab } from "./UsersTab";
import { RolesTab } from "./RolesTab";
import { PermissionsMatrix } from "./PermissionsMatrix";
import { ApprovalTab } from "./ApprovalTab";
import { UserPermOverrides } from "./UserPermOverrides";
import { SyncMonitorTab } from "./SyncMonitorTab";
import { RoleDefaultsTab } from "./RoleDefaultsTab";
import { usePermissions } from "@/hooks/usePermissions";

export function AdminPanel() {
  const { isAdmin, loading } = usePermissions();
  useEffect(() => { document.title = "ניהול | מעקב למידה"; }, []);

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
            </TabsTrigger>
            <TabsTrigger value="roles" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>תפקידים</span><Layers className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="matrix" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>מטריצת תפקיד</span><ListChecks className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="overrides" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>הרשאות אישיות</span><UserCog className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="sync-monitor" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>ניטור סנכרון</span><Activity className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="defaults" className="flex-1 gap-1.5 rounded-xl px-2 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground text-sm">
              <span>ברירות מחדל ופריסה</span><LayoutDashboard className="h-4 w-4" />
            </TabsTrigger>
          </TabsList>
        </Card>

        <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
        <TabsContent value="approval" className="mt-4"><ApprovalTab /></TabsContent>
        <TabsContent value="roles" className="mt-4"><RolesTab /></TabsContent>
        <TabsContent value="matrix" className="mt-4"><PermissionsMatrix /></TabsContent>
        <TabsContent value="overrides" className="mt-4"><UserPermOverrides /></TabsContent>
        <TabsContent value="sync-monitor" className="mt-4"><SyncMonitorTab /></TabsContent>
        <TabsContent value="defaults" className="mt-4"><RoleDefaultsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
