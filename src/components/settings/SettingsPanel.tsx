import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Code2, Database, Repeat, Shield, Trash2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReminderSettings } from "@/components/study/ReminderSettings";
import { MigrationRunner } from "@/components/dev/MigrationRunner";
import { DevIconsSettings } from "./DevIconsSettings";
import { DataManagementSettings } from "./DataManagementSettings";
import { ReviewScheduleSettings } from "./ReviewScheduleSettings";
import { CacheSettings } from "./CacheSettings";
import { usePermissions } from "@/hooks/usePermissions";
import { useStudy } from "@/lib/study/store";

export function SettingsPanel() {
  const { isAdmin } = usePermissions();
  const showDevTools = isAdmin && !import.meta.env.PROD;
  const { state, setUiPref } = useStudy();
  const [keyInput, setKeyInput] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const savedKey = state.uiPrefs?.anthropicApiKey ?? "";

  useEffect(() => { document.title = "הגדרות | מעקב למידה"; }, []);

  function saveKey() {
    setUiPref("anthropicApiKey", keyInput.trim());
    setKeyInput("");
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2500);
  }

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
            <TabsTrigger value="api-keys" className="flex-1 gap-2 rounded-xl px-3 py-2 data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <span>מפתחות API</span><KeyRound className="h-4 w-4" />
            </TabsTrigger>
            {showDevTools && (
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
        <TabsContent value="api-keys" className="mt-4">
          <Card className="gold-frame p-4 space-y-4" dir="rtl">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-gold" />
              <h3 className="font-semibold text-foreground">Anthropic API Key</h3>
              {savedKey && (
                <span className="text-[10px] text-green-400 border border-green-400/30 rounded px-1.5 py-0.5 mr-auto">
                  ✓ מוגדר ופעיל
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              המפתח ישמש ליצירת שאלות אמריקאיות אוטומטית. נשמר בחשבון המשתמש שלך.
              &nbsp;השג ל-{" "}
              <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" className="underline text-gold">
                console.anthropic.com
              </a>
            </p>
            {savedKey && (
              <div className="rounded-lg border border-gold/30 px-3 py-2 flex items-center justify-between gap-2 bg-background/50">
                <code className="text-xs text-muted-foreground flex-1 overflow-hidden text-ellipsis">
                  {keyVisible ? savedKey : savedKey.slice(0, 8) + "•".repeat(20)}
                </code>
                <button
                  onClick={() => setKeyVisible((v) => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {keyVisible ? "הסתר" : "הצג"}
                </button>
                <button
                  onClick={() => { setUiPref("anthropicApiKey", ""); }}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  מחק
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={savedKey ? "מפתח חדש (לעדכון)" : "sk-ant-..."}
                className="flex-1 rounded-lg border border-gold/40 bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
                onKeyDown={(e) => e.key === "Enter" && keyInput.trim() && saveKey()}
              />
              <Button
                onClick={saveKey}
                disabled={!keyInput.trim()}
                className="bg-gradient-navy text-primary-foreground"
              >
                {keySaved ? "✓ נשמר" : "שמור"}
              </Button>
            </div>
          </Card>
        </TabsContent>
        {showDevTools && (
          <TabsContent value="dev" className="mt-4 space-y-4">
            <DevIconsSettings />
            <MigrationRunner />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}