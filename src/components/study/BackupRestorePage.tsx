/**
 * BackupRestorePage — full-page sophisticated backup & restore system
 * Available as a primary sidebar item.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  buildSnapshot, buildSnapshotAsync, exportJson, exportTxt, exportCsv, exportXlsx,
  parseJsonBackup, autoSaveSnapshot, loadAutoSaveMeta,
  listCloudBackups, loadCloudBackup, deleteCloudBackup, saveCloudBackup,
  buildSettingsSnapshot, exportSettingsJson, parseSettingsBackup,
  buildTopicSnapshot, parseCsvCards, parseXlsxCards,
  type BackupSnapshot, type AutoSaveMeta, type CloudBackupRecord, type CloudTransferProgress, type SettingsSnapshot, type ImportedCard,
} from "@/lib/study/backup";
import {
  loadAutoBackupConfig, saveAutoBackupConfig,
  persistFolderHandle, retrieveFolderHandle, removeFolderHandle,
  queryFolderPermission, requestFolderAccess,
  listAutoBackupFiles, writeAutoBackup, buildAutoSnapshot,
  INTERVAL_OPTIONS,
  type AutoBackupConfig,
} from "@/lib/study/autoBackup";
import { useStudy } from "@/lib/study/store";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { DeleteAuditEvent } from "@/lib/study/indexedStateCache";
import { useRestoreContext } from "@/lib/study/RestoreContext";
import { TopicBackupWizard } from "@/components/study/TopicBackupWizard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Download, Upload, Archive, HardDrive, Cloud, History,
  BookOpen, Target, FileJson, FileText, FileSpreadsheet,
  AlertTriangle, Clock, RefreshCw, Trash2, Layers,
  FolderOpen, Library, Sparkles, CheckCircle2,
  Info, Zap, Package, Settings,
  Eye,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { TabConfig, SidebarConfig, WidgetLayout, UiPrefs } from "@/lib/study/types";

// ─── Types & constants ──────────────────────────────────────────────────────

type Section =
  | "dashboard"
  | "autobackup"
  | "categories"
  | "plans"
  | "settings"
  | "full"
  | "restore"
  | "import"
  | "cloud"
  | "history";

const SECTIONS: { id: Section; label: string; icon: typeof HardDrive; desc: string }[] = [
  { id: "dashboard",  label: "לוח מחוונים",        icon: HardDrive,    desc: "סטטוס וגיבוי מהיר" },
  { id: "autobackup", label: "גיבוי אוטומטי",      icon: RefreshCw,    desc: "תדירות, נושאים ויעד גיבוי" },
  { id: "categories", label: "קטגוריות ומערכות",   icon: FolderOpen,   desc: "גיבוי קטגוריות, מערכות וכרטיסים" },
  { id: "plans",      label: "תוכניות ולמידה",      icon: Library,      desc: "גיבוי תוכניות, יעדים וסשנים" },
  { id: "settings",   label: "הגדרות וממשק",        icon: Settings,     desc: "גיבוי הגדרות ותצוגה" },
  { id: "full",       label: "גיבוי מלא",           icon: Package,      desc: "ייצוא כל תוכן האפליקציה" },
  { id: "restore",    label: "שחזור",               icon: Upload,       desc: "שחזור מקובץ גיבוי" },
  { id: "import",     label: "ייבוא כרטיסים",       icon: BookOpen,     desc: "ייבוא מ-CSV / Excel" },
  { id: "cloud",      label: "ענן",                  icon: Cloud,        desc: "גיבויים בענן" },
  { id: "history",    label: "היסטוריה",             icon: History,      desc: "גיבויים שמורים מקומית" },
];

// ─── Utils ────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function daysDiff(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

// ─── Stat chip ───────────────────────────────────────────────────────────

function StatChip({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Archive }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border-2 border-gold/30 bg-card px-3 py-3 min-w-[72px]">
      <Icon className="h-4 w-4 text-gold" />
      <span className="font-display text-xl font-bold text-foreground">{value}</span>
      <span className="text-[10px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Format button ────────────────────────────────────────────────────────

function FormatBtn({
  icon: Icon, label, sub, onClick, disabled,
}: {
  icon: typeof FileJson; label: string; sub: string; onClick: () => void | Promise<void>; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-end gap-1 rounded-xl border-2 border-gold/40 bg-card px-4 py-3 text-right hover:border-gold hover:bg-secondary transition-all disabled:opacity-40"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <Icon className="h-4 w-4 text-gold" />
      </div>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </button>
  );
}

// ─── Section nav item ────────────────────────────────────────────────────

function NavItem({
  section, active, onClick,
}: {
  section: (typeof SECTIONS)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = section.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 text-right transition-all",
        active
          ? "bg-gradient-navy text-primary-foreground shadow-elegant"
          : "text-foreground hover:bg-secondary",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-sm font-medium">{section.label}</span>
    </button>
  );
}

// ─── Section: Dashboard ──────────────────────────────────────────────────

function DashboardSection({
  state, user, onQuickBackup, autoMeta, onSection, loading,
}: {
  state: ReturnType<typeof useStudy>["state"];
  user: { email?: string | null };
  onQuickBackup: () => void;
  autoMeta: AutoSaveMeta | null;
  onSection: (s: Section) => void;
  loading: boolean;
}) {
  const lastDays = autoMeta ? daysDiff(autoMeta.savedAt) : null;
  const health: "good" | "warn" | "stale" =
    lastDays === null ? "stale" : lastDays === 0 ? "good" : lastDays <= 3 ? "warn" : "stale";

  const healthConfig = {
    good:  { color: "text-emerald-500", bg: "border-emerald-400/40 bg-emerald-50/30 dark:bg-emerald-950/20", label: "עדכני", icon: CheckCircle2 },
    warn:  { color: "text-amber-500",  bg: "border-amber-400/40 bg-amber-50/30 dark:bg-amber-950/20",   label: "ישן מעט", icon: AlertTriangle },
    stale: { color: "text-rose-500",   bg: "border-rose-400/40 bg-rose-50/30 dark:bg-rose-950/20",     label: "לא גובה", icon: AlertTriangle },
  }[health];

  const HealthIcon = healthConfig.icon;

  return (
    <div className="space-y-6">
      {/* Health banner */}
      <div className={cn("flex items-center justify-between rounded-xl border-2 px-5 py-4", healthConfig.bg)}>
        <div className="flex items-center gap-2">
          <Button
            onClick={onQuickBackup}
            disabled={loading}
            className="bg-gradient-navy text-primary-foreground hover:opacity-90 rounded-xl shadow-elegant gap-2"
          >
            <Download className="h-4 w-4" />
            גיבוי מהיר
          </Button>
        </div>
        <div className="flex items-center gap-3 text-right">
          <div>
            <div className={cn("flex items-center gap-1.5 justify-end text-sm font-semibold", healthConfig.color)}>
              <HealthIcon className="h-4 w-4" />
              {healthConfig.label}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {autoMeta
                ? `גיבוי אחרון: ${fmtDate(autoMeta.savedAt)}`
                : "אין גיבוי שמור מקומית"}
            </div>
          </div>
          <div className="text-2xl font-display font-bold text-gold">
            {lastDays === null ? "—" : lastDays === 0 ? "היום" : `לפני ${lastDays}י׳`}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-3 text-right">סטטיסטיקות תוכן</h3>
        <div className="flex flex-wrap gap-2 justify-end">
          <StatChip label="כרטיסים"   value={state.cards?.length ?? 0}            icon={BookOpen} />
          <StatChip label="מערכות"    value={state.decks?.length ?? 0}            icon={Layers} />
          <StatChip label="קטגוריות"  value={state.categories?.length ?? 0}       icon={FolderOpen} />
          <StatChip label="יעדים"     value={state.goals?.length ?? 0}            icon={Target} />
          <StatChip label="תוכניות"   value={state.generalPlans?.length ?? 0}     icon={Library} />
          <StatChip label="סשנים"     value={state.learningSessions?.length ?? 0} icon={Zap} />
        </div>
      </div>

      {/* Quick actions grid */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-3 text-right">גיבוי לפי נושא</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "categories" as Section, label: "קטגוריות ומערכות",  icon: FolderOpen,  color: "border-blue-400/40"   },
            { id: "plans"      as Section, label: "תוכניות ולמידה",    icon: Library,     color: "border-purple-400/40" },
            { id: "settings"   as Section, label: "הגדרות וממשק",      icon: Settings,    color: "border-amber-400/40"  },
            { id: "restore"    as Section, label: "שחזור מגיבוי",       icon: Upload,      color: "border-emerald-400/40"},
          ].map(({ id, label, icon: Ico, color }) => (
            <button
              key={id}
              onClick={() => onSection(id)}
              className={cn(
                "flex items-center gap-3 rounded-xl border-2 bg-card px-4 py-3 text-right hover:border-gold hover:bg-secondary transition-all",
                color,
              )}
            >
              <span className="flex-1 text-sm font-medium text-foreground">{label}</span>
              <Ico className="h-4 w-4 text-gold shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {autoMeta && (
        <div className="flex items-center justify-between rounded-lg border border-gold/20 bg-card/60 px-4 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>{autoMeta.sizeKb} KB</span>
            <span>·</span>
            <span>{autoMeta.cardCount} כרטיסים</span>
            <span>·</span>
            <span>{autoMeta.deckCount} מערכות</span>
          </div>
          <span>גיבוי אוטומטי אחרון</span>
        </div>
      )}
    </div>
  );
}

// ─── Section: Categories & Decks ─────────────────────────────────────────

function CategoriesSection({
  state, onTopicWizard,
}: {
  state: ReturnType<typeof useStudy>["state"];
  onTopicWizard: () => void;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const [linkCount, setLinkCount] = useState<number | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Count cloud associations on mount
  useEffect(() => {
    (async () => {
      try {
        const { count } = await supabase
          .from("card_categories")
          .select("*", { count: "exact", head: true });
        setLinkCount(count ?? 0);
      } catch { /* ignore */ }
    })();
  }, []);

  const snap = buildTopicSnapshot(state, {
    includeSrs: true,
    includeGoals: false,
    includePlans: false,
    includeSessions: false,
    includeDayNotes: false,
    includeShasPlan: false,
  });

  const handleBackupAll = useCallback(async () => {
    if (busy) return;
    setBusy("backup");
    try {
      const { fetchCloudCardCategories } = await import("@/lib/study/backup");
      toast({ title: "אוסף קטגוריות, כרטיסיות ושיוכים..." });
      const links = await fetchCloudCardCategories();
      const fullSnap: BackupSnapshot = {
        ...snap,
        version: 2,
        data: { ...snap.data, cardCategories: links },
      };
      exportJson(fullSnap);
      toast({
        title: "✓ הגיבוי הושלם",
        description: `${fullSnap.data.categories?.length ?? 0} קטגוריות · ${fullSnap.data.cards?.length ?? 0} כרטיסיות · ${links.length} שיוכים`,
      });
    } catch (err) {
      toast({ title: "שגיאה בגיבוי", description: String((err as Error).message), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }, [busy, snap]);

  const handleRestoreFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user?.id) return;
    if (busy) return;

    setBusy("restore");
    try {
      const text = await file.text();
      const parsed = parseJsonBackup(text);
      const links = parsed.data.cardCategories ?? [];
      const cards = parsed.data.cards ?? [];
      const cats  = parsed.data.categories ?? [];

      // Ask before restoring
      const ok = window.confirm(
        `הקובץ מכיל:\n` +
        `• ${cats.length} קטגוריות\n` +
        `• ${cards.length} כרטיסיות\n` +
        `• ${links.length} שיוכים\n\n` +
        `לשחזר? (השיוכים יתווספו לקיימים, לא יימחקו)`
      );
      if (!ok) { setBusy(null); return; }

      if (links.length > 0) {
        const { restoreCloudCardCategories } = await import("@/lib/study/backup");
        const { inserted } = await restoreCloudCardCategories(links, user.id);
        toast({ title: "✓ שיוכים שוחזרו", description: `${inserted} שיוכים נוספו לענן` });
      } else {
        toast({ title: "אין שיוכים בקובץ", description: "הקובץ הוא גרסת v1 ללא שיוכי כרטיס↔קטגוריה" });
      }
    } catch (err) {
      toast({ title: "שגיאה בשחזור", description: String((err as Error).message), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }, [busy, user?.id]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onTopicWizard} className="border-gold/60 gap-2">
          <Sparkles className="h-4 w-4" />
          גיבוי לפי נושאים
        </Button>
        <div className="text-right">
          <h2 className="font-display text-lg font-semibold text-foreground">קטגוריות ומערכות</h2>
          <p className="text-xs text-muted-foreground">
            {state.categories?.length ?? 0} קטגוריות · {state.decks?.length ?? 0} מערכות · {state.cards?.length ?? 0} כרטיסים
            {linkCount !== null && <> · <span className="text-gold">{linkCount.toLocaleString("he-IL")} שיוכים בענן</span></>}
          </p>
        </div>
      </div>

      {/* ★ NEW: Full backup with associations */}
      <div className="rounded-xl border-2 border-gold/60 bg-gradient-to-br from-gold/10 to-transparent p-4 space-y-3">
        <div className="flex items-start gap-2 text-right">
          <Sparkles className="h-5 w-5 text-gold shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-display font-semibold text-foreground">גיבוי מלא: קטגוריות + כרטיסיות + שיוכים</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              מגבה את שלושת הרכיבים יחד כולל הקשר ביניהם — כך שניתן לשחזר בדיוק את אותו מבנה
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={handleBackupAll}
            disabled={busy !== null}
            className="bg-gold hover:bg-gold/90 text-background gap-2"
          >
            <Download className="h-4 w-4" />
            {busy === "backup" ? "מגבה..." : "גבה הכל ל-JSON"}
          </Button>
          <Button
            variant="outline"
            onClick={() => restoreInputRef.current?.click()}
            disabled={busy !== null}
            className="border-gold/60 gap-2"
          >
            <Upload className="h-4 w-4" />
            {busy === "restore" ? "משחזר..." : "שחזר מקובץ (עם אישור)"}
          </Button>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleRestoreFile}
          />
        </div>
      </div>

      <div className="rounded-xl border-2 border-gold/20 bg-card/60 p-4 space-y-3">
        <p className="text-sm text-muted-foreground text-right">ייצוא כל הקטגוריות, המערכות והכרטיסים (ללא תוכניות ויעדים)</p>
        <div className="grid grid-cols-2 gap-2">
          <FormatBtn icon={FileJson}        label="JSON"  sub="מלא + מטה-דאטה"   onClick={() => exportJson(snap)} />
          <FormatBtn icon={FileSpreadsheet} label="Excel" sub="גיליון לפי מערכות" onClick={() => exportXlsx(snap)} />
          <FormatBtn icon={FileSpreadsheet} label="CSV"   sub="כרטיסים בלבד"     onClick={() => exportCsv(snap)} />
          <FormatBtn icon={FileText}        label="TXT"   sub="קריא לאדם"         onClick={() => exportTxt(snap)} />
        </div>
      </div>

      <div className="rounded-xl border-2 border-blue-400/30 bg-blue-50/20 dark:bg-blue-950/20 p-4">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground text-right">
            הגיבוי החלקי כולל קטגוריות, מערכות, כרטיסים ונתוני חזרה (SRS). הגיבוי המלא למעלה כולל בנוסף את <strong>השיוכים בענן</strong> בין כרטיס לקטגוריה (טבלת <code>card_categories</code>).
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Section: Plans & Study ───────────────────────────────────────────────

function PlansSection({ state }: { state: ReturnType<typeof useStudy>["state"] }) {
  const snap = buildTopicSnapshot(state, {
    categoryIds: null,
    deckIds: null,
    includeSrs: false,
    includeGoals: true,
    includePlans: true,
    includeSessions: true,
    includeDayNotes: true,
    includeShasPlan: true,
  });

  return (
    <div className="space-y-5">
      <div className="text-right">
        <h2 className="font-display text-lg font-semibold text-foreground">תוכניות ולמידה</h2>
        <p className="text-xs text-muted-foreground">
          {state.generalPlans?.length ?? 0} תוכניות · {state.goals?.length ?? 0} יעדים · {state.learningSessions?.length ?? 0} סשנים
        </p>
      </div>

      <div className="rounded-xl border-2 border-gold/20 bg-card/60 p-4 space-y-3">
        <p className="text-sm text-muted-foreground text-right">ייצוא תוכניות לימוד, יעדים, סשנים והערות יומיות (ללא כרטיסים)</p>
        <div className="grid grid-cols-2 gap-2">
          <FormatBtn icon={FileJson}        label="JSON"  sub="מלא + מטה-דאטה"   onClick={() => exportJson(snap)} />
          <FormatBtn icon={FileSpreadsheet} label="Excel" sub="גיליונות מרובים"  onClick={() => exportXlsx(snap)} />
          <FormatBtn icon={FileSpreadsheet} label="CSV"   sub="תוכניות בלבד"    onClick={() => exportCsv(snap)} />
          <FormatBtn icon={FileText}        label="TXT"   sub="קריא לאדם"        onClick={() => exportTxt(snap)} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: "תוכניות לימוד", value: state.generalPlans?.length ?? 0, icon: Library },
          { label: "יעדים",         value: state.goals?.length ?? 0,         icon: Target },
          { label: "סשנים לימוד",   value: state.learningSessions?.length ?? 0, icon: Zap },
          { label: "הערות יומיות",  value: state.dayNotes?.length ?? 0,      icon: FileText },
          { label: "חזרות ש\"ס",    value: state.shasReviews?.length ?? 0,   icon: BookOpen },
          { label: "לוחות שחזור",   value: state.reviewIntervals?.length ?? 0, icon: RefreshCw },
        ].map(({ label, value, icon: Ico }) => (
          <div key={label} className="flex flex-col items-center gap-1 rounded-xl border border-gold/20 bg-card/50 py-3 px-2">
            <Ico className="h-4 w-4 text-gold/70" />
            <span className="font-display text-lg font-bold">{value}</span>
            <span className="text-[10px] text-muted-foreground leading-tight">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Section: Settings ────────────────────────────────────────────────────

function SettingsSection({
  state, user, onRestore,
}: {
  state: ReturnType<typeof useStudy>["state"];
  user: { email?: string | null };
  onRestore: (snap: SettingsSnapshot) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const snap = buildSettingsSnapshot(state, user.email ?? undefined);

  const handleFile = useCallback(async (f: File) => {
    setError(null);
    try {
      const text = await f.text();
      const parsed = parseSettingsBackup(text);
      onRestore(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בקריאת הקובץ");
    }
  }, [onRestore]);

  const tabCount   = state.tabConfig?.length ?? 0;
  const sideCount  = state.sidebarConfig?.length ?? 0;
  const hasWidgets = !!state.widgetLayout;

  return (
    <div className="space-y-5">
      <div className="text-right">
        <h2 className="font-display text-lg font-semibold text-foreground">הגדרות וממשק</h2>
        <p className="text-xs text-muted-foreground">גיבוי ושחזור הגדרות תצורה של הממשק</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "טאבים מוגדרים",  value: tabCount,   icon: Layers   },
          { label: "פריטי סיידבר",   value: sideCount,  icon: FolderOpen },
          { label: "עיצוב חלונות",   value: hasWidgets ? "כן" : "לא", icon: Settings },
        ].map(({ label, value, icon: Ico }) => (
          <div key={label} className="flex flex-col items-center gap-1 rounded-xl border border-gold/20 bg-card/50 py-3 px-2">
            <Ico className="h-4 w-4 text-gold/70" />
            <span className="font-display text-lg font-bold">{value}</span>
            <span className="text-[10px] text-muted-foreground leading-tight text-center">{label}</span>
          </div>
        ))}
      </div>

      <div className="rounded-xl border-2 border-gold/20 bg-card/60 p-4 space-y-3">
        <p className="text-sm text-muted-foreground text-right">
          הגיבוי כולל: סדר טאבים + נראות, סדר סיידבר + נראות, עיצוב חלונות ממשק, העדפות ממשק אישיות.
        </p>
        <Button onClick={() => exportSettingsJson(state, user.email ?? undefined)} className="w-full bg-gradient-navy text-primary-foreground hover:opacity-90 gap-2">
          <Download className="h-4 w-4" />
          ייצא הגדרות (JSON)
        </Button>
      </div>

      <div className="rounded-xl border-2 border-gold/30 bg-card/60 p-4 space-y-3">
        <p className="text-sm font-semibold text-right text-foreground">שחזור הגדרות</p>
        <p className="text-xs text-muted-foreground text-right">טעינת קובץ הגדרות שיוצא קודם תחליף את תצורת הממשק הנוכחית</p>
        {error && (
          <div className="flex items-center gap-2 text-xs text-rose-500">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <Button
          variant="outline"
          className="w-full border-gold/60 gap-2"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          טעינת קובץ הגדרות
        </Button>
      </div>
    </div>
  );
}

// ─── Section: Full Backup ─────────────────────────────────────────────────

function FullBackupSection({
  state, user, onSaveCloud,
}: {
  state: ReturnType<typeof useStudy>["state"];
  user: { email?: string | null };
  onSaveCloud: (snap: BackupSnapshot, name: string) => Promise<void>;
}) {
  const [cloudName, setCloudName] = useState("");
  const [saving, setSaving] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparePhase, setPreparePhase] = useState("");
  const [preparePercent, setPreparePercent] = useState(0);

  const totalItems =
    (state.cards?.length ?? 0) +
    (state.decks?.length ?? 0) +
    (state.categories?.length ?? 0) +
    (state.generalPlans?.length ?? 0) +
    (state.goals?.length ?? 0) +
    (state.learningSessions?.length ?? 0);

  const prepareSnapshot = useCallback(async () => {
    setIsPreparing(true);
    setPreparePercent(0);
    setPreparePhase("מתחיל גיבוי...");
    try {
      const snap = await buildSnapshotAsync(state, user.email ?? undefined, (p) => {
        setPreparePhase(p.phase);
        setPreparePercent(p.percent);
      });
      return snap;
    } finally {
      setIsPreparing(false);
      setTimeout(() => {
        setPreparePercent(0);
        setPreparePhase("");
      }, 400);
    }
  }, [state, user.email]);

  const handleExport = useCallback(async (format: "json" | "xlsx" | "csv" | "txt") => {
    try {
      const snap = await prepareSnapshot();
      if (format === "json") exportJson(snap);
      if (format === "xlsx") await exportXlsx(snap);
      if (format === "csv") exportCsv(snap);
      if (format === "txt") exportTxt(snap);
      toast({ title: "הגיבוי הוכן", description: "הקובץ הורד בהצלחה" });
    } catch {
      toast({ title: "שגיאה בגיבוי", description: "נסה שוב", variant: "destructive" });
    }
  }, [prepareSnapshot]);

  return (
    <div className="space-y-5">
      <div className="text-right">
        <h2 className="font-display text-lg font-semibold text-foreground">גיבוי מלא</h2>
        <p className="text-xs text-muted-foreground">ייצוא כל נתוני האפליקציה — {totalItems} פריטים</p>
      </div>

      <div className="rounded-xl border-2 border-gold/20 bg-card/60 p-4 space-y-3">
        <p className="text-sm font-semibold text-right text-foreground">ייצוא קובץ</p>
        {isPreparing && (
          <div className="space-y-2 rounded-lg border border-gold/30 bg-background/60 p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{preparePercent}%</span>
              <span>{preparePhase}</span>
            </div>
            <Progress value={preparePercent} className="h-2" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <FormatBtn icon={FileJson}        label="JSON"  sub="גיבוי מלא מומלץ" onClick={() => void handleExport("json")} disabled={isPreparing || saving} />
          <FormatBtn icon={FileSpreadsheet} label="Excel" sub="גיליונות מרובים" onClick={() => void handleExport("xlsx")} disabled={isPreparing || saving} />
          <FormatBtn icon={FileSpreadsheet} label="CSV"   sub="כרטיסים בלבד"   onClick={() => void handleExport("csv")} disabled={isPreparing || saving} />
          <FormatBtn icon={FileText}        label="TXT"   sub="קריא לאדם"       onClick={() => void handleExport("txt")} disabled={isPreparing || saving} />
        </div>
      </div>

      <div className="rounded-xl border-2 border-gold/30 bg-card/60 p-4 space-y-3">
        <p className="text-sm font-semibold text-right text-foreground">שמירה לענן</p>
        <input
          value={cloudName}
          onChange={(e) => setCloudName(e.target.value)}
          placeholder="שם הגיבוי (אופציונלי)"
          dir="rtl"
          className="w-full rounded-lg border border-gold/40 bg-background px-3 py-2 text-sm text-right placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold"
        />
        <Button
          onClick={async () => {
            setSaving(true);
            try {
              const snap = await prepareSnapshot();
              await onSaveCloud(snap, cloudName || `גיבוי מלא ${new Date().toLocaleDateString("he-IL")}`);
              setCloudName("");
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving || isPreparing}
          className="w-full bg-gradient-navy text-primary-foreground hover:opacity-90 gap-2"
        >
          <Cloud className="h-4 w-4" />
          {saving ? "שומר…" : "שמור לענן"}
        </Button>
      </div>
    </div>
  );
}

// ─── Section: Restore ────────────────────────────────────────────────────

function RestoreSection({
  onFileLoaded,
}: {
  onFileLoaded: (snap: BackupSnapshot) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (f: File) => {
    setError(null);
    try {
      const text = await f.text();
      const snap = parseJsonBackup(text);
      onFileLoaded(snap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בקריאת קובץ הגיבוי");
    }
  }, [onFileLoaded]);

  return (
    <div className="space-y-5">
      <div className="text-right">
        <h2 className="font-display text-lg font-semibold text-foreground">שחזור מגיבוי</h2>
        <p className="text-xs text-muted-foreground">בחר קובץ JSON של גיבוי לשחזור הנתונים</p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) processFile(f);
        }}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-all",
          dragOver
            ? "border-gold bg-secondary"
            : "border-gold/40 bg-card/60 hover:border-gold hover:bg-secondary",
        )}
      >
        <Upload className={cn("h-10 w-10 transition-colors", dragOver ? "text-gold" : "text-gold/50")} />
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">גרור קובץ גיבוי לכאן</p>
          <p className="text-xs text-muted-foreground mt-1">או לחץ לבחירת קובץ · תומך ב-JSON בלבד</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-400/40 bg-rose-50/30 dark:bg-rose-950/20 px-4 py-3 text-sm text-rose-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-xl border border-amber-400/30 bg-amber-50/20 dark:bg-amber-950/20 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground text-right">
            שחזור מגיבוי ימזג את הנתונים עם הנתונים הקיימים. תוצג תצוגה מקדימה לפני האישור עם אפשרות לבחור מה לשחזר.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Section: Import Cards ────────────────────────────────────────────────

function ImportSection({
  importRef,
  onFileChange,
}: {
  importRef: React.RefObject<HTMLInputElement>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="text-right">
        <h2 className="font-display text-lg font-semibold text-foreground">ייבוא כרטיסים</h2>
        <p className="text-xs text-muted-foreground">ייבוא כרטיסים מ-CSV או Excel אל המערכות</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border-2 border-gold/30 bg-card p-5 space-y-4">
          <div
            className="rounded-lg border-2 border-dashed border-border/60 hover:border-gold/60 transition-colors p-8 text-center cursor-pointer"
            onClick={() => importRef.current?.click()}
          >
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">לחץ לבחירת קובץ (.csv / .xlsx)</p>
            <p className="text-xs text-muted-foreground mt-1">תמיכה ב-CSV ו-Excel</p>
          </div>
          <input
            ref={importRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={onFileChange}
          />
        </div>
        <div className="rounded-xl border-2 border-gold/30 bg-card p-5 space-y-3 text-sm">
          <h3 className="font-semibold text-foreground text-right">מבנה קובץ CSV נדרש</h3>
          <p className="text-muted-foreground text-right">הקובץ צריך להכיל עמודות בשורה הראשונה:</p>
          <div className="font-mono text-xs bg-secondary rounded p-2 leading-6 space-y-0.5 text-right" dir="ltr">
            <div><span className="text-gold font-semibold">שאלה</span> (או question / front)</div>
            <div><span className="text-gold font-semibold">תשובה</span> (או answer / back)</div>
            <div className="text-muted-foreground">מערכת (אופציונלי)</div>
            <div className="text-muted-foreground">תגיות (אופציונלי, מופרד ב-;)</div>
          </div>
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3">
            <p className="text-xs text-blue-700 dark:text-blue-300 text-right">
              <span className="font-semibold">טיפ: </span>
              ייצא קובץ CSV מהאפשרות ייצוא לדוגמה ועקוב אחרי המבנה.
            </p>
          </div>
          <p className="text-xs text-muted-foreground text-right">
            בקבצי Excel, השתמש בגיליון <span className="font-mono">כרטיסיות</span> או בגיליון הראשון.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Section: Cloud ───────────────────────────────────────────────────────

function CloudSection({
  records, onLoad, onDelete, loading, restoreLoadingId, restoreProgress,
}: {
  records: CloudBackupRecord[] | null;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  loading: boolean;
  restoreLoadingId: string | null;
  restoreProgress: CloudTransferProgress | null;
}) {
  const ms = useMultiSelect(records ?? [], (r) => r.id);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(ms.selected);
    for (const id of ids) onDelete(id);
    ms.clear();
    setConfirmBulkDelete(false);
  }, [ms, onDelete]);

  const handleBulkRestore = useCallback(() => {
    const ids = Array.from(ms.selected);
    if (ids.length === 0) return;
    if (!window.confirm(`לשחזר ${ids.length} גיבויים? (יישחזרו אחד אחרי השני)`)) return;
    // sequential restore — onLoad is async via parent
    for (const id of ids) onLoad(id);
    ms.clear();
  }, [ms, onLoad]);

  const handleBulkDownload = useCallback(async () => {
    const items = ms.selectedItems;
    if (items.length === 0) return;
    toast({ title: `מוריד ${items.length} גיבויים...` });
    for (const r of items) {
      try {
        const snap = await loadCloudBackup(r.id);
        if (snap) {
          const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${r.name}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        console.error("Download failed", err);
      }
    }
    ms.clear();
  }, [ms]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <RefreshCw className="h-4 w-4 animate-spin" />
        טוען גיבויים…
      </div>
    );
  }

  if (!records) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <Cloud className="h-8 w-8 opacity-30" />
        <p className="text-sm">לא ניתן לטעון גיבויים — יש להתחבר</p>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <Cloud className="h-8 w-8 opacity-30" />
        <p className="text-sm">אין גיבויים בענן</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-right">
        <h2 className="font-display text-lg font-semibold text-foreground">גיבויים בענן</h2>
        <p className="text-xs text-muted-foreground">{records.length} גיבויים שמורים</p>
      </div>

      <MultiSelectToolbar
        count={ms.count}
        total={ms.total}
        allSelected={ms.allSelected}
        onToggleAll={ms.toggleAll}
        onClear={ms.clear}
        alwaysVisible
        actions={[
          { icon: Upload, label: "שחזר נבחרים", onClick: handleBulkRestore },
          { icon: Download, label: "הורד נבחרים", onClick: handleBulkDownload },
          { icon: Trash2, label: "מחק נבחרים", onClick: () => setConfirmBulkDelete(true), variant: "destructive" },
        ]}
      />

      <ScrollArea className="max-h-[480px]">
        <div className="space-y-2 pr-1">
          {records.map((r) => (
            <div
              key={r.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border bg-card/60 px-4 py-3 transition-colors",
                ms.isSelected(r.id) ? "border-gold/70 bg-gold/5" : "border-gold/20",
              )}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ms.isSelected(r.id)}
                  onChange={() => ms.toggle(r.id)}
                  className="h-4 w-4 rounded border-gold/40 cursor-pointer accent-gold"
                  aria-label={`בחר ${r.name}`}
                />
                <Button size="sm" variant="ghost" onClick={() => onDelete(r.id)} className="h-8 w-8 p-0 text-rose-400 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => onLoad(r.id)} className="h-8 border-gold/60 text-xs gap-1">
                  <Upload className="h-3 w-3" />
                  {restoreLoadingId === r.id ? `טוען ${restoreProgress?.percent ?? 0}%` : "שחזר"}
                </Button>
              </div>
              <div
                className="text-right flex-1 cursor-pointer"
                onClick={() => ms.toggle(r.id)}
              >
                <p className="text-sm font-semibold text-foreground">{r.name}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(r.created_at)} · {fmtBytes(r.size_bytes)}</p>
                {restoreLoadingId === r.id && restoreProgress && (
                  <p className="text-[10px] text-muted-foreground mt-1">{restoreProgress.phase}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת {ms.count} גיבויים?</AlertDialogTitle>
            <AlertDialogDescription>
              פעולה זו תמחק את כל הגיבויים הנבחרים מהענן ולא ניתן לשחזרם.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive hover:bg-destructive/90">
              מחק {ms.count} גיבויים
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Section: History ────────────────────────────────────────────────────

const HISTORY_KEY = "pashash_backup_history";

interface HistoryEntry {
  id: string;
  savedAt: string;
  label: string;
  sizeKb: number;
  cardCount: number;
  deckCount: number;
  data: string; // JSON of snapshot
}

function saveToHistory(snap: BackupSnapshot, label: string): void {
  try {
    const json = JSON.stringify(snap);
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      savedAt: snap.exportedAt,
      label,
      sizeKb: Math.round(new Blob([json]).size / 1024),
      cardCount: snap.data.cards?.length ?? 0,
      deckCount: snap.data.decks?.length ?? 0,
      data: json,
    };
    const existing: HistoryEntry[] = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    // Keep latest 20 entries
    const updated = [entry, ...existing].slice(0, 20);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch { /* quota */ }
}

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function HistorySection({
  onRestoreSnap,
  deleteAuditEvents,
  deleteAuditPendingCount,
  deleteAuditLoading,
  onRefreshDeleteAudit,
}: {
  onRestoreSnap: (snap: BackupSnapshot) => void;
  deleteAuditEvents: DeleteAuditEvent[];
  deleteAuditPendingCount: number;
  deleteAuditLoading: boolean;
  onRefreshDeleteAudit: () => Promise<void>;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory());

  const handleDelete = (id: string) => {
    const updated = entries.filter((e) => e.id !== id);
    setEntries(updated);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  };

  const handleRestore = (entry: HistoryEntry) => {
    try {
      const snap = parseJsonBackup(entry.data);
      onRestoreSnap(snap);
    } catch {
      toast({ title: "שגיאה", description: "לא ניתן לשחזר מגיבוי זה", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="border-gold/40">
          {entries.length} גיבויים
        </Badge>
        <div className="text-right">
          <h2 className="font-display text-lg font-semibold text-foreground">היסטוריה מקומית</h2>
          <p className="text-xs text-muted-foreground">עד 20 גיבויים אחרונים</p>
        </div>
      </div>

      <div className="rounded-xl border border-gold/20 bg-card/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            onClick={() => {
              void onRefreshDeleteAudit();
            }}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", deleteAuditLoading && "animate-spin")} />
            רענן דוח מחיקות
          </Button>
          <div className="text-right">
            <h3 className="text-sm font-semibold text-foreground">דוח מחיקות</h3>
            <p className="text-xs text-muted-foreground">בוצע / נכשל / ריק + ממתין לסנכרון</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <Badge variant="outline" className="border-gold/40">ממתין: {deleteAuditPendingCount}</Badge>
          <Badge variant="outline" className="border-emerald-400/40 text-emerald-600">בוצע: {deleteAuditEvents.filter((e) => e.status === "success").length}</Badge>
          <Badge variant="outline" className="border-rose-400/40 text-rose-600">נכשל: {deleteAuditEvents.filter((e) => e.status === "failed").length}</Badge>
          <Badge variant="outline" className="border-blue-400/40 text-blue-600">ריק: {deleteAuditEvents.filter((e) => e.status === "noop").length}</Badge>
        </div>

        <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
          {deleteAuditEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground text-right py-2">עדיין אין אירועי מחיקה</p>
          ) : (
            deleteAuditEvents.slice(0, 20).map((e) => (
              <div key={e.id} className="rounded-md border border-gold/15 bg-background/40 px-2 py-1.5 text-right">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-muted-foreground">{fmtDate(new Date(e.at).toISOString())}</span>
                  <span className={cn(
                    "font-semibold",
                    e.status === "success" && "text-emerald-600",
                    e.status === "failed" && "text-rose-600",
                    e.status === "queued" && "text-amber-600",
                    e.status === "noop" && "text-blue-600",
                  )}>
                    {e.status === "success" ? "בוצע" : e.status === "failed" ? "נכשל" : e.status === "queued" ? "ממתין" : "ריק"}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">{e.table}{e.rowId ? ` · ${e.rowId}` : ""}</div>
                {e.message && <div className="text-[11px] text-muted-foreground truncate">{e.message}</div>}
              </div>
            ))
          )}
        </div>
      </div>

      <ScrollArea className="max-h-[480px]">
        <div className="space-y-2 pr-1">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground rounded-xl border border-gold/20 bg-card/40">
              <History className="h-8 w-8 opacity-30" />
              <p className="text-sm">אין גיבויים בהיסטוריה המקומית</p>
              <p className="text-xs">כל גיבוי שמורד ישמר כאן אוטומטית</p>
            </div>
          ) : entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-gold/20 bg-card/60 px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => handleDelete(entry.id)} className="h-8 w-8 p-0 text-rose-400 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleRestore(entry)} className="h-8 border-gold/60 text-xs gap-1">
                  <Upload className="h-3 w-3" />
                  שחזר
                </Button>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtDate(entry.savedAt)} · {entry.sizeKb} KB · {entry.cardCount} כרטיסים · {entry.deckCount} מערכות
                </p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Section: Auto Backup ─────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200",
        checked ? "bg-gold border-gold" : "bg-muted border-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 mt-[1px]",
          checked ? "translate-x-5 mr-0.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function AutoBackupSection({
  state, user,
}: {
  state: ReturnType<typeof useStudy>["state"];
  user: { id?: string; email?: string | null } | null;
}) {
  const [cfg, setCfgState] = useState<AutoBackupConfig>(() => loadAutoBackupConfig());
  const [folderHandle, setFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderPerm, setFolderPerm] = useState<PermissionState | null>(null);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  // Load saved folder handle on mount
  useEffect(() => {
    retrieveFolderHandle().then(async (h) => {
      if (h) {
        setFolderHandle(h);
        const p = await queryFolderPermission(h);
        setFolderPerm(p);
        if (p === "granted") {
          const files = await listAutoBackupFiles(h);
          setFileCount(files.length);
        }
      }
    });
  }, []);

  const saveCfg = (patch: Partial<AutoBackupConfig>) => {
    const next = { ...cfg, ...patch };
    setCfgState(next);
    saveAutoBackupConfig(next);
  };

  const handlePickFolder = async () => {
    try {
      const dir = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
      await persistFolderHandle(dir);
      setFolderHandle(dir);
      const p = await queryFolderPermission(dir);
      setFolderPerm(p);
      const files = await listAutoBackupFiles(dir);
      setFileCount(files.length);
      saveCfg({ folderName: dir.name });
      toast({ title: "תיקייה נבחרה", description: `${dir.name}` });
    } catch {
      /* user cancelled */
    }
  };

  const handleReconnect = async () => {
    if (!folderHandle) return;
    const ok = await requestFolderAccess(folderHandle);
    if (ok) {
      setFolderPerm("granted");
      const files = await listAutoBackupFiles(folderHandle);
      setFileCount(files.length);
      toast({ title: "הרשאה אושרה" });
    } else {
      toast({ title: "הרשאה נדחתה", variant: "destructive" });
    }
  };

  const handleClearFolder = async () => {
    await removeFolderHandle();
    setFolderHandle(null);
    setFolderPerm(null);
    setFileCount(null);
    saveCfg({ folderName: null });
    toast({ title: "תיקייה הוסרה" });
  };

  const handleRunNow = async () => {
    setRunning(true);
    try {
      const snap = buildAutoSnapshot(state, cfg.topics, user?.email ?? undefined);
      let cloudOk = false, localOk = false;

      if (cfg.cloudEnabled && user?.id) {
        try {
          await saveCloudBackup(supabase, user.id, `אוטומטי ${new Date().toLocaleDateString("he-IL")}`, snap);
          cloudOk = true;
        } catch {
          toast({ title: "שגיאה", description: "גיבוי ענן נכשל", variant: "destructive" });
        }
      }

      if (cfg.localEnabled && folderHandle) {
        const p = folderPerm ?? await queryFolderPermission(folderHandle);
        if (p === "granted") {
          try {
            await writeAutoBackup(folderHandle, snap, cfg.maxLocalBackups);
            const files = await listAutoBackupFiles(folderHandle);
            setFileCount(files.length);
            localOk = true;
          } catch {
            toast({ title: "שגיאה", description: "גיבוי מקומי נכשל", variant: "destructive" });
          }
        } else {
          toast({ title: "הרשאה נדרשת", description: "לחץ 'חבר מחדש' כדי לאשר גישה לתיקייה", variant: "destructive" });
        }
      }

      if (!cfg.cloudEnabled && !cfg.localEnabled) {
        toast({ title: "לא הוגדר יעד גיבוי", description: "הפעל ענן או תיקייה מקומית", variant: "destructive" });
        return;
      }

      const now = new Date().toISOString();
      saveCfg({ lastRunAt: now });
      if (cloudOk || localOk) {
        toast({ title: "גיבוי הושלם", description: `${cloudOk ? "☁ ענן" : ""}${cloudOk && localOk ? " + " : ""}${localOk ? "💾 מקומי" : ""}` });
      }
    } finally {
      setRunning(false);
    }
  };

  const nextBackupIn = (() => {
    if (!cfg.enabled || !cfg.lastRunAt) return null;
    const ms = cfg.intervalMinutes * 60 * 1000 - (Date.now() - new Date(cfg.lastRunAt).getTime());
    if (ms <= 0) return "עכשיו";
    const mins = Math.ceil(ms / 60000);
    if (mins < 60) return `${mins} דקות`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hrs}ש׳ ${rem}ד׳` : `${hrs} שעות`;
  })();

  const topics = cfg.topics;

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ToggleSwitch checked={cfg.enabled} onChange={(v) => saveCfg({ enabled: v })} />
          <Badge variant={cfg.enabled ? "default" : "secondary"} className={cfg.enabled ? "bg-gold/20 text-gold border-gold/30" : ""}>
            {cfg.enabled ? "פעיל" : "כבוי"}
          </Badge>
        </div>
        <div className="text-right">
          <h2 className="font-display text-lg font-semibold text-foreground">גיבוי אוטומטי</h2>
          <p className="text-xs text-muted-foreground">גיבוי מתזמן ברקע ללא פעולה ידנית</p>
        </div>
      </div>

      {/* Status bar */}
      {cfg.enabled && (
        <div className="rounded-xl border border-gold/30 bg-card/60 px-4 py-3 flex justify-between text-xs text-muted-foreground">
          <span>{nextBackupIn ? `גיבוי הבא: בעוד ${nextBackupIn}` : "לא רץ עדיין"}</span>
          <span>{cfg.lastRunAt ? `גיבוי אחרון: ${fmtDate(cfg.lastRunAt)}` : "טרם רץ"}</span>
        </div>
      )}

      {/* Interval */}
      <div className="rounded-xl border-2 border-gold/20 bg-card/60 p-4 space-y-3">
        <p className="text-sm font-semibold text-right text-foreground">תדירות גיבוי</p>
        <select
          value={cfg.intervalMinutes}
          onChange={(e) => saveCfg({ intervalMinutes: Number(e.target.value) })}
          className="w-full rounded-lg border border-gold/30 bg-background px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gold/40"
          dir="rtl"
        >
          {INTERVAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Topics */}
      <div className="rounded-xl border-2 border-gold/20 bg-card/60 p-4 space-y-3">
        <p className="text-sm font-semibold text-right text-foreground">נושאים לגיבוי</p>
        <p className="text-xs text-muted-foreground text-right">בחר אילו נושאים לכלול בגיבוי האוטומטי</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: "full" as const,       label: "גיבוי מלא",         sub: "כל הנתונים",            icon: Package     },
            { key: "categories" as const, label: "קטגוריות ומערכות",  sub: "כרטיסים + SRS",          icon: FolderOpen  },
            { key: "plans" as const,      label: "תוכניות ולמידה",    sub: "יעדים, סשנים, ש\"ס",    icon: Library     },
            { key: "settings" as const,   label: "הגדרות וממשק",      sub: "טאבים, סיידבר, ווידג׳",  icon: Settings    },
          ].map(({ key, label, sub, icon: Ico }) => {
            const active = topics[key];
            const disabled = key !== "full" && topics.full;
            return (
              <button
                key={key}
                disabled={disabled}
                onClick={() => {
                  if (key === "full") {
                    saveCfg({ topics: { ...topics, full: !topics.full } });
                  } else {
                    saveCfg({ topics: { ...topics, [key]: !active } });
                  }
                }}
                className={cn(
                  "flex flex-col items-end gap-1 rounded-xl border-2 px-4 py-3 text-right transition-all",
                  active && !disabled
                    ? "border-gold bg-gold/10 text-foreground"
                    : "border-gold/30 bg-card hover:border-gold/60",
                  disabled && "opacity-40 cursor-not-allowed",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{label}</span>
                  <Ico className="h-4 w-4 text-gold" />
                </div>
                <span className="text-xs text-muted-foreground">{sub}</span>
              </button>
            );
          })}
        </div>
        {topics.full && (
          <p className="text-xs text-amber-500 text-right flex items-center justify-end gap-1">
            <Info className="h-3.5 w-3.5" />
            גיבוי מלא כולל את כל הנושאים
          </p>
        )}
      </div>

      {/* Local folder */}
      <div className="rounded-xl border-2 border-gold/20 bg-card/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <ToggleSwitch checked={cfg.localEnabled} onChange={(v) => saveCfg({ localEnabled: v })} />
          <p className="text-sm font-semibold text-right text-foreground">גיבוי מקומי לתיקייה</p>
        </div>

        {cfg.localEnabled && (
          <>
            {folderHandle ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-gold/20 bg-background/50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    {folderPerm === "granted" ? (
                      <Badge variant="outline" className="border-emerald-400/40 text-emerald-500 text-[10px]">גישה אושרה</Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-400/40 text-amber-500 text-[10px]">נדרשת הרשאה</Badge>
                    )}
                    {fileCount !== null && <span className="text-xs text-muted-foreground">{fileCount} גיבויים</span>}
                  </div>
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    {folderHandle.name}
                    <FolderOpen className="h-4 w-4 text-gold" />
                  </p>
                </div>
                <div className="flex gap-2">
                  {folderPerm !== "granted" && (
                    <Button size="sm" variant="outline" onClick={handleReconnect} className="flex-1 border-amber-400/60 text-amber-600 gap-1 text-xs">
                      <RefreshCw className="h-3.5 w-3.5" />
                      חבר מחדש
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={handleClearFolder} className="text-rose-400 hover:text-rose-600 gap-1 text-xs">
                    <Trash2 className="h-3.5 w-3.5" />
                    הסר תיקייה
                  </Button>
                  <Button size="sm" variant="outline" onClick={handlePickFolder} className="flex-1 border-gold/60 gap-1 text-xs">
                    <FolderOpen className="h-3.5 w-3.5" />
                    שנה תיקייה
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={handlePickFolder} variant="outline" className="w-full border-gold/60 gap-2">
                <FolderOpen className="h-4 w-4" />
                בחר תיקייה לשמירת גיבויים
              </Button>
            )}

            {/* Max files stepper */}
            <div className="flex items-center justify-between rounded-lg border border-gold/20 bg-background/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => saveCfg({ maxLocalBackups: Math.max(5, cfg.maxLocalBackups - 10) })}
                  className="h-7 w-7 rounded-md border border-gold/30 flex items-center justify-center text-sm hover:bg-secondary"
                >-10</button>
                <span className="font-display text-lg font-bold text-gold w-10 text-center">{cfg.maxLocalBackups}</span>
                <button
                  onClick={() => saveCfg({ maxLocalBackups: Math.min(500, cfg.maxLocalBackups + 10) })}
                  className="h-7 w-7 rounded-md border border-gold/30 flex items-center justify-center text-sm hover:bg-secondary"
                >+10</button>
              </div>
              <p className="text-sm text-right text-foreground">מקסימום גיבויים מקומיים</p>
            </div>
            <p className="text-xs text-muted-foreground text-right flex items-start gap-1">
              <Info className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
              כשיגיע ל-{cfg.maxLocalBackups} גיבויים, הישן ביותר יימחק אוטומטית
            </p>
          </>
        )}
      </div>

      {/* Cloud */}
      <div className="rounded-xl border-2 border-gold/20 bg-card/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <ToggleSwitch checked={cfg.cloudEnabled} onChange={(v) => saveCfg({ cloudEnabled: v })} />
          <p className="text-sm font-semibold text-right text-foreground">גיבוי לענן</p>
        </div>
        {cfg.cloudEnabled && !user?.id && (
          <p className="text-xs text-amber-500 text-right flex items-center justify-end gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            יש להתחבר לחשבון כדי לגבות לענן
          </p>
        )}
        {cfg.cloudEnabled && user?.id && (
          <p className="text-xs text-muted-foreground text-right">גיבויים יישמרו בחשבונך ({user.email})</p>
        )}
      </div>

      {/* Run now */}
      <Button
        onClick={handleRunNow}
        disabled={running || (!cfg.cloudEnabled && !cfg.localEnabled)}
        className="w-full bg-gradient-navy text-primary-foreground hover:opacity-90 shadow-elegant gap-2"
      >
        <RefreshCw className={cn("h-4 w-4", running && "animate-spin")} />
        {running ? "מריץ גיבוי..." : "הפעל גיבוי עכשיו"}
      </Button>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────

export function BackupRestorePage() {
  const { state, setTabConfig, setSidebarConfig, setWidgetLayout, setUiPref, getDeleteAuditHistory, addDeck, addCard } = useStudy();
  const { user } = useAuth();
  const { openRestore: openRestoreCtx } = useRestoreContext();

  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [topicWizardOpen, setTopicWizardOpen] = useState(false);
  const [cloudRecords, setCloudRecords] = useState<CloudBackupRecord[] | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudRestoreLoadingId, setCloudRestoreLoadingId] = useState<string | null>(null);
  const [cloudRestoreProgress, setCloudRestoreProgress] = useState<CloudTransferProgress | null>(null);
  const [autoMeta, setAutoMeta] = useState<AutoSaveMeta | null>(null);
  const [deleteAuditEvents, setDeleteAuditEvents] = useState<DeleteAuditEvent[]>([]);
  const [deleteAuditPendingCount, setDeleteAuditPendingCount] = useState(0);
  const [deleteAuditLoading, setDeleteAuditLoading] = useState(false);

  // Card import state
  const importRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ImportedCard[] | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Load auto-save meta on mount
  useEffect(() => {
    if (user?.id) {
      setAutoMeta(loadAutoSaveMeta(user.id));
    }
  }, [user?.id]);

  // Load cloud backups when entering cloud section
  useEffect(() => {
    if (activeSection !== "cloud" || !user?.id) return;
    setCloudLoading(true);
    listCloudBackups(supabase, user.id)
      .then((recs) => setCloudRecords(recs))
      .catch(() => setCloudRecords([]))
      .finally(() => setCloudLoading(false));
  }, [activeSection, user?.id]);

  const refreshDeleteAudit = useCallback(async () => {
    setDeleteAuditLoading(true);
    try {
      const snapshot = await getDeleteAuditHistory(80);
      setDeleteAuditEvents(snapshot.events);
      setDeleteAuditPendingCount(snapshot.pendingCount);
    } finally {
      setDeleteAuditLoading(false);
    }
  }, [getDeleteAuditHistory]);

  useEffect(() => {
    if (activeSection !== "history") return;
    void refreshDeleteAudit();
  }, [activeSection, refreshDeleteAudit]);

  // Auto-save every 5 min
  useEffect(() => {
    if (!user?.id) return;
    const run = () => {
      autoSaveSnapshot(state, user.id, user.email ?? undefined);
      setAutoMeta(loadAutoSaveMeta(user.id));
    };
    run();
    const id = window.setInterval(run, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [state, user]);

  const openRestore = useCallback((snap: BackupSnapshot) => {
    openRestoreCtx(snap);
  }, [openRestoreCtx]);

  const handleQuickBackup = useCallback(() => {
    const snap = buildSnapshot(state, user?.email ?? undefined);
    saveToHistory(snap, `גיבוי מהיר ${new Date().toLocaleDateString("he-IL")}`);
    exportJson(snap);
    toast({ title: "גיבוי הורד", description: "קובץ הגיבוי נשמר בהצלחה" });
  }, [state, user]);

  // ─── Card import handlers ───────────────────────────────────────────────

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const cards = await parseXlsxCards(reader.result as ArrayBuffer);
          if (!cards.length) throw new Error("לא נמצאו כרטיסיות בקובץ");
          setImportPreview(cards);
          setImportDialogOpen(true);
        } catch (err: unknown) {
          toast({ title: "שגיאה בקריאת קובץ", description: err instanceof Error ? err.message : "שגיאה", variant: "destructive" });
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const cards = parseCsvCards(reader.result as string);
          if (!cards.length) throw new Error("לא נמצאו כרטיסיות בקובץ");
          setImportPreview(cards);
          setImportDialogOpen(true);
        } catch (err: unknown) {
          toast({ title: "שגיאה בקריאת קובץ", description: err instanceof Error ? err.message : "שגיאה", variant: "destructive" });
        }
      };
      reader.readAsText(file, "utf-8");
    }
    e.target.value = "";
  }, []);

  const confirmImportCards = useCallback(async () => {
    if (!importPreview) return;
    setIsImporting(true);
    setImportDialogOpen(false);
    try {
      let addedDecks = 0, addedCards = 0;
      const deckMap = new Map<string, string>();
      for (const d of state.decks) deckMap.set(d.name, d.id);
      for (const card of importPreview) {
        const deckName = card.deckName || "ייבוא";
        if (!deckMap.has(deckName)) {
          const d = addDeck(deckName);
          deckMap.set(deckName, d.id);
          addedDecks++;
        }
        addCard({
          deckId: deckMap.get(deckName)!,
          type: "flashcard",
          question: card.question,
          answer: card.answer,
          tags: card.tags,
        } as Parameters<typeof addCard>[0]);
        addedCards++;
      }
      toast({ title: "ייבוא הסתיים", description: `נוספו ${addedDecks} מערכות, ${addedCards} כרטיסיות` });
      setImportPreview(null);
    } catch (err: unknown) {
      toast({ title: "שגיאה בייבוא", description: err instanceof Error ? err.message : "שגיאה", variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  }, [importPreview, state.decks, addDeck, addCard]);

  const handleSaveCloud = useCallback(async (snap: BackupSnapshot, name: string) => {
    if (!user?.id) {
      toast({ title: "שגיאה", description: "יש להתחבר כדי לשמור לענן", variant: "destructive" });
      return;
    }
    await saveCloudBackup(supabase, user.id, name, snap);
    toast({ title: "נשמר בענן", description: `"${name}" נשמר בהצלחה` });
    // Refresh if cloud section is active
    if (activeSection === "cloud") {
      const recs = await listCloudBackups(supabase, user.id);
      setCloudRecords(recs);
    }
  }, [user, activeSection]);

  const handleLoadCloud = useCallback(async (id: string) => {
    try {
      setCloudRestoreLoadingId(id);
      setCloudRestoreProgress({ phase: "טוען גיבוי", processed: 0, total: 1, percent: 0 });
      const snap = await loadCloudBackup(supabase, id, (p) => setCloudRestoreProgress(p));
      openRestore(snap);
    } catch {
      toast({ title: "שגיאה", description: "לא ניתן לטעון גיבוי מהענן", variant: "destructive" });
    } finally {
      setCloudRestoreLoadingId(null);
      setTimeout(() => setCloudRestoreProgress(null), 600);
    }
  }, [openRestore]);

  const handleDeleteCloud = useCallback(async (id: string) => {
    try {
      await deleteCloudBackup(supabase, id);
      setCloudRecords((prev) => prev?.filter((r) => r.id !== id) ?? null);
      toast({ title: "נמחק", description: "הגיבוי נמחק מהענן" });
    } catch {
      toast({ title: "שגיאה", description: "לא ניתן למחוק את הגיבוי", variant: "destructive" });
    }
  }, []);

  const handleRestoreSettings = useCallback((snap: SettingsSnapshot) => {
    if (snap.settings.tabConfig) setTabConfig(snap.settings.tabConfig);
    if (snap.settings.sidebarConfig) setSidebarConfig(snap.settings.sidebarConfig);
    if (snap.settings.widgetLayout) setWidgetLayout(snap.settings.widgetLayout);
    if (snap.settings.uiPrefs) {
      const prefs = snap.settings.uiPrefs;
      (Object.keys(prefs) as (keyof typeof prefs)[]).forEach((k) => {
        setUiPref(k, prefs[k] as never);
      });
    }
    toast({ title: "הגדרות שוחזרו", description: `קובץ הגדרות מ-${fmtDate(snap.exportedAt)} הוחל בהצלחה` });
  }, [setTabConfig, setSidebarConfig, setWidgetLayout, setUiPref]);

  const renderSection = () => {
    switch (activeSection) {
      case "dashboard":
        return (
          <DashboardSection
            state={state}
            user={user ?? {}}
            onQuickBackup={handleQuickBackup}
            autoMeta={autoMeta}
            onSection={setActiveSection}
            loading={false}
          />
        );
      case "autobackup":
        return <AutoBackupSection state={state} user={user} />;
      case "categories":
        return (
          <CategoriesSection
            state={state}
            onTopicWizard={() => setTopicWizardOpen(true)}
          />
        );
      case "plans":
        return <PlansSection state={state} />;
      case "settings":
        return (
          <SettingsSection
            state={state}
            user={user ?? {}}
            onRestore={handleRestoreSettings}
          />
        );
      case "full":
        return (
          <FullBackupSection
            state={state}
            user={user ?? {}}
            onSaveCloud={handleSaveCloud}
          />
        );
      case "restore":
        return <RestoreSection onFileLoaded={openRestore} />;
      case "import":
        return <ImportSection importRef={importRef} onFileChange={handleImportFile} />;
      case "cloud":
        return (
          <CloudSection
            records={cloudRecords}
            onLoad={handleLoadCloud}
            onDelete={handleDeleteCloud}
            loading={cloudLoading}
            restoreLoadingId={cloudRestoreLoadingId}
            restoreProgress={cloudRestoreProgress}
          />
        );
      case "history":
        return (
          <HistorySection
            onRestoreSnap={openRestore}
            deleteAuditEvents={deleteAuditEvents}
            deleteAuditPendingCount={deleteAuditPendingCount}
            deleteAuditLoading={deleteAuditLoading}
            onRefreshDeleteAudit={refreshDeleteAudit}
          />
        );
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page title */}
      <div className="text-right space-y-1">
        <h1 className="font-display text-2xl font-bold text-gold">גיבוי ושחזור</h1>
        <p className="text-muted-foreground text-sm">מערכת גיבוי משוכללת עם חלוקה לנושאים, ענן והיסטוריה</p>
      </div>

      {/* Main layout: nav + content */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Section navigation */}
        <div className="lg:w-52 shrink-0">
          <Card className="gold-frame p-2">
            <nav className="space-y-0.5">
              {SECTIONS.map((s) => (
                <NavItem
                  key={s.id}
                  section={s}
                  active={activeSection === s.id}
                  onClick={() => setActiveSection(s.id)}
                />
              ))}
            </nav>
          </Card>
        </div>

        {/* Section content */}
        <div className="flex-1 min-w-0">
          <Card className="gold-frame p-5">
            {renderSection()}
          </Card>
        </div>
      </div>

      {/* Dialogs */}
      <TopicBackupWizard
        open={topicWizardOpen}
        onOpenChange={setTopicWizardOpen}
        onComplete={() => {}}
      />

      {/* ─── Import preview dialog ─── */}
      <AlertDialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <AlertDialogContent dir="rtl" className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-gold" />
              תצוגה מקדימה — ייבוא כרטיסיות
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="text-sm mb-3">נמצאו <strong>{importPreview?.length ?? 0}</strong> כרטיסיות. הצגת {Math.min(importPreview?.length ?? 0, 10)} הראשונות:</p>
                <ScrollArea className="h-52 border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right w-8">#</TableHead>
                        <TableHead className="text-right">שאלה</TableHead>
                        <TableHead className="text-right">תשובה</TableHead>
                        <TableHead className="text-right">מערכת</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(importPreview ?? []).slice(0, 10).map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                          <TableCell className="text-sm max-w-[180px] truncate">{c.question}</TableCell>
                          <TableCell className="text-sm max-w-[180px] truncate text-muted-foreground">{c.answer}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{c.deckName || "ייבוא"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                {(importPreview?.length ?? 0) > 10 && (
                  <p className="text-xs text-muted-foreground mt-2">... ועוד {(importPreview?.length ?? 0) - 10} כרטיסיות</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogAction
              onClick={confirmImportCards}
              disabled={isImporting}
              className="bg-gold hover:bg-gold/90 text-navy"
            >
              {isImporting ? "מייבא..." : `ייבא ${importPreview?.length ?? 0} כרטיסיות`}
            </AlertDialogAction>
            <AlertDialogCancel onClick={() => setImportPreview(null)}>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
