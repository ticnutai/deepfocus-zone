import { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from "react";
import {
  Home, Gauge, Sun, Calendar, CheckSquare, Target, BookOpen, Timer,
  Activity, ListChecks, Library, Folder, FileText, MessageCircle,
  Trophy, Archive, Settings, Menu, Play, Pause, RotateCcw, Plus, Shield,
  Sparkles, ChevronLeft, Check, X, LogOut, Quote, Sliders, GraduationCap,
  Pin, PinOff, SlidersHorizontal, GripVertical, FolderTree, Search, HardDrive,
  LineChart, DatabaseZap, CircleHelp,
} from "lucide-react";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAutoBackupRunner } from "@/hooks/useAutoBackupRunner";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePrompt } from "@/hooks/usePrompt";
import { toast } from "@/hooks/use-toast";
import { PreviewRoleApplier } from "@/components/admin/PreviewRoleApplier";
import { AutoInitShasTemplate } from "@/components/AutoInitShasTemplate";
import { WidgetGrid } from "@/components/study/WidgetGrid";
import { usePermissions } from "@/hooks/usePermissions";
import { useResolvedFeatureBlocklist } from "@/lib/study/featureBlocklist";
import { useStudy } from "@/lib/study/store";
import { isDue } from "@/lib/study/srs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { DesktopUpdateButton } from "@/components/DesktopUpdateButton";
import { DesktopAppDownloadButton } from "@/components/DesktopAppDownloadButton";
import { UserQuestionsExportButton } from "@/components/UserQuestionsExportButton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { resolveRoleLayoutProfile } from "@/lib/study/layoutProfiles";
import { isRoleAssignedToProfileB, setProfileBMode } from "@/lib/study/profileBMode";
import { DedicationBanner } from "@/components/DedicationBanner";
import { NavItem, DEFAULT_SIDEBAR_ITEMS } from "@/config/sidebarItems";
import { getLocalAccount } from "@/lib/auth/localAccount";
import { GuidesDialog } from "@/components/onboarding/GuidesDialog";
import { SortableConfigItem, type SortableConfigDef } from "@/components/study/SortableConfigItem";
import { hasSeenGuides, markGuidesSeen } from "@/lib/onboarding/guideTopics";
import { canAccessAppSection } from "@/lib/auth/sectionAccess";
import { normalizeSplitWorkspaceSidebarConfig } from "@/lib/study/sidebarItems";
import { getHomeLocation } from "@/lib/study/homeNavigation";

// Lazy-loaded components — downloaded only when first rendered
const SummaryDashboard = lazy(() => import("@/components/study/SummaryDashboard").then(m => ({ default: m.SummaryDashboard })));
const KnowledgeAnalytics = lazy(() => import("@/components/study/KnowledgeAnalytics").then(m => ({ default: m.KnowledgeAnalytics })));
const DafLearningTab = lazy(() => import("@/components/study/DafLearningTab").then(m => ({ default: m.DafLearningTab })));
const WeeklySummary = lazy(() => import("@/components/study/WeeklySummary").then(m => ({ default: m.WeeklySummary })));
const GoalsManager = lazy(() => import("@/components/study/GoalsManager").then(m => ({ default: m.GoalsManager })));
const ShasTracker = lazy(() => import("@/components/study/ShasTracker").then(m => ({ default: m.ShasTracker })));
const ShasBoard = lazy(() => import("@/components/study/ShasBoard").then(m => ({ default: m.ShasBoard })));
const BackupRestorePage = lazy(() => import("@/components/study/BackupRestorePage").then(m => ({ default: m.BackupRestorePage })));
const ReminderSettings = lazy(() => import("@/components/study/ReminderSettings").then(m => ({ default: m.ReminderSettings })));
const AdminPanel = lazy(() => import("@/components/admin/AdminPanel").then(m => ({ default: m.AdminPanel })));
const SupabaseInspectorPage = lazy(() => import("@/components/dev/SupabaseInspectorPage").then(m => ({ default: m.SupabaseInspectorPage })));
const PerformancePage = lazy(() => import("@/components/study/PerformancePage").then(m => ({ default: m.PerformancePage })));
const SettingsPanel = lazy(() => import("@/components/settings/SettingsPanel").then(m => ({ default: m.SettingsPanel })));
const AiCardCapture = lazy(() => import("@/components/study/AiCardCapture").then(m => ({ default: m.AiCardCapture })));
const SystemRubric = lazy(() => import("@/components/study/SystemRubric").then(m => ({ default: m.SystemRubric })));
const AIQuestionGenerator = lazy(() => import("@/components/ai/AIQuestionGenerator").then(m => ({ default: m.AIQuestionGenerator })));
const QuestionLabPage = lazy(() => import("@/components/study/QuestionLabPage").then(m => ({ default: m.QuestionLabPage })));
const StudyTab = lazy(() => import("@/components/study/StudyTab").then(m => ({ default: m.StudyTab })));
const CardsAndCategoriesPage = lazy(() => import("@/components/study/CardsAndCategoriesPage").then(m => ({ default: m.CardsAndCategoriesPage })));
const SmartSearch = lazy(() => import("@/components/study/SmartSearch").then(m => ({ default: m.SmartSearch })));
const StudyPlansCard = lazy(() => import("@/components/study/StudyPlansCard").then(m => ({ default: m.StudyPlansCard })));
const QuizPlansCard = lazy(() => import("@/components/study/QuizPlansCard").then(m => ({ default: m.QuizPlansCard })));
const TodayReviewsCard = lazy(() => import("@/components/study/TodayReviewsCard").then(m => ({ default: m.TodayReviewsCard })));
const InsightsCard = lazy(() => import("@/components/study/InsightsCard").then(m => ({ default: m.InsightsCard })));
const TaskCard = lazy(() => import("@/components/study/TaskCard").then(m => ({ default: m.TaskCard })));
const HeatmapPanel = lazy(() => import("@/components/study/HeatmapPanel").then(m => ({ default: m.HeatmapPanel })));
const ReviewCalendar = lazy(() => import("@/components/study/ReviewCalendar").then(m => ({ default: m.ReviewCalendar })));

const QUOTES = [
  { text: "הבחירה שלך, לא המזל שלך, קובעת את גורלך", author: "ג'ין ניד'" },
  { text: "פוקוס הוא היכולת לומר 'לא' לאלף דברים טובים", author: "סטיב ג'ובס" },
  { text: "משמעת היא הגשר בין מטרות להישגים", author: "ג'ים רוהן" },
  { text: "הצלחה היא סך כל מאמצים קטנים, מיום ליום", author: "רוברט קולייר" },
];

const Logo = ({ size = "md" }: { size?: "sm" | "md" }) => (
  <div className="flex items-center gap-2">
    <div className={cn("rounded-full bg-gradient-gold flex items-center justify-center shadow-gold",
      size === "md" ? "h-9 w-9" : "h-7 w-7")}>
      <Sparkles className={cn("text-navy", size === "md" ? "h-4 w-4" : "h-3.5 w-3.5")} />
    </div>
    <span className={cn("font-display font-bold text-foreground", size === "md" ? "text-xl" : "text-base")}>
      מעקב למידה
    </span>
  </div>
);

const SidebarContent = ({
  active,
  items,
  onSelect,
  badges = {},
}: {
  active: string;
  items: NavItem[];
  onSelect: (id: string) => void;
  badges?: Record<string, number>;
}) => (
  <nav className="flex flex-col gap-1 p-3">
    {items.map((item) => {
      const Icon = item.icon;
      const isActive = active === item.id;
      const badge = badges[item.id];
      return (
        <button
          key={item.id}
          data-sidebar-id={item.id}
          data-sidebar-label={item.label}
          onClick={() => onSelect(item.id)}
          className={cn(
            "flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
            isActive
              ? "bg-gradient-navy text-primary-foreground shadow-elegant"
              : "text-foreground hover:bg-secondary",
          )}
        >
          <div className="flex items-center gap-2">
            {badge != null && badge > 0 && (
              <span className={cn(
                "text-[11px] font-bold rounded-full px-1.5 py-0.5 min-w-[1.3rem] text-center leading-none",
                isActive ? "bg-gold text-navy" : "bg-gradient-navy text-primary-foreground",
              )}>
                {badge}
              </span>
            )}
            <span>{item.label}</span>
          </div>
          <span className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full border-2",
            isActive ? "border-gold bg-card/10 text-gold" : "border-gold/70 bg-card text-navy",
          )}>
            <Icon className="h-4 w-4" />
          </span>
        </button>
      );
    })}
  </nav>
);

const PomodoroCard = () => {
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [emboss, setEmboss] = useState(40); // 0-100
  const ref = useRef<number | null>(null);

  useEffect(() => {
    if (running) {
      ref.current = window.setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    }
    return () => { if (ref.current) window.clearInterval(ref.current); };
  }, [running]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const progress = 1 - seconds / (25 * 60);

  // Scale shadow intensity with emboss (0 = flat, 100 = strong cornice)
  const e = emboss / 100;
  const embossShadow = [
    `inset 0 ${1 + e * 2}px ${1 + e * 2}px hsl(0 0% 100% / ${0.6 + e * 0.4})`,
    `inset 0 -${1 + e * 2}px ${1 + e * 3}px hsl(var(--gold) / ${0.15 + e * 0.45})`,
    `inset 0 0 0 1px hsl(var(--gold) / ${0.1 + e * 0.3})`,
    `0 ${1 + e * 3}px ${2 + e * 6}px hsl(var(--navy) / ${0.05 + e * 0.15})`,
    `0 ${4 + e * 14}px ${12 + e * 24}px -${8 + e * 4}px hsl(var(--navy) / ${0.1 + e * 0.25})`,
  ].join(", ");

  return (
    <Card className="gold-frame p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-semibold">שעון פומודורו</h3>
        <Popover>
          <PopoverTrigger asChild>
            <button className="gold-icon-circle h-9 w-9" aria-label="עוצמת בליטה">
              <Sliders className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 gold-frame" align="start">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{emboss}%</span>
                <h4 className="text-sm font-semibold text-foreground">עוצמת בליטה</h4>
              </div>
              <Slider
                value={[emboss]}
                onValueChange={(v) => setEmboss(v[0])}
                min={0}
                max={100}
                step={1}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div
        className="relative mx-auto h-44 w-44 rounded-full bg-card"
        style={{ boxShadow: embossShadow }}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="44" fill="none" stroke="hsl(var(--gold) / 0.18)" strokeWidth="1.5" />
          <circle
            cx="50" cy="50" r="44" fill="none"
            stroke="hsl(var(--gold))" strokeWidth="2" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 44}`}
            strokeDashoffset={`${2 * Math.PI * 44 * (1 - progress)}`}
            className="transition-all duration-1000"
            style={{ filter: "drop-shadow(0 0 2px hsl(var(--gold) / 0.4))" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-display text-4xl font-bold text-foreground">{mm}:{ss}</div>
          <div className="text-xs text-muted-foreground mt-1">מחזור פוקוס</div>
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 mt-5">
        <Button
          onClick={() => setRunning((r) => !r)}
          className="bg-gradient-navy text-primary-foreground hover:opacity-90 rounded-full px-6 shadow-elegant"
        >
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {running ? "השהה" : "התחל"}
        </Button>
        <Button
          variant="outline"
          onClick={() => { setRunning(false); setSeconds(25 * 60); }}
          className="rounded-full border-2 border-gold text-navy hover:bg-secondary"
        >
          <RotateCcw className="h-4 w-4" />
          איפוס
        </Button>
      </div>
    </Card>
  );
};

type Habit = { id: string; label: string; icon: typeof Sun; done: boolean };

const DailyTrackers = () => {
  const [habits, setHabits] = useState<Habit[]>([
    { id: "1", label: "קימה", icon: Sun, done: false },
    { id: "2", label: "הרגלים", icon: Target, done: false },
    { id: "3", label: "יעדים", icon: ListChecks, done: false },
    { id: "4", label: "שינה", icon: Timer, done: false },
  ]);
  const completed = habits.filter((h) => h.done).length;
  const allDone = completed === habits.length;

  return (
    <Card className="gold-frame p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle"><Check className="h-4 w-4" /></span>
          <h3 className="font-display text-lg font-semibold">סטטוס מעקבים יומי</h3>
        </div>
        <span className="text-sm font-semibold text-muted-foreground">{completed}/{habits.length}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {habits.map((h) => {
          const Icon = h.icon;
          return (
            <div
              key={h.id}
              className={cn(
                "flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 transition-all",
                h.done ? "border-gold bg-secondary" : "border-gold/40 bg-card",
              )}
            >
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setHabits((arr) => arr.map((x) => x.id === h.id ? { ...x, done: false } : x))}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="בטל"
                >
                  <X className="h-4 w-4" />
                </button>
                <span className="gold-icon-circle h-7 w-7"><Icon className="h-3.5 w-3.5" /></span>
              </div>
              <button
                onClick={() => setHabits((arr) => arr.map((x) => x.id === h.id ? { ...x, done: !x.done } : x))}
                className="flex-1 text-right text-sm font-medium text-foreground"
              >
                {h.label}
              </button>
            </div>
          );
        })}
      </div>
      <Button
        onClick={() => setHabits((arr) => arr.map((x) => ({ ...x, done: true })))}
        disabled={allDone}
        className="w-full mt-4 bg-gradient-navy text-primary-foreground hover:opacity-90 rounded-xl py-6 shadow-elegant"
      >
        <Check className="h-4 w-4" />
        סמן הכל ({habits.length})
      </Button>
    </Card>
  );
};

const QuoteCard = () => {
  const [idx, setIdx] = useState(0);
  const q = QUOTES[idx];
  return (
    <Card className="gold-frame p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setIdx((i) => (i + 1) % QUOTES.length)}
            className="gold-icon-circle h-8 w-8" aria-label="הבא">
            <Play className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setIdx((i) => (i - 1 + QUOTES.length) % QUOTES.length)}
            className="gold-icon-circle h-8 w-8" aria-label="קודם">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold">ציטוט מעורר השראה</h3>
          <span className="gold-icon-circle"><Quote className="h-4 w-4" /></span>
        </div>
      </div>
      <div className="flex items-start gap-2 px-2">
        <button className="gold-icon-circle h-8 w-8 mt-2" aria-label="הבא">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center py-4">
          <p className="font-display text-xl font-semibold text-foreground leading-relaxed">"{q.text}"</p>
          <p className="text-sm text-muted-foreground mt-3">— {q.author}</p>
        </div>
      </div>
    </Card>
  );
};

const NextAlarmCard = () => (
  <Card className="gold-frame p-6 animate-fade-in">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <span className="gold-icon-circle"><Timer className="h-4 w-4" /></span>
        <h3 className="font-display text-lg font-semibold">שעון מעורר הבא</h3>
        <span className="text-xs text-muted-foreground">(1/4)</span>
      </div>
      <Button size="icon" className="rounded-full bg-gradient-navy text-primary-foreground h-10 w-10 shadow-elegant">
        <Plus className="h-4 w-4" />
      </Button>
    </div>
    <div className="text-center py-6 text-muted-foreground text-sm">לא הוגדר שעון מעורר</div>
  </Card>
);

const AICoachCard = () => (
  <Card className="gold-frame p-6 animate-fade-in">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <span className="gold-icon-circle"><Sparkles className="h-4 w-4" /></span>
        <h3 className="font-display text-lg font-semibold">מאמן יומי</h3>
      </div>
      <button className="gold-icon-circle h-8 w-8"><X className="h-4 w-4" /></button>
    </div>
    <div className="rounded-xl bg-gradient-navy p-5 text-primary-foreground">
      <p className="text-sm leading-relaxed">
        בוקר טוב ✨ היום זה היום לעשות צעד קטן בכיוון הנכון. בחר משימה אחת חשובה וצא לדרך.
      </p>
    </div>
  </Card>
);

const PlaceholderPanel = ({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  icon: typeof Activity;
}) => (
  <Card className="gold-frame p-6 animate-fade-in">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <span className="gold-icon-circle"><Icon className="h-4 w-4" /></span>
      </div>
    </div>
    <p className="text-sm text-muted-foreground text-right">{subtitle}</p>
  </Card>
);

const SidebarWorkspace = ({
  title,
  subtitle,
  tabId,
  widgetMap,
}: {
  title: string;
  subtitle: string;
  tabId: string;
  widgetMap: Record<string, React.ReactNode>;
}) => (
  <div className="space-y-6">
    <div className="text-right space-y-1 animate-fade-in">
      <h1 className="font-display text-2xl font-bold text-gold">{title}</h1>
      <p className="text-muted-foreground text-sm">{subtitle}</p>
    </div>
    <WidgetGrid tabId={tabId} widgetMap={widgetMap} />
  </div>
);

const getInitialHomeTab = (): string => {
  try {
    const saved = localStorage.getItem("active-tab") ?? "overview";
    // Keep first paint lightweight: never boot directly into the heavy backup tab.
    if (saved === "backup") return "overview";
    // Migrate the historic combined workspace to its first dedicated page.
    return saved === "cards" ? "categories" : saved;
  } catch {
    return "overview";
  }
};

const StaticLazyPanelPreview = ({ compact = false }: { compact?: boolean }) => (
  <Card className={cn("gold-frame w-full bg-card/95", compact ? "p-3" : "p-6")}>
    <div className={cn("rounded-xl border-2 border-gold/25 bg-secondary/25", compact ? "p-2" : "p-4")}>
      <div className="h-4 w-44 rounded-full bg-muted/70 mx-auto mb-3" />
      {!compact && (
        <>
          <div className="h-3 w-full rounded-full bg-muted/60 mb-2" />
          <div className="h-3 w-10/12 rounded-full bg-muted/60 mb-2" />
          <div className="h-3 w-8/12 rounded-full bg-muted/60" />
        </>
      )}
      {compact && <div className="h-3 w-8/12 rounded-full bg-muted/60 mx-auto" />}
    </div>
  </Card>
);

// ─── Tab config types & defaults ───────────────────────────────────────────
type TabDef = { v: string; l: string; I: typeof Gauge };
const DEFAULT_TABS: TabDef[] = [
  { v: "overview",      l: "כללי",  I: Gauge },
  { v: "summary",       l: "סיכום",         I: LineChart },
  { v: "study",         l: "חזרות",         I: GraduationCap },
  { v: "daf",           l: "תרגול",          I: BookOpen },
  { v: "categories",    l: "קטגוריות",      I: FolderTree },
  { v: "decks",         l: "בניית מבחנים",  I: BookOpen },
  { v: "questions",     l: "בניית שאלות",   I: CircleHelp },
  { v: "goals",         l: "יעדים",         I: Target },
  { v: "backup",        l: "גיבוי וייצוא",   I: Archive },
];

const SIDEBAR_NATIVE_IDS = new Set(DEFAULT_SIDEBAR_ITEMS.map((item) => item.id));
const HOME_TAB_IDS = new Set(DEFAULT_TABS.map((tab) => tab.v));

// Maps a home top-bar tab id to its corresponding sidebar section id (for blocklist sync).
// If a tab id matches a sidebar id directly, no mapping needed — handled via fallback.
const HOME_TAB_TO_SIDEBAR_ID: Record<string, string> = {
  backup: "backup-restore",
};

const DEFAULT_TABS_ALL: TabDef[] = (() => {
  const byId = new Set(DEFAULT_TABS.map((tab) => tab.v));
  // Dedupe by label too so aliases never render twice in the same strip.
  const byLabel = new Set(DEFAULT_TABS.map((tab) => tab.l));
  const out = [...DEFAULT_TABS];
  for (const item of DEFAULT_SIDEBAR_ITEMS) {
    if (byId.has(item.id) || byLabel.has(item.label)) continue;
    byId.add(item.id);
    byLabel.add(item.label);
    out.push({ v: item.id, l: item.label, I: item.icon });
  }
  return out;
})();

// All pages selectable for the sidebar: native items + home-tab pages
// (e.g. לימוד דף, חזרות לימוד). The configs themselves stay fully
// independent — this only widens the sidebar's own choice list. Entries whose
// id or label already exists as a native sidebar item are skipped to avoid
// duplicates (for example, יעדים).
const SIDEBAR_CHOICES: NavItem[] = (() => {
  const byId = new Set(DEFAULT_SIDEBAR_ITEMS.map((item) => item.id));
  const byLabel = new Set(DEFAULT_SIDEBAR_ITEMS.map((item) => item.label));
  const out = [...DEFAULT_SIDEBAR_ITEMS];
  for (const tab of DEFAULT_TABS) {
    if (byId.has(tab.v) || byLabel.has(tab.l)) continue;
    out.push({ id: tab.v, label: tab.l, icon: tab.I });
  }
  return out;
})();

const PROFILE_B_ALLOWED_HOME_TAB_IDS = new Set<string>([
  "overview",
  "daf",
  "categories",
  "decks",
  "questions",
]);

const PROFILE_B_ALLOWED_SIDEBAR_IDS = new Set<string>([
  "home",
  "categories",
  "decks",
  "questions",
  "search",
  "daf",
]);

const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar-width";
const USER_INFO_WIDTH_DESKTOP_STORAGE_KEY = "sidebar-user-info-width-desktop";
const USER_INFO_WIDTH_MOBILE_STORAGE_KEY = "sidebar-user-info-width-mobile";
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 420;
const USER_INFO_WIDTH_MIN = 45;
const USER_INFO_WIDTH_MAX = 75;

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const Index = () => {
  const initialSection = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("section") ?? "home")
    : "home";
  const [active, setActive] = useState(initialSection);
  const isMobile = useIsMobile();
  useEffect(() => {
    const onPop = () => {
      const s = new URLSearchParams(window.location.search).get("section");
      if (s) setActive(s);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [guidesOpen, setGuidesOpen] = useState(false);
  useEffect(() => {
    if (!hasSeenGuides()) setGuidesOpen(true);
  }, []);
  const { prompt: promptText, dialog: promptDialog } = usePrompt();
  const { user, signOut, isGuest, guestProfile, loading: authLoading } = useAuth();
  const { isAdmin: permissionIsAdmin, can, roles, loading: permsLoading } = usePermissions();
  // Authentication identity always wins over a cached/preview permission
  // snapshot. An offline/local/guest identity can never be an administrator.
  const isAdmin = permissionIsAdmin && !isGuest;
  const displayUserPrimary = isGuest
    ? (getLocalAccount()?.displayName ?? "אורח")
    : (user?.email ?? "");
  const displayUserRole = isAdmin
    ? "ADMIN"
    : (isGuest ? (getLocalAccount() ? "חשבון מקומי" : (guestProfile?.roleName ?? "")) : "");
  const previewRoleId = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("previewRole") ?? "";
  }, []);
  const roleIdsForBlocklist = useMemo(
    () => (previewRoleId ? [previewRoleId] : roles.map((r) => r.id)),
    [previewRoleId, roles],
  );
  const blocklist = useResolvedFeatureBlocklist(roleIdsForBlocklist, { scope: isMobile ? "mobile" : "desktop" });
  const blockedSidebarSet = useMemo(() => new Set(blocklist.sections ?? []), [blocklist.sections]);
  const sectionAccess = useMemo(() => ({
    isAdmin,
    canViewCards: isAdmin || can("cards", "view"),
    canViewDecks: isAdmin || can("decks", "view"),
    canViewGoals: isAdmin || can("goals", "view"),
    canViewShas: isAdmin || can("shas", "view"),
    canViewAnalytics: isAdmin || can("analytics", "view"),
    canViewSettings: isAdmin || can("settings", "view"),
  }), [can, isAdmin]);
  const canViewCardsModule = sectionAccess.canViewCards;
  const canViewDecksModule = sectionAccess.canViewDecks;
  const [profileBActive, setProfileBActive] = useState(false);
  const {
    state,
    setTabConfig: saveTabConfig,
    setSidebarConfig: saveSidebarConfig,
    setWidgetLayout: saveWidgetLayout,
    getHydrationSnapshot,
  } = useStudy();
  const { isHydrated } = getHydrationSnapshot();
  const appliedGuestProfileRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isGuest) {
      appliedGuestProfileRef.current = null;
      return;
    }

    const profileId = guestProfile?.id ?? "__plain_guest__";
    if (appliedGuestProfileRef.current === profileId) return;

    if (guestProfile?.tabConfig) saveTabConfig(guestProfile.tabConfig);
    if (guestProfile?.sidebarConfig) saveSidebarConfig(guestProfile.sidebarConfig);
    if (guestProfile?.widgetLayout) saveWidgetLayout(guestProfile.widgetLayout);

    appliedGuestProfileRef.current = profileId;
  }, [guestProfile, isGuest, saveSidebarConfig, saveTabConfig, saveWidgetLayout]);

  useEffect(() => {
    if (!isGuest || !guestProfile?.roleId) return;

    let cancelled = false;
    (async () => {
      const assignedProfile = await resolveRoleLayoutProfile(guestProfile.roleId, { scope: isMobile ? "mobile" : "desktop" }).catch(() => null);
      if (cancelled) return;

      if (assignedProfile) {
        if (Array.isArray(assignedProfile.sidebarConfig)) saveSidebarConfig(assignedProfile.sidebarConfig);
        if (assignedProfile.widgetLayout && typeof assignedProfile.widgetLayout === "object") {
          saveWidgetLayout(assignedProfile.widgetLayout);
        }
        return;
      }

      const { data } = await supabase
        .from("role_layout_defaults")
        .select("sidebar_config,widget_layout")
        .eq("role_id", guestProfile.roleId)
        .maybeSingle();

      if (cancelled || !data) return;

      const sidebar = data.sidebar_config as unknown as { id: string; visible: boolean; order: number }[] | null;
      const layout = data.widget_layout as unknown as Record<string, { id: string; visible: boolean; size: "half" | "full"; order: number; height?: number; collapsed?: boolean }[]> | null;
      if (Array.isArray(sidebar)) saveSidebarConfig(sidebar);
      if (layout && typeof layout === "object") saveWidgetLayout(layout);
    })();

    return () => {
      cancelled = true;
    };
  }, [guestProfile?.roleId, isGuest, isMobile, saveSidebarConfig, saveWidgetLayout]);

  useEffect(() => {
    let cancelled = false;

    const roleIds = isGuest
      ? (guestProfile?.roleId ? [guestProfile.roleId] : [])
      : roles.map((role) => role.id);

    if (roleIds.length === 0) {
      setProfileBMode(false);
      setProfileBActive(false);
      return;
    }

    void (async () => {
      const active = await isRoleAssignedToProfileB(roleIds, { scope: isMobile ? "mobile" : "desktop" }).catch(() => false);
      if (cancelled) return;
      setProfileBMode(active);
      setProfileBActive(active);
    })();

    return () => {
      cancelled = true;
    };
  }, [guestProfile?.roleId, isGuest, isMobile, roles]);

  useEffect(() => {
    if (!profileBActive) return;
    setSidebarConfigOpen(false);
    setTabConfigOpen(false);
  }, [profileBActive]);

  useAutoBackupRunner();
  const [pinned, setPinned] = useState(true);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [tabConfigOpen, setTabConfigOpen] = useState(false);
  const [sidebarConfigOpen, setSidebarConfigOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 256;
    const raw = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(raw) ? clampNumber(raw, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX) : 256;
  });
  const [userInfoDesktopWidthPct, setUserInfoDesktopWidthPct] = useState(() => {
    if (typeof window === "undefined") return 60;
    const raw = Number(window.localStorage.getItem(USER_INFO_WIDTH_DESKTOP_STORAGE_KEY));
    return Number.isFinite(raw) ? clampNumber(raw, USER_INFO_WIDTH_MIN, USER_INFO_WIDTH_MAX) : 60;
  });
  const [userInfoMobileWidthPct, setUserInfoMobileWidthPct] = useState(() => {
    if (typeof window === "undefined") return 60;
    const raw = Number(window.localStorage.getItem(USER_INFO_WIDTH_MOBILE_STORAGE_KEY));
    return Number.isFinite(raw) ? clampNumber(raw, USER_INFO_WIDTH_MIN, USER_INFO_WIDTH_MAX) : 60;
  });
  const userFooterDesktopRef = useRef<HTMLDivElement | null>(null);
  const userFooterMobileRef = useRef<HTMLDivElement | null>(null);

  // Swipe-from-right gesture to open mobile sidebar (RTL app = sidebar is on right)
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
    // Swipe left-to-right (positive dx) from right edge → open; swipe right-to-left → close
    if (dy < 60) {
      if (dx > 60 && touchStartX.current > window.innerWidth * 0.6) setMobileSidebarOpen(true);
      if (dx < -60) setMobileSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(USER_INFO_WIDTH_DESKTOP_STORAGE_KEY, String(userInfoDesktopWidthPct));
  }, [userInfoDesktopWidthPct]);

  useEffect(() => {
    window.localStorage.setItem(USER_INFO_WIDTH_MOBILE_STORAGE_KEY, String(userInfoMobileWidthPct));
  }, [userInfoMobileWidthPct]);

  const startSidebarResize = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!pinned) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      setSidebarWidth(clampNumber(startWidth + delta, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pinned, sidebarWidth]);

  const startUserInfoResize = useCallback((
    e: React.MouseEvent<HTMLButtonElement>,
    container: HTMLDivElement | null,
    currentValue: number,
    setValue: React.Dispatch<React.SetStateAction<number>>,
  ) => {
    if (!container) return;
    e.preventDefault();
    const startX = e.clientX;
    const startPct = currentValue;
    const usableWidth = Math.max(container.clientWidth - 108, 1);

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const deltaPct = (delta / usableWidth) * 100;
      setValue(clampNumber(startPct + deltaPct, USER_INFO_WIDTH_MIN, USER_INFO_WIDTH_MAX));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const [showTabsConfigIcon, setShowTabsConfigIcon] = useState(false);
  const [showStudiedBadge, setShowStudiedBadge] = useState(
    () => localStorage.getItem("show-studied-badge") !== "false"
  );
  const [activeTab, setActiveTab] = useState<string>(() => getInitialHomeTab());
  const [homeLandingTab, setHomeLandingTab] = useState<string | null>(null);
  // The overview contains several data-heavy widgets (calendar, summaries,
  // plans, etc.). Mount them only after the Home shell has had a chance to
  // paint, so the sidebar click responds immediately instead of appearing
  // frozen while React constructs the whole dashboard.
  const [homeOverviewReady, setHomeOverviewReady] = useState(false);
  const homeNavigationStartedAt = useRef<number | null>(null);
  // Only mount a tab's content the first time the user visits it.
  // On load, only the initially-active tab mounts its heavy widgets.
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([getInitialHomeTab()]));
  const tabsHoverTimer = useRef<number | null>(null);
  const tabSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (active !== "home" || activeTab !== "overview") {
      setHomeOverviewReady(false);
      return;
    }
    if (homeOverviewReady) return;

    // First frame paints the Home header/navigation. The second frame mounts
    // the expensive widgets without delaying the feedback from the click.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      if (import.meta.env.DEV && homeNavigationStartedAt.current !== null) {
        console.info("[navigation] home-shell-painted", JSON.stringify({
          elapsedMs: Math.round(performance.now() - homeNavigationStartedAt.current),
        }));
      }
      secondFrame = window.requestAnimationFrame(() => {
        setHomeOverviewReady(true);
        homeNavigationStartedAt.current = null;
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [active, activeTab, homeOverviewReady]);

  const handleTabsMouseEnter = useCallback(() => {
    if (tabsHoverTimer.current) window.clearTimeout(tabsHoverTimer.current);
    tabsHoverTimer.current = window.setTimeout(() => setShowTabsConfigIcon(true), 1000);
  }, []);

  const handleTabsMouseLeave = useCallback(() => {
    if (tabsHoverTimer.current) window.clearTimeout(tabsHoverTimer.current);
    tabsHoverTimer.current = null;
    setShowTabsConfigIcon(false);
  }, []);

  const handleTabsTouchStart = useCallback(() => {
    if (tabsHoverTimer.current) window.clearTimeout(tabsHoverTimer.current);
    tabsHoverTimer.current = window.setTimeout(() => setShowTabsConfigIcon(true), 600);
  }, []);

  const handleTabsTouchCancel = useCallback(() => {
    if (tabsHoverTimer.current) {
      window.clearTimeout(tabsHoverTimer.current);
      tabsHoverTimer.current = null;
    }
  }, []);

  // Auto-hide the overlay shortly after it appears (touch users have no mouseleave)
  useEffect(() => {
    if (!showTabsConfigIcon) return;
    const t = window.setTimeout(() => setShowTabsConfigIcon(false), 5000);
    return () => window.clearTimeout(t);
  }, [showTabsConfigIcon]);

  // Global shortcuts to open Smart Search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const code = e.code;
      const hasPrimary = e.ctrlKey || e.metaKey;
      const isOpenSearchShortcut =
        (hasPrimary && (key === "k" || code === "KeyK")) ||
        (hasPrimary && e.shiftKey && (key === "t" || code === "KeyT"));
      if (isOpenSearchShortcut) {
        e.preventDefault();
        setSearchModalOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Sidebar badges: hidden per user preference
  const sidebarBadges = useMemo(() => ({}), []);

  // "Studied today" detection for badge
  const studiedToday = useMemo(() => {
    const today = new Date().toDateString();
    return state.logs.some((l) => new Date(l.at).toDateString() === today);
  }, [state.logs]);

  const toggleStudiedBadge = useCallback(() => {
    setShowStudiedBadge((v) => {
      const next = !v;
      localStorage.setItem("show-studied-badge", String(next));
      return next;
    });
  }, []);

  // Build the ordered tab list (from saved config or defaults) — memoized so it
  // does not recompute on every store mutation.
  const orderedTabs: (TabDef & { visible: boolean })[] = useMemo(() => {
    const cfg = state.tabConfig ?? [];
    if (cfg.length === 0) return DEFAULT_TABS_ALL.map((t) => ({ ...t, visible: true }));
    const sorted = [...cfg].sort((a, b) => a.order - b.order);
    const result: (TabDef & { visible: boolean })[] = [];
    for (const c of sorted) {
      const def = DEFAULT_TABS_ALL.find((t) => t.v === c.id);
      if (def) result.push({ ...def, visible: c.visible });
    }
    for (const def of DEFAULT_TABS_ALL) {
      if (!result.find((r) => r.v === def.v)) result.push({ ...def, visible: true });
    }
    return result;
  }, [state.tabConfig]);

  const isAllowedByPermission = useCallback((id: string) => {
    if (profileBActive) {
      if (HOME_TAB_IDS.has(id)) return PROFILE_B_ALLOWED_HOME_TAB_IDS.has(id);
      return PROFILE_B_ALLOWED_SIDEBAR_IDS.has(id);
    }
    return canAccessAppSection(id, sectionAccess);
  }, [profileBActive, sectionAccess]);

  const visibleTabs = useMemo(() => orderedTabs.filter((t) => {
    // Sidebar-derived entries are allowed in the strip too (clicking one
    // navigates to its section) — only "home" itself is excluded, since the
    // strip already lives on the home page.
    if (t.v === "home") return false;
    if (!profileBActive && !t.visible) return false;
    if (profileBActive) return PROFILE_B_ALLOWED_HOME_TAB_IDS.has(t.v);
    if (!isAdmin || previewRoleId) {
      const sidebarId = HOME_TAB_TO_SIDEBAR_ID[t.v] ?? t.v;
      if (blockedSidebarSet.has(sidebarId)) return false;
    }
    return isAllowedByPermission(t.v);
  }), [orderedTabs, profileBActive, isAdmin, previewRoleId, blockedSidebarSet, isAllowedByPermission]);

  const visibleHomeTabs = useMemo(
    () => visibleTabs.filter((tab) => HOME_TAB_IDS.has(tab.v)),
    [visibleTabs],
  );

  // Home tabs the current role is allowed to SEE, ignoring the strip's
  // show/hide config. Used below so that explicit navigation (e.g. clicking
  // לימוד דף in the sidebar) works even when that tab is hidden from the
  // strip — strip config must never veto navigation, only presentation.
  const allowedHomeTabs = useMemo(() => orderedTabs.filter((t) => {
    if (!HOME_TAB_IDS.has(t.v)) return false;
    // Home/overview is the universal landing page. A display profile may hide
    // its tab from the strip, but must never make the Home button redirect to
    // another page or appear to do nothing.
    if (t.v === "overview") return true;
    if (profileBActive) return PROFILE_B_ALLOWED_HOME_TAB_IDS.has(t.v);
    if (!isAdmin || previewRoleId) {
      const sidebarId = HOME_TAB_TO_SIDEBAR_ID[t.v] ?? t.v;
      if (blockedSidebarSet.has(sidebarId)) return false;
    }
    return isAllowedByPermission(t.v);
  }), [orderedTabs, profileBActive, isAdmin, previewRoleId, blockedSidebarSet, isAllowedByPermission]);

  const configurableTabs = useMemo(
    () => orderedTabs.filter((tab) => isAllowedByPermission(tab.v)),
    [orderedTabs, isAllowedByPermission],
  );

  useEffect(() => {
    if (permsLoading) return;
    if (activeTab && !allowedHomeTabs.some((tab) => tab.v === activeTab)) {
      const fallback = visibleHomeTabs[0]?.v ?? "overview";
      setActiveTab(fallback);
      setVisitedTabs((prev) => {
        if (prev.has(fallback)) return prev;
        const next = new Set(prev);
        next.add(fallback);
        return next;
      });
      try { localStorage.setItem("active-tab", fallback); } catch { /* ignore */ }
    }
  }, [activeTab, permsLoading, allowedHomeTabs, visibleHomeTabs]);

  const handleTabDragEnd = useCallback((e: DragEndEvent) => {
    const { active: dragActive, over } = e;
    if (!over || dragActive.id === over.id) return;
    const oldIdx = orderedTabs.findIndex((t) => t.v === dragActive.id);
    const newIdx = orderedTabs.findIndex((t) => t.v === over.id);
    const newOrder = arrayMove(orderedTabs, oldIdx, newIdx);
    saveTabConfig(newOrder.map((t, i) => ({ id: t.v, visible: t.visible, order: i })));
  }, [orderedTabs, saveTabConfig]);

  const handleTabToggle = useCallback((tabId: string) => {
    const newOrder = orderedTabs.map((t) => ({ id: t.v, visible: t.v === tabId ? !t.visible : t.visible, order: orderedTabs.findIndex((x) => x.v === t.v) }));
    saveTabConfig(newOrder);
  }, [orderedTabs, saveTabConfig]);

  const allTabsSelected = useMemo(() => configurableTabs.every((tab) => tab.visible), [configurableTabs]);

  const toggleAllTabs = useCallback(() => {
    const nextVisible = !allTabsSelected;
    saveTabConfig(orderedTabs.map((tab, index) => ({
      id: tab.v,
      visible: isAllowedByPermission(tab.v) ? nextVisible : tab.visible,
      order: index,
    })));
  }, [allTabsSelected, orderedTabs, saveTabConfig, isAllowedByPermission]);

  const resetTabsConfig = useCallback(() => {
    saveTabConfig(DEFAULT_TABS_ALL.map((tab, index) => ({ id: tab.v, visible: true, order: index })));
  }, [saveTabConfig]);

  const orderedSidebarItems: (NavItem & { visible: boolean })[] = useMemo(() => {
    const cfg = normalizeSplitWorkspaceSidebarConfig(state.sidebarConfig ?? []);
    if (cfg.length === 0) return SIDEBAR_CHOICES.map((item) => ({ ...item, visible: true }));

    const sorted = [...cfg].sort((a, b) => a.order - b.order);
    const used = new Set<string>();
    const result: (NavItem & { visible: boolean })[] = [];

    for (const c of sorted) {
      if (used.has(c.id)) continue;
      const def = SIDEBAR_CHOICES.find((item) => item.id === c.id);
      if (!def) continue;
      result.push({ ...def, visible: c.visible });
      used.add(c.id);
    }

    // Items missing from the saved config (e.g. newly added pages) default to
    // hidden so an app update never floods an existing user's sidebar.
    for (const def of SIDEBAR_CHOICES) {
      if (!used.has(def.id)) result.push({ ...def, visible: false });
    }

    return result;
  }, [state.sidebarConfig]);

  const visibleSidebarItems = useMemo(() => orderedSidebarItems.filter((item) => {
    if (profileBActive) return PROFILE_B_ALLOWED_SIDEBAR_IDS.has(item.id);
    if (!item.visible) return false;
    if ((!isAdmin || previewRoleId) && blockedSidebarSet.has(item.id)) return false;
    return isAllowedByPermission(item.id);
  }), [orderedSidebarItems, profileBActive, isAdmin, previewRoleId, blockedSidebarSet, isAllowedByPermission]);

  const configurableSidebarItems = useMemo(
    () => orderedSidebarItems.filter((item) => isAllowedByPermission(item.id)),
    [orderedSidebarItems, isAllowedByPermission],
  );

  // Sections the user is ALLOWED to open, ignoring the sidebar strip's
  // show/hide config. Visibility config controls presentation, not navigation
  // rights — hiding "ניהול משתמשים" from the strip must not make the admin
  // panel unreachable via direct navigation (?section=admin). Same rule the
  // home tabs already use via allowedHomeTabs.
  const navigableSidebarIds = useMemo(() => {
    const ids = orderedSidebarItems
      .filter((item) => {
        if (profileBActive) return PROFILE_B_ALLOWED_SIDEBAR_IDS.has(item.id);
        if ((!isAdmin || previewRoleId) && blockedSidebarSet.has(item.id)) return false;
        return isAllowedByPermission(item.id);
      })
      .map((item) => item.id);
    return new Set(ids);
  }, [orderedSidebarItems, profileBActive, isAdmin, previewRoleId, blockedSidebarSet, isAllowedByPermission]);

  useEffect(() => {
    // Wait for BOTH auth and permissions before bouncing. While the session is
    // still being restored `user` is null, which makes usePermissions publish an
    // empty (isAdmin: false) set with loading already false — so bouncing here
    // would kick an admin off ?section=admin before their role ever loaded.
    if (authLoading || permsLoading) return;
    // Session restore races a boot timeout, so there is a window where auth
    // reports "finished" while `user` is still null and permissions are an
    // empty (isAdmin: false) set. Bouncing then would kick an admin off
    // ?section=admin moments before their real session arrives. With no user
    // and no guest profile there is nothing to authorise against anyway —
    // RequireAuth owns that redirect.
    if (!user && !isGuest) return;
    // Permissions can land a render AFTER `loading` flips to false (the hook
    // publishes an empty set for a not-yet-known user). Bouncing on that empty
    // set is what made ?section=admin unreachable for admins. Wait until roles
    // have actually materialised before treating a section as forbidden.
    if (!isGuest && roles.length === 0) return;
    if (navigableSidebarIds.has(active)) return;
    setActive(visibleSidebarItems[0]?.id ?? "home");
  }, [active, navigableSidebarIds, visibleSidebarItems, permsLoading, authLoading, user, isGuest, roles]);


  useEffect(() => {
    if (permsLoading) return;
    if (["cards", "categories", "decks", "questions"].includes(active) && !isAllowedByPermission(active)) {
      setActive("home");
    }
  }, [active, isAllowedByPermission, permsLoading]);

  const handleSidebarDragEnd = useCallback((e: DragEndEvent) => {
    const { active: dragActive, over } = e;
    if (!over || dragActive.id === over.id) return;
    const oldIdx = orderedSidebarItems.findIndex((item) => item.id === dragActive.id);
    const newIdx = orderedSidebarItems.findIndex((item) => item.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const newOrder = arrayMove(orderedSidebarItems, oldIdx, newIdx);
    saveSidebarConfig(newOrder.map((item, i) => ({ id: item.id, visible: item.visible, order: i })));
  }, [orderedSidebarItems, saveSidebarConfig]);

  const handleSidebarToggle = useCallback((itemId: string) => {
    const newOrder = orderedSidebarItems.map((item) => {
      if (item.id !== itemId) return { id: item.id, visible: item.visible, order: orderedSidebarItems.findIndex((x) => x.id === item.id) };
      if (item.id === "home") return { id: item.id, visible: true, order: orderedSidebarItems.findIndex((x) => x.id === item.id) };
      return { id: item.id, visible: !item.visible, order: orderedSidebarItems.findIndex((x) => x.id === item.id) };
    });
    saveSidebarConfig(newOrder);
  }, [orderedSidebarItems, saveSidebarConfig]);

  const allSidebarSelected = useMemo(
    () => configurableSidebarItems.filter((item) => item.id !== "home").every((item) => item.visible),
    [configurableSidebarItems],
  );

  const toggleAllSidebar = useCallback(() => {
    const nextVisible = !allSidebarSelected;
    saveSidebarConfig(
      orderedSidebarItems.map((item, index) => ({
        id: item.id,
        visible: item.id === "home"
          ? true
          : (isAllowedByPermission(item.id) ? nextVisible : item.visible),
        order: index,
      })),
    );
  }, [allSidebarSelected, orderedSidebarItems, saveSidebarConfig, isAllowedByPermission]);

  const resetSidebarConfig = useCallback(() => {
    saveSidebarConfig(SIDEBAR_CHOICES.map((item, index) => ({ id: item.id, visible: true, order: index })));
  }, [saveSidebarConfig]);

  // Async settings gate — uses the usePrompt dialog because window.prompt is
  // not supported inside Electron (the call silently fails, so the button
  // appeared dead in the desktop app).
  const requireSettingsAuth = useCallback(async (): Promise<boolean> => {
    try {
      if (sessionStorage.getItem("settings-unlocked") === "1") return true;
    } catch { /* ignore */ }
    const input = await promptText("להזנת אזור ההגדרות יש להזין סיסמה:", {
      title: "אזור הגדרות",
      password: true,
    });
    if (input === null) return false;
    if (input === "543211") {
      try { sessionStorage.setItem("settings-unlocked", "1"); } catch { /* ignore */ }
      return true;
    }
    toast({ title: "סיסמה שגויה", variant: "destructive" });
    return false;
  }, [promptText]);

  const selectSidebarItem = useCallback(async (id: string) => {
    if (import.meta.env.DEV) {
      console.info("[navigation] sidebar-select", JSON.stringify({
        requestedSection: id,
        currentSection: active,
        currentHomeTab: activeTab,
        location: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      }));
    }
    // Home is the safe landing page for every profile. Handle it before any
    // permission gate and clear stale deep-link parameters, otherwise a page
    // opened through `?section=...` can appear to ignore the Home click (and
    // will certainly reopen the old section after a refresh).
    if (id === "home") {
      const landingTab = "overview";
      homeNavigationStartedAt.current = performance.now();
      setHomeOverviewReady(false);
      setActive("home");
      setActiveTab(landingTab);
      setHomeLandingTab(landingTab);
      setVisitedTabs((s) => (s.has(landingTab) ? s : new Set(s).add(landingTab)));
      try {
        localStorage.setItem("active-tab", landingTab);
        const nextLocation = getHomeLocation(window.location.href);
        window.history.replaceState({}, "", nextLocation);
        if (import.meta.env.DEV) {
          console.info("[navigation] home-request-committed", JSON.stringify({
            section: "home",
            homeTab: landingTab,
            location: nextLocation,
          }));
        }
      } catch { /* ignore unavailable browser storage/history */ }
      return;
    }
    if (!isAllowedByPermission(id)) {
      toast({ title: "אין הרשאה לפתוח אזור זה", variant: "destructive" });
      return;
    }
    if (id === "settings" && !(await requireSettingsAuth())) return;
    // "בית" must return to the home overview. When the user is on a home-tab
    // (e.g. חזרות לימוד) `active` is already "home" with a sub-tab active, so
    // just setActive("home") would be a no-op — explicitly reset the tab too.
    if (HOME_TAB_IDS.has(id) && !SIDEBAR_NATIVE_IDS.has(id)) {
      setHomeLandingTab(null);
      setActive("home");
      setActiveTab(id);
      setVisitedTabs((s) => {
        const next = s.has(id) ? s : new Set(s);
        next.add(id);
        return next;
      });
      try { localStorage.setItem("active-tab", id); } catch { /* ignore */ }
      return;
    }
    setHomeLandingTab(null);
    setActive(id);
  }, [active, activeTab, isAllowedByPermission, requireSettingsAuth]);

  const sidebarActiveId = active === "home" && homeLandingTab === activeTab
    ? "home"
    : active === "home" && HOME_TAB_IDS.has(activeTab) && !SIDEBAR_NATIVE_IDS.has(activeTab)
      ? activeTab
      : active;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.info("[navigation] state-rendered", JSON.stringify({
      section: active,
      homeTab: activeTab,
      sidebarActiveId,
      location: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    }));
  }, [active, activeTab, sidebarActiveId]);

  const renderSidebarPage = (pageId: string) => {
    // Defence in depth: do not even mount privileged components when a stale
    // URL, persisted active tab or programmatic navigation targets them.
    if (["db-inspector", "perf", "ai-generator", "question-lab", "system-rubric"].includes(pageId) && !isAdmin) {
      return (
        <Card className="gold-frame p-8 text-center" dir="rtl">
          <Shield className="mx-auto mb-3 h-10 w-10 text-gold" />
          <h2 className="text-xl font-bold text-foreground">אין הרשאה לאזור זה</h2>
          <p className="mt-2 text-sm text-muted-foreground">האזור זמין למנהלי המערכת בלבד.</p>
        </Card>
      );
    }
    switch (pageId) {
      case "blocker":
        return (
          <SidebarWorkspace
            title="בודק רצפים"
            subtitle="מדדי רצף, ניתוח נקודות שבירה ופעולות שיפור"
            tabId="blocker"
            widgetMap={{
              "blocker-overview": <WeeklySummary />,
              "blocker-insights": <PlaceholderPanel title="תובנות רצף" subtitle="ניתוח ימים חזקים מול ימים חלשים והמלצות אוטומטיות" icon={Gauge} />,
              "blocker-actions": <PlaceholderPanel title="פעולות מומלצות" subtitle="רשימת צעדים יומיים לשימור הרצף" icon={CheckSquare} />,
            }}
          />
        );
      case "morning":
        return (
          <SidebarWorkspace
            title="קימה בבוקר"
            subtitle="שגרת בוקר, בקרה ומעקב רציף"
            tabId="morning"
            widgetMap={{
              "morning-routine": <DailyTrackers />,
              "morning-energy": <PlaceholderPanel title="מדדי אנרגיה" subtitle="מדדי פתיחה יומיים והתקדמות שבועית" icon={Sun} />,
            }}
          />
        );
      case "today":
        return (
          <SidebarWorkspace
            title="היום שלי"
            subtitle={"פוקוס יומי, לו\"ז והערות מהירות"}
            tabId="today"
            widgetMap={{
              "today-focus": <AICoachCard />,
              "today-schedule": <PlaceholderPanel title={"לו\"ז יומי"} subtitle="תכנון בלוקים ומיקוד למשימות החשובות" icon={Calendar} />,
              "today-notes": <PlaceholderPanel title="הערות היום" subtitle="רשומות קצרות ותובנות לאורך היום" icon={BookOpen} />,
            }}
          />
        );
      case "tasks":
        return (
          <SidebarWorkspace
            title="לוח משימות"
            subtitle="ניהול משימות חכם עם סדרי עדיפויות"
            tabId="tasks"
            widgetMap={{
              "tasks-board": <PlaceholderPanel title="לוח משימות" subtitle="לוח קנבן אישי עם מצבי עבודה" icon={CheckSquare} />,
              "tasks-priority": <PlaceholderPanel title="עדיפויות" subtitle="משימות קריטיות להיום עם דירוג דחיפות" icon={Target} />,
              "tasks-inbox": <PlaceholderPanel title="תיבת משימות" subtitle="ריכוז משימות חדשות לפני סיווג" icon={Archive} />,
            }}
          />
        );
      case "habits":
        return (
          <SidebarWorkspace
            title="הרגלים"
            subtitle="מעקב ביצוע והרגלי מפתח"
            tabId="habits"
            widgetMap={{
              "habits-tracker": <DailyTrackers />,
              "habits-streak": <PlaceholderPanel title="רצפי הרגלים" subtitle="רצף יומי/שבועי לכל הרגל" icon={Target} />,
            }}
          />
        );
      case "journal":
        return (
          <SidebarWorkspace
            title="יומן"
            subtitle="כתיבה יומית ותיעוד תובנות"
            tabId="journal"
            widgetMap={{
              "journal-entry": <PlaceholderPanel title="רשומה חדשה" subtitle="כתיבה חופשית של מהלך היום" icon={BookOpen} />,
              "journal-history": <PlaceholderPanel title="היסטוריה" subtitle="צפייה וניווט ברשומות קודמות" icon={Archive} />,
            }}
          />
        );
      case "timer":
        return (
          <SidebarWorkspace
            title="טיימר"
            subtitle="זמני פוקוס, הפסקות ומדדי קצב"
            tabId="timer"
            widgetMap={{
              "timer-main": <PomodoroCard />,
              "timer-summary": <PlaceholderPanel title="סיכום טיימר" subtitle="סטטיסטיקת סשנים וזמן מצטבר" icon={Timer} />,
            }}
          />
        );
      case "monitor":
        return (
          <SidebarWorkspace
            title="בקרת מעקב"
            subtitle="תמונת מצב כוללת של למידה וביצועים"
            tabId="monitor"
            widgetMap={{
              "monitor-summary": <WeeklySummary />,
              "monitor-analytics": <KnowledgeAnalytics />,
              "monitor-alerts": <PlaceholderPanel title="התראות" subtitle="איתור חריגות ודגשים לפעולה" icon={Activity} />,
            }}
          />
        );
      case "goals":
        return (
          <SidebarWorkspace
            title="יעדים יומיים"
            subtitle="יעדים, תזכורות והתקדמות"
            tabId="goals_page"
            widgetMap={{
              "goals-main": <GoalsManager />,
              "goals-reminders": <ReminderSettings />,
              "goals-progress": <ShasTracker />,
            }}
          />
        );
      case "book":
        return (
          <SidebarWorkspace
            title="הספר שלי"
            subtitle="מעקב לימוד אישי ותכניות"
            tabId="book"
            widgetMap={{
              "book-learning": <ShasTracker />,
              "book-plans": <StudyPlansCard />,
              "book-today-reviews": <TodayReviewsCard />,
            }}
          />
        );
      case "studio":
        return (
          <SidebarWorkspace
            title="סטודיו מסמכים"
            subtitle="ניהול מסמכים, טיוטות וגרסאות"
            tabId="studio"
            widgetMap={{
              "studio-files": <PlaceholderPanel title="קבצים" subtitle="רשימת קבצים וארגון תיקיות" icon={Folder} />,
              "studio-recent": <PlaceholderPanel title="פעילות אחרונה" subtitle="שינויים ועדכונים אחרונים" icon={Activity} />,
            }}
          />
        );
      case "pdf":
        return (
          <SidebarWorkspace
            title="צפיין PDF"
            subtitle="קריאה, סימון והערות"
            tabId="pdf"
            widgetMap={{
              "pdf-viewer": <PlaceholderPanel title="צפייה" subtitle="תצוגת מסמך פעיל" icon={FileText} />,
              "pdf-notes": <PlaceholderPanel title="הערות" subtitle="סיכומים וסימונים לפי עמוד" icon={BookOpen} />,
            }}
          />
        );
      case "ai":
        return (
          <SidebarWorkspace
            title="מאמן AI"
            subtitle="הכוונה יומית וכלי עזר חכמים"
            tabId="ai_page"
            widgetMap={{
              "ai-coach-main": <AICoachCard />,
              "ai-tools": <PlaceholderPanel title="כלי AI" subtitle="סיכום, ניסוח ושאלות מונחות" icon={Sparkles} />,
            }}
          />
        );
      case "achievements":
        return (
          <SidebarWorkspace
            title="הישגים"
            subtitle="תגים, נקודות ורצפים"
            tabId="achievements_page"
            widgetMap={{
              "achievements-streak": <PlaceholderPanel title="רצף הישגים" subtitle="מדידת עקביות בלמידה" icon={Trophy} />,
              "achievements-badges": <PlaceholderPanel title="תגים" subtitle="איסוף הישגים לפי אבני דרך" icon={Check} />,
            }}
          />
        );
      case "archive":
        return (
          <SidebarWorkspace
            title="ארכיון"
            subtitle="חיפוש והחזרת תכנים היסטוריים"
            tabId="archive"
            widgetMap={{
              "archive-search": <PlaceholderPanel title="חיפוש בארכיון" subtitle="איתור מהיר לפי תגיות/תאריך" icon={Archive} />,
              "archive-recent": <PlaceholderPanel title="אחרונים בארכיון" subtitle="פריטים שנשמרו לאחרונה" icon={FileText} />,
            }}
          />
        );
      case "backup-restore":
        return <BackupRestorePage />;
      case "shas-board":
        return <ShasBoard />;
      case "db-inspector":
        return <SupabaseInspectorPage />;
      case "perf":
        return <PerformancePage />;
      case "ai-generator":
        return <AIQuestionGenerator />;
      case "question-lab":
        return <QuestionLabPage />;
      case "system-rubric":
        return <SystemRubric />;
      default:
        return null;
    }
  };

  const sidebarVisible = pinned || sidebarHovered;

  return (
    <div className="min-h-screen bg-background" dir="rtl" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <PreviewRoleApplier />
      <AutoInitShasTemplate />
      {/* Edge trigger zone — only when not pinned */}
      {!pinned && (
        <div
          className="fixed right-0 top-0 h-full w-3 z-50"
          onMouseEnter={() => setSidebarHovered(true)}
        />
      )}

      <div className="flex">
        {/* Desktop sidebar — pinned: part of layout | auto-hide: fixed overlay */}
        <aside
          className={cn(
            "hidden lg:flex flex-col bg-sidebar relative group/sidebar",
            pinned
              ? "h-screen sticky top-0 self-start flex-shrink-0"
              : "fixed right-0 top-0 h-screen z-40 shadow-2xl transition-transform duration-300",
            !pinned && !sidebarVisible && "translate-x-full",
          )}
          style={{ width: `${sidebarWidth}px` }}
          onMouseLeave={() => !pinned && setSidebarHovered(false)}
        >
          <div className="px-4 h-[60px] border-b-2 border-gold/40 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={async () => { if (await requireSettingsAuth()) setSidebarConfigOpen(true); }}
                title="הגדרת סיידבר"
                className="flex items-center justify-center h-8 w-8 rounded-full hover:bg-secondary text-gold hover:text-navy transition-colors"
                style={{ display: profileBActive ? "none" : undefined }}
              >
                <Sliders className="h-4 w-4" />
              </button>
              <button
                onClick={async () => { if (await requireSettingsAuth()) setTabConfigOpen(true); }}
                title="הגדרת טאבים"
                className="flex items-center justify-center h-8 w-8 rounded-full hover:bg-secondary text-gold hover:text-navy transition-colors"
                style={{ display: profileBActive ? "none" : undefined }}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
              <button
                onClick={() => { setPinned((v) => !v); setSidebarHovered(false); }}
                title={pinned ? "בטל הצמדה" : "הצמד סרגל"}
                className="flex items-center justify-center h-8 w-8 rounded-full hover:bg-secondary text-gold hover:text-navy transition-colors"
              >
                {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </button>
            </div>
            <Logo />
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <SidebarContent items={visibleSidebarItems} active={sidebarActiveId} onSelect={(id) => { selectSidebarItem(id); if (!pinned) setSidebarHovered(false); }} badges={sidebarBadges} />
          </div>
          <div className="border-t-2 border-gold/40 p-3 flex-shrink-0">
            <div ref={userFooterDesktopRef} className="w-full rounded-xl border-2 border-gold/40 bg-card px-2 py-2">
              <div className="flex w-full min-w-0 items-center gap-2">
                <button
                onClick={async () => { if (await requireSettingsAuth()) setActive("settings"); }}
                className="min-w-0 flex flex-1 items-center gap-2 rounded-lg px-1 py-1 hover:bg-secondary/70 transition-colors text-right"
                title="הגדרות משתמש"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-navy text-primary-foreground text-sm font-bold">
                  {isGuest ? "א" : (user?.email?.[0] ?? "?").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0 leading-tight text-foreground">
                  <div className="text-[11px] font-medium break-all">{displayUserPrimary}</div>
                  {displayUserRole ? <div className="text-[10px] font-semibold text-gold/90">{displayUserRole}</div> : null}
                </div>
                </button>
                <DesktopUpdateButton />
                <DesktopAppDownloadButton />
              </div>
              <div className="mt-1.5 flex w-full items-center justify-end gap-1.5 border-t border-gold/20 pt-1.5">
                <button
                  onClick={() => setGuidesOpen(true)}
                  title="מדריכים והדרכה"
                  className="flex items-center justify-center aspect-square h-6 w-6 rounded-full border border-gold/70 bg-card text-navy hover:bg-secondary transition-colors [&_svg]:size-3"
                >
                  <CircleHelp className="h-3 w-3" />
                </button>
                <ThemeSwitcher />
                <UserQuestionsExportButton />
                <button
                  onClick={() => signOut()}
                  title={isGuest ? "יציאה" : "התנתקות"}
                  className="flex items-center justify-center aspect-square h-6 w-6 rounded-full border border-gold/70 bg-card text-navy hover:bg-secondary transition-colors [&_svg]:size-3"
                >
                  <LogOut className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            onMouseDown={startSidebarResize}
            title="שנה רוחב סיידבר"
            className={cn(
              "absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 h-14 w-2 cursor-col-resize transition-all duration-200 opacity-0 pointer-events-none group-hover/sidebar:opacity-100 group-hover/sidebar:pointer-events-auto group-hover/sidebar:w-3",
              !pinned && "pointer-events-none opacity-0",
            )}
            aria-label="שנה רוחב סיידבר"
          >
            <span className="mx-auto block h-full w-px bg-gold/40 transition-colors group-hover/sidebar:bg-gold/70" />
          </button>
        </aside>

        {/* Main — when not pinned, add margin-right that animates with sidebar */}
        <main
          className="flex-1 min-w-0 transition-[margin] duration-300"
          style={!pinned ? { marginRight: sidebarVisible ? `${sidebarWidth}px` : "0" } : undefined}
        >
          {/* Topbar */}
          <header className="[--topbar-h:56px] sm:[--topbar-h:60px] flex items-center justify-end gap-2 border-b-2 border-gold/40 bg-background px-2 h-[56px] sm:px-4 sm:gap-3 sm:h-[60px] lg:px-8 overflow-hidden" style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(var(--topbar-h) + env(safe-area-inset-top))" }}>
            <div className="flex-1 min-w-0 px-1 sm:px-4">
              <DedicationBanner />
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden sm:block"><Logo size="sm" /></div>
              <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen} modal={false}>
                {/* Hamburger + adjacent floating config icons (absolute so they NEVER widen the page) */}
                <div
                  className="relative shrink-0"
                  onMouseEnter={handleTabsMouseEnter}
                  onMouseLeave={handleTabsMouseLeave}
                  onTouchStart={handleTabsTouchStart}
                  onTouchEnd={handleTabsTouchCancel}
                  onTouchMove={handleTabsTouchCancel}
                  onTouchCancel={handleTabsTouchCancel}
                >
                  <SheetTrigger asChild>
                    <Button variant="outline" size="icon" className="lg:hidden rounded-full border-2 border-gold h-10 w-10 shrink-0" onClick={() => setMobileSidebarOpen(true)}>
                      <Menu className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                  {!profileBActive && (
                    <div
                      className={cn(
                        // Absolute → does not affect layout width. In RTL, right-full puts it to the LEFT of the hamburger (i.e. just inside the page, opposite the page edge).
                        "absolute top-1/2 -translate-y-1/2 right-full mr-2 flex items-center gap-1 rounded-xl border-2 border-gold/60 bg-card/95 backdrop-blur-sm p-0.5 shadow-elegant transition-all duration-200 origin-right z-50",
                        showTabsConfigIcon
                          ? "opacity-100 scale-100 pointer-events-auto"
                          : "opacity-0 scale-90 pointer-events-none",
                      )}
                    >
                      <button
                        onClick={async () => { if (await requireSettingsAuth()) { setSidebarConfigOpen(true); setShowTabsConfigIcon(false); } }}
                        title="הגדרת סיידבר"
                        className="flex items-center justify-center h-8 w-8 rounded-lg text-navy hover:bg-secondary transition-colors"
                      >
                        <Sliders className="h-4 w-4" />
                      </button>
                      <button
                        onClick={async () => { if (await requireSettingsAuth()) { setTabConfigOpen(true); setShowTabsConfigIcon(false); } }}
                        title="הגדרת טאבים"
                        className="flex items-center justify-center h-8 w-8 rounded-lg text-navy hover:bg-secondary transition-colors"
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                <SheetContent side="right" showOverlay={false} className="w-72 p-0 border-l-2 border-gold flex flex-col">
                  <div className="p-4 border-b-2 border-gold/30 flex-shrink-0"><Logo /></div>
                  <div className="flex-1 overflow-y-auto no-scrollbar">
                    <SidebarContent items={visibleSidebarItems} active={sidebarActiveId} onSelect={(id) => { selectSidebarItem(id); setMobileSidebarOpen(false); }} badges={sidebarBadges} />
                  </div>
                  <div className="border-t-2 border-gold/40 p-3 flex-shrink-0">
                    <div ref={userFooterMobileRef} className="w-full rounded-xl border-2 border-gold/40 bg-card px-2 py-2">
                      <div className="flex w-full min-w-0 items-center gap-2">
                        <button
                        onClick={async () => { if (await requireSettingsAuth()) { setActive("settings"); setMobileSidebarOpen(false); } }}
                        className="min-w-0 flex flex-1 items-center gap-2 rounded-lg px-1 py-1 hover:bg-secondary/70 transition-colors text-right"
                        title="הגדרות משתמש"
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-navy text-primary-foreground text-sm font-bold">
                          {isGuest ? "א" : (user?.email?.[0] ?? "?").toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0 leading-tight text-foreground">
                          <div className="text-[11px] font-medium break-all">{displayUserPrimary}</div>
                          {displayUserRole ? <div className="text-[10px] font-semibold text-gold/90">{displayUserRole}</div> : null}
                        </div>
                        </button>
                        <DesktopUpdateButton />
                        <DesktopAppDownloadButton />
                      </div>
                      <div className="mt-1.5 flex w-full items-center justify-end gap-1.5 border-t border-gold/20 pt-1.5">
                        <button
                          onClick={() => { setGuidesOpen(true); setMobileSidebarOpen(false); }}
                          title="מדריכים והדרכה"
                          className="flex items-center justify-center aspect-square h-6 w-6 rounded-full border border-gold/70 bg-card text-navy hover:bg-secondary transition-colors [&_svg]:size-3"
                        >
                          <CircleHelp className="h-3 w-3" />
                        </button>
                        <ThemeSwitcher />
                        <UserQuestionsExportButton />
                        <button
                          onClick={() => { signOut(); setMobileSidebarOpen(false); }}
                          title={isGuest ? "יציאה" : "התנתקות"}
                          className="flex items-center justify-center aspect-square h-6 w-6 rounded-full border border-gold/70 bg-card text-navy hover:bg-secondary transition-colors [&_svg]:size-3"
                        >
                          <LogOut className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </header>

          {/* Content */}
          <div className="p-3 sm:p-4 lg:p-8 space-y-4 sm:space-y-6 max-w-6xl mx-auto">
            {!navigableSidebarIds.has(active) ? (
              <Card className="gold-frame p-8 text-center" dir="rtl">
                <Shield className="mx-auto mb-3 h-10 w-10 text-gold" />
                <h2 className="text-xl font-bold text-foreground">אין הרשאה לאזור זה</h2>
                <p className="mt-2 text-sm text-muted-foreground">האזור זמין למנהלי המערכת בלבד.</p>
              </Card>
            ) : active === "settings" ? (
              <Suspense fallback={<StaticLazyPanelPreview />}>
                <SettingsPanel />
              </Suspense>
            ) : (["cards", "categories", "decks", "questions"].includes(active)) && isAllowedByPermission(active) ? (
              <Suspense fallback={<StaticLazyPanelPreview />}>
                <CardsAndCategoriesPage
                  initialTab={active === "decks" ? "decks" : active === "questions" ? "questions" : "categories"}
                  hideNavigation
                />
              </Suspense>
            ) : active === "search" ? (
              <div className="space-y-6">
                <div className="text-center space-y-1 animate-fade-in">
                  <h1 className="font-display text-2xl font-bold text-gold">חיפוש חכם</h1>
                  <p className="text-muted-foreground text-sm">חפש שאלות, תשובות, תגיות, קטגוריות ומערכות · קיצור: Ctrl+K (וגם Ctrl+Shift+T)</p>
                </div>
                <Suspense fallback={<StaticLazyPanelPreview compact />}>
                  <SmartSearch variant="page" />
                </Suspense>
              </div>
            ) : active === "admin" && isAdmin ? (
              <Suspense fallback={<StaticLazyPanelPreview />}>
                <AdminPanel />
              </Suspense>
            ) : active !== "home" ? (
              <Suspense fallback={<StaticLazyPanelPreview />}>
                {renderSidebarPage(active)}
              </Suspense>
            ) : (
            <>
            {activeTab === "overview" && <div className="text-center space-y-2 animate-fade-in">
              <p className="font-display text-3xl sm:text-5xl lg:text-7xl font-bold text-gold leading-tight">למען תהיה תורת ה' בפיך</p>
              <h1 className="font-display text-xl sm:text-2xl lg:text-3xl font-semibold text-foreground">מערכת לימוד וחזרות</h1>
              <p className="text-muted-foreground text-sm sm:text-base">עקוב אחר ההתקדמות שלך וקבל תובנות מתקדמות</p>
            </div>}

            <Tabs
              value={activeTab}
              onValueChange={(v) => {
                setHomeLandingTab(null);
                if (!HOME_TAB_IDS.has(v)) {
                  // Sidebar-derived tab — route through selectSidebarItem so
                  // gated sections (settings) still require the password.
                  void selectSidebarItem(v);
                  return;
                }
                setActive("home");
                setActiveTab(v);
                setVisitedTabs((s) => {
                  const next = s.has(v) ? s : new Set(s);
                  next.add(v);
                  return next;
                });
                try { localStorage.setItem("active-tab", v); } catch { /* ignore */ }
              }}
              className="w-full" dir="rtl"
            >
              <Card className="gold-frame relative p-1 lg:hidden">
                <TabsList
                  className="grid h-auto w-full grid-cols-2 gap-1 bg-transparent p-0 sm:grid-cols-3 md:grid-cols-5"
                  dir="rtl"
                >
                  {HOME_TAB_IDS.has(activeTab) && !visibleTabs.some((tab) => tab.v === activeTab) && (
                    <TabsTrigger value={activeTab} className="hidden" aria-hidden tabIndex={-1} />
                  )}
                  {visibleTabs.map(({ v, l, I }) => (
                    <TabsTrigger
                      key={v} value={v}
                      className="w-full min-w-0 justify-center gap-1 rounded-lg border border-gold/20 bg-card/40 px-2 py-1.5 text-xs whitespace-nowrap sm:bg-transparent data-[state=active]:border-transparent data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                    >
                      <span className="relative">
                        {l}
                        {v === "study" && showStudiedBadge && studiedToday && (
                          <span className="absolute -top-1 -right-1.5 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-background" />
                        )}
                      </span>
                      <I className="h-3.5 w-3.5" />
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Card>

              <TabsContent value="overview" className="mt-3">
                {visitedTabs.has("overview") && (
                  homeOverviewReady ? <Suspense fallback={<StaticLazyPanelPreview />}>
                    <WidgetGrid
                      tabId="overview"
                      widgetMap={{
                        "weekly-summary":  <WeeklySummary />,
                        "study-plans":     <StudyPlansCard />,
                        "quiz-plans":      <QuizPlansCard />,
                        "today-reviews":   <TodayReviewsCard />,
                        "insights":        <InsightsCard />,
                        "goals-manager":   <GoalsManager />,
                        "daily-trackers":  <DailyTrackers />,
                        "quote-card":      <QuoteCard />,
                        "ai-coach":        <AICoachCard />,
                        "next-alarm":      <NextAlarmCard />,
                        "pomodoro":        <PomodoroCard />,
                        "task-card": <TaskCard />,
                        "heatmap":         <HeatmapPanel days={35} />,
                        "review-calendar": <ReviewCalendar />,
                      }}
                    />
                  </Suspense> : <StaticLazyPanelPreview />
                )}
              </TabsContent>

              <TabsContent value="summary" className="mt-3">
                {visitedTabs.has("summary") && (
                  <Suspense fallback={<StaticLazyPanelPreview />}>
                    <SummaryDashboard />
                  </Suspense>
                )}
              </TabsContent>

              <TabsContent value="study" className="mt-3">
                {visitedTabs.has("study") && (
                  <Suspense fallback={<StaticLazyPanelPreview />}>
                    <StudyTab showBadge={showStudiedBadge} onToggleBadge={toggleStudiedBadge} />
                  </Suspense>
                )}
              </TabsContent>

              <TabsContent value="daf" className="mt-3" forceMount>
                {visitedTabs.has("daf") && (
                  <Suspense fallback={<StaticLazyPanelPreview />}>
                    <DafLearningTab isVisible={activeTab === "daf"} />
                  </Suspense>
                )}
              </TabsContent>

              <TabsContent value="goals" className="mt-3">
                {visitedTabs.has("goals") && (
                  <Suspense fallback={<StaticLazyPanelPreview />}>
                    <WidgetGrid
                      tabId="goals"
                      widgetMap={{
                        "study-plans":       <StudyPlansCard />,
                        "quiz-plans":        <QuizPlansCard />,
                        "today-reviews":     <TodayReviewsCard />,
                        "insights":          <InsightsCard />,
                        "goals-manager":     <GoalsManager />,
                        "reminder-settings": <ReminderSettings />,
                      }}
                    />
                  </Suspense>
                )}
              </TabsContent>

              <TabsContent value="analytics" className="mt-3">
                {visitedTabs.has("analytics") && (
                  <Suspense fallback={<StaticLazyPanelPreview />}>
                    <KnowledgeAnalytics />
                  </Suspense>
                )}
              </TabsContent>

              <TabsContent value="categories" className="mt-3" forceMount>
                {visitedTabs.has("categories") && (
                  <Suspense fallback={<StaticLazyPanelPreview />}>
                    <CardsAndCategoriesPage initialTab="categories" hideNavigation />
                  </Suspense>
                )}
              </TabsContent>

              <TabsContent value="decks" className="mt-3" forceMount>
                {visitedTabs.has("decks") && (
                  <Suspense fallback={<StaticLazyPanelPreview />}>
                    <CardsAndCategoriesPage initialTab="decks" hideNavigation />
                  </Suspense>
                )}
              </TabsContent>

              <TabsContent value="questions" className="mt-3" forceMount>
                {visitedTabs.has("questions") && (
                  <Suspense fallback={<StaticLazyPanelPreview />}>
                    <CardsAndCategoriesPage initialTab="questions" hideNavigation />
                  </Suspense>
                )}
              </TabsContent>

              {["achievements", "ai"].map((v) => (
                <TabsContent key={v} value={v} className="mt-6">
                  <Card className="gold-frame p-12 text-center text-muted-foreground">
                    תוכן <span className="font-semibold text-foreground">{v}</span> בקרוב
                  </Card>
                </TabsContent>
              ))}

              <TabsContent value="backup" className="mt-3" forceMount>
                {visitedTabs.has("backup") && (
                  <Suspense fallback={<StaticLazyPanelPreview />}>
                    <BackupRestorePage />
                  </Suspense>
                )}
              </TabsContent>
            </Tabs>
            </>
            )}
          </div>
          {/* Tab config sheet — controlled from sidebar footer button */}
          <Sheet open={tabConfigOpen} onOpenChange={setTabConfigOpen} modal={false}>
            <SheetContent side="right" showOverlay={false} className="w-80 p-0 border-l-2 border-gold flex flex-col">
              <div className="p-4 border-b-2 border-gold/30 flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-gold" />
                <h3 className="font-display text-base font-semibold">הגדרת טאבים</h3>
              </div>
              <div className="p-4 overflow-y-auto min-h-0">
                <p className="text-xs text-muted-foreground mb-3 text-right">גרור לשינוי סדר · סמן/בטל כדי להציג/להסתיר</p>
                <Button variant="outline" className="w-full border-gold/60 mb-3" onClick={toggleAllTabs}>
                  {allTabsSelected ? "נקה הכל" : "בחר הכל"}
                </Button>
                <DndContext sensors={tabSensors} collisionDetection={closestCenter} onDragEnd={handleTabDragEnd}>
                  <SortableContext items={configurableTabs.map((t) => t.v)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1">
                      {configurableTabs.map((tab) => (
                        <SortableConfigItem
                          key={tab.v}
                          item={{ id: tab.v, label: tab.l, icon: tab.I }}
                          visible={tab.visible}
                          onToggle={() => handleTabToggle(tab.v)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <div className="mt-4">
                  <Button variant="outline" className="w-full border-gold/60" onClick={resetTabsConfig}>
                    איפוס טאבים לברירת מחדל
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          {/* Sidebar config sheet — separate from home tabs config */}
          <Sheet open={sidebarConfigOpen} onOpenChange={setSidebarConfigOpen} modal={false}>
            <SheetContent side="right" showOverlay={false} className="w-80 p-0 border-l-2 border-gold flex flex-col">
              <div className="p-4 border-b-2 border-gold/30 flex items-center gap-2">
                <Sliders className="h-4 w-4 text-gold" />
                <h3 className="font-display text-base font-semibold">הגדרת סיידבר</h3>
              </div>
              <div className="p-4 overflow-y-auto min-h-0">
                <p className="text-xs text-muted-foreground mb-3 text-right">גרור לשינוי סדר · סמן/בטל כדי להציג/להסתיר · בית תמיד פעיל</p>
                <Button variant="outline" className="w-full border-gold/60 mb-3" onClick={toggleAllSidebar}>
                  {allSidebarSelected ? "נקה הכל" : "בחר הכל"}
                </Button>
                <DndContext sensors={tabSensors} collisionDetection={closestCenter} onDragEnd={handleSidebarDragEnd}>
                  <SortableContext items={configurableSidebarItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1">
                      {configurableSidebarItems.map((item) => (
                        <SortableConfigItem
                          key={item.id}
                          item={{ id: item.id, label: item.label, icon: item.icon }}
                          visible={item.visible}
                          onToggle={() => handleSidebarToggle(item.id)}
                          toggleDisabled={item.id === "home"}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <div className="mt-4">
                  <Button variant="outline" className="w-full border-gold/60" onClick={resetSidebarConfig}>
                    איפוס סיידבר לברירת מחדל
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </main>
      </div>

      {/* First-visit guides hub — reopens every launch until explicitly
          acknowledged via "כבר קראתי"; also reopenable anytime from the "?"
          sidebar button. */}
      <GuidesDialog
        open={guidesOpen}
        onOpenChange={setGuidesOpen}
        onNavigate={(id) => {
          void selectSidebarItem(id);
          setGuidesOpen(false);
        }}
        onMarkRead={() => {
          markGuidesSeen();
          setGuidesOpen(false);
        }}
      />

      {/* Global Smart Search modal — Ctrl+K / Cmd+K */}
      <Dialog open={searchModalOpen} onOpenChange={setSearchModalOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle className="text-right text-base">חיפוש חכם</DialogTitle>
          </DialogHeader>
          <div className="p-4 pt-2">
            <Suspense fallback={<StaticLazyPanelPreview compact />}>
              <SmartSearch
                variant="modal"
                onPick={(hit) => {
                  setSearchModalOpen(false);
                  if (hit.kind === "deck") {
                    if (canViewDecksModule) setActive("decks");
                    return;
                  }
                  if (!canViewCardsModule) return;
                  if (hit.kind === "card") setActive("questions");
                  else if (hit.kind === "category" || hit.kind === "tag") setActive("categories");
                }}
              />
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>
      <Suspense fallback={null}>
        <AiCardCapture />
      </Suspense>
      {promptDialog}
    </div>
  );
};

export default Index;
