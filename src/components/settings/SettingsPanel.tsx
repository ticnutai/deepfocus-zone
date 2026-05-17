import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Code2, Database, Repeat, Shield, Trash2 } from "lucide-react";
import { ReminderSettings } from "@/components/study/ReminderSettings";
import { MigrationRunner } from "@/components/dev/MigrationRunner";
import { DataManagementSettings } from "./DataManagementSettings";
import { ReviewScheduleSettings } from "./ReviewScheduleSettings";
import { CacheSettings } from "./CacheSettings";
import { usePermissions } from "@/hooks/usePermissions";

export function SettingsPanel() {
  const { isAdmin } = usePermissions();
  useEffect(() => { document.title = "הגדרות | מעקב למידה"; }, []);

  return (
    <div className="space-y-4" dir="rtl">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-2xl font-bold text-foreground">הגדרות</h2>
          <span className="gold-icon-circle"><Shield className="h-4 w-4" /></span>
        </div>
      </header>

      <Tabs defaultValue="review-schedule" className="w-full">
        <Card className="gold-frame p-2">
          <TabsList className="w-full bg-transparent justify-between gap-2 h-auto flex-wrap">
            <TabsTrigger value="review-schedule" className="flex-1 gap-2 rounded-xl px-3 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>לוח חזרות</span><Repeat className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="reminders" className="flex-1 gap-2 rounded-xl px-3 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>תזכורות</span><Bell className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="data" className="flex-1 gap-2 rounded-xl px-3 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>ניהול נתונים</span><Trash2 className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="cache" className="flex-1 gap-2 rounded-xl px-3 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>מטמון וסנכרון</span><Database className="h-4 w-4" />
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="dev" className="flex-1 gap-2 rounded-xl px-3 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
                <span>מערכת פיתוח</span><Code2 className="h-4 w-4" />
              </TabsTrigger>
            )}
          </TabsList>
        </Card>

        <TabsContent value="review-schedule" className="mt-4">
          <ReviewScheduleSettings />
        </TabsContent>
        <TabsContent value="reminders" className="mt-4">
          <ReminderSettings />
        </TabsContent>
        <TabsContent value="data" className="mt-4">
          <DataManagementSettings />
        </TabsContent>
        <TabsContent value="cache" className="mt-4">
          <CacheSettings />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="dev" className="mt-4">
            <MigrationRunner />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}