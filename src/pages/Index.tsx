import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Home, Gauge, Sun, Calendar, CheckSquare, Target, BookOpen, Timer,
  Activity, ListChecks, Library, Folder, FileText, MessageCircle,
  Trophy, Archive, Settings, Menu, Play, Pause, RotateCcw, Plus, Shield,
  Sparkles, ChevronLeft, Check, X, LogOut, Quote, Sliders, GraduationCap,
  Pin, PinOff, SlidersHorizontal, GripVertical, FolderTree, Search, HardDrive,
  LineChart, DatabaseZap,
} from "lucide-react";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { StudyTab } from "@/components/study/StudyTab";
import { DafLearningTab } from "@/components/study/DafLearningTab";
import { CardsManager } from "@/components/study/CardsManager";
import { CategoriesPage } from "@/components/study/CategoriesPage";
import { SmartSearch } from "@/components/study/SmartSearch";
import { WeeklySummary } from "@/components/study/WeeklySummary";
import { GoalsManager } from "@/components/study/GoalsManager";
import { ShasTracker } from "@/components/study/ShasTracker";
import { StudyPlansCard } from "@/components/study/StudyPlansCard";
import { QuizPlansCard } from "@/components/study/QuizPlansCard";
import { TodayReviewsCard } from "@/components/study/TodayReviewsCard";
import { InsightsCard } from "@/components/study/InsightsCard";
import { BackupRestorePage } from "@/components/study/BackupRestorePage";
import { useAutoBackupRunner } from "@/hooks/useAutoBackupRunner";
import { ReminderSettings } from "@/components/study/ReminderSettings";
import { KnowledgeAnalytics } from "@/components/study/KnowledgeAnalytics";
import { SummaryDashboard } from "@/components/study/SummaryDashboard";
import { WidgetGrid } from "@/components/study/WidgetGrid";
import { TaskCard } from "@/components/study/TaskCard";
import { HeatmapPanel } from "@/components/study/HeatmapPanel";
import { ReviewCalendar } from "@/components/study/ReviewCalendar";
import { AdminPanel } from "@/components/admin/AdminPanel";
import { MishnayotTracker } from "@/components/study/MishnayotTracker";
import { SupabaseInspectorPage } from "@/components/dev/SupabaseInspectorPage";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { usePermissions } from "@/hooks/usePermissions";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { DedicationBanner } from "@/components/DedicationBanner";
import { AiCardCapture } from "@/components/study/AiCardCapture";

type NavItem = { id: string; label: string; icon: typeof Home };
const DEFAULT_SIDEBAR_ITEMS: NavItem[] = [
  { id: "home", label: "בית", icon: Home },
  { id: "blocker", label: "בודק רצפים", icon: Gauge },
  { id: "morning", label: "קימה בבוקר", icon: Sun },
  { id: "today", label: "היום שלי", icon: Calendar },
  { id: "tasks", label: "לוח משימות", icon: CheckSquare },
  { id: "cards", label: "שאלות חזרה", icon: BookOpen },
  { id: "categories", label: "קטגוריות", icon: FolderTree },
  { id: "search", label: "חיפוש חכם", icon: Search },
  { id: "habits", label: "הרגלים", icon: Target },
  { id: "journal", label: "יומן", icon: BookOpen },
  { id: "timer", label: "טיימר", icon: Timer },
  { id: "monitor", label: "בקרת מעקב", icon: Activity },
  { id: "goals", label: "יעדים יומיים", icon: ListChecks },
  { id: "book", label: "הספר שלי", icon: Library },
  { id: "studio", label: "סטודיו מסמכים", icon: Folder },
  { id: "pdf", label: "צפיין PDF", icon: FileText },
  { id: "ai", label: "מאמן AI", icon: MessageCircle },
  { id: "achievements", label: "הישגים", icon: Trophy },
  { id: "archive", label: "ארכיון", icon: Archive },
  { id: "backup-restore", label: "גיבוי ושחזור", icon: HardDrive },
  
  { id: "db-inspector", label: "מסד נתונים", icon: DatabaseZap },
  { id: "admin", label: "ניהול משתמשים", icon: Shield },
  { id: "settings", label: "הגדרות", icon: Settings },
];

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

// ─── Tab config types & defaults ───────────────────────────────────────────
type TabDef = { v: string; l: string; I: typeof Gauge };
type SortableConfigDef = { id: string; label: string; icon: typeof Gauge };
const DEFAULT_TABS: TabDef[] = [
  { v: "overview",      l: "סקירה כללית",  I: Gauge },
  { v: "summary",       l: "סיכום",         I: LineChart },
  { v: "study",         l: "חזרות לימוד",  I: GraduationCap },
  { v: "daf",           l: "לימוד דף",      I: BookOpen },
  { v: "cards",         l: "שאלות חזרה",   I: BookOpen },
  { v: "analytics",     l: "ניתוחים",       I: Activity },
  { v: "achievements",  l: "הישגים",        I: Trophy },
  { v: "ai",            l: "ניתוח AI",      I: Sparkles },
  { v: "goals",         l: "יעדים",         I: Target },
  { v: "backup",        l: "גיבוי וייצוא",   I: Archive },
];

function SortableConfigItem({
  item,
  visible,
  onToggle,
  toggleDisabled = false,
}: {
  item: SortableConfigDef;
  visible: boolean;
  onToggle: () => void;
  toggleDisabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const Icon = item.icon;
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary">
      <span className="text-sm flex-1 text-right">{item.label}</span>
      <Icon className="h-4 w-4 text-navy" />
      <input
        type="checkbox"
        checked={visible}
        onChange={onToggle}
        disabled={toggleDisabled}
        className="h-4 w-4 accent-[hsl(var(--gold))] disabled:opacity-60 disabled:cursor-not-allowed"
      />
      <button {...listeners} {...attributes} className="cursor-grab text-muted-foreground touch-none"><GripVertical className="h-4 w-4" /></button>
    </div>
  );
}

const Index = () => {
  const [active, setActive] = useState("home");
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const { user, signOut, isGuest } = useAuth();
  const displayEmail = isGuest ? "אורח" : user?.email;
  const { isAdmin } = usePermissions();
  const {
    state,
    setTabConfig: saveTabConfig,
    setSidebarConfig: saveSidebarConfig,
    getHydrationSnapshot,
  } = useStudy();
  const { isHydrated } = getHydrationSnapshot();

  // Only show the loading splash after 250ms — fast IDB-cache loads finish before this,
  // so the user never sees a flash of the loading screen on normal navigations.
  const [showLoadingSplash, setShowLoadingSplash] = useState(false);
  useEffect(() => {
    if (isHydrated) { setShowLoadingSplash(false); return; }
    const t = setTimeout(() => setShowLoadingSplash(true), 250);
    return () => clearTimeout(t);
  }, [isHydrated]);

  useAutoBackupRunner();
  const [pinned, setPinned] = useState(true);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [tabConfigOpen, setTabConfigOpen] = useState(false);
  const [sidebarConfigOpen, setSidebarConfigOpen] = useState(false);

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
  const [showTabsConfigIcon, setShowTabsConfigIcon] = useState(false);
  const [showStudiedBadge, setShowStudiedBadge] = useState(
    () => localStorage.getItem("show-studied-badge") !== "false"
  );
  const [activeTab, setActiveTab] = useState<string>(() => localStorage.getItem("active-tab") ?? "overview");
  // Only mount a tab's content the first time the user visits it.
  // On load, only the initially-active tab mounts its heavy widgets.
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([localStorage.getItem("active-tab") ?? "overview"]));
  const tabsHoverTimer = useRef<number | null>(null);
  const tabSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleTabsMouseEnter = useCallback(() => {
    if (tabsHoverTimer.current) window.clearTimeout(tabsHoverTimer.current);
    tabsHoverTimer.current = window.setTimeout(() => setShowTabsConfigIcon(true), 2000);
  }, []);

  const handleTabsMouseLeave = useCallback(() => {
    if (tabsHoverTimer.current) window.clearTimeout(tabsHoverTimer.current);
    tabsHoverTimer.current = null;
    setShowTabsConfigIcon(false);
  }, []);

  // Global Ctrl+K / Cmd+K to open Smart Search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
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

  // Build the ordered tab list (from saved config or defaults)
  const orderedTabs: (TabDef & { visible: boolean })[] = (() => {
    const cfg = state.tabConfig ?? [];
    if (cfg.length === 0) return DEFAULT_TABS.map((t) => ({ ...t, visible: true }));
    const sorted = [...cfg].sort((a, b) => a.order - b.order);
    const result: (TabDef & { visible: boolean })[] = [];
    for (const c of sorted) {
      const def = DEFAULT_TABS.find((t) => t.v === c.id);
      if (def) result.push({ ...def, visible: c.visible });
    }
    // Append any new defaults not yet in config
    for (const def of DEFAULT_TABS) {
      if (!result.find((r) => r.v === def.v)) result.push({ ...def, visible: true });
    }
    return result;
  })();

  const visibleTabs = orderedTabs.filter((t) => t.visible);

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

  const resetTabsConfig = useCallback(() => {
    saveTabConfig(DEFAULT_TABS.map((tab, index) => ({ id: tab.v, visible: true, order: index })));
  }, [saveTabConfig]);

  const orderedSidebarItems: (NavItem & { visible: boolean })[] = useMemo(() => {
    const cfg = state.sidebarConfig ?? [];
    if (cfg.length === 0) return DEFAULT_SIDEBAR_ITEMS.map((item) => ({ ...item, visible: true }));

    const sorted = [...cfg].sort((a, b) => a.order - b.order);
    const used = new Set<string>();
    const result: (NavItem & { visible: boolean })[] = [];

    for (const c of sorted) {
      if (used.has(c.id)) continue;
      const def = DEFAULT_SIDEBAR_ITEMS.find((item) => item.id === c.id);
      if (!def) continue;
      result.push({ ...def, visible: c.visible });
      used.add(c.id);
    }

    for (const def of DEFAULT_SIDEBAR_ITEMS) {
      if (!used.has(def.id)) result.push({ ...def, visible: true });
    }

    return result;
  }, [state.sidebarConfig]);

  const visibleSidebarItems = orderedSidebarItems.filter((item) => item.visible && (item.id !== "admin" || isAdmin));

  useEffect(() => {
    if (visibleSidebarItems.some((item) => item.id === active)) return;
    setActive(visibleSidebarItems[0]?.id ?? "home");
  }, [active, visibleSidebarItems]);

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

  const resetSidebarConfig = useCallback(() => {
    saveSidebarConfig(DEFAULT_SIDEBAR_ITEMS.map((item, index) => ({ id: item.id, visible: true, order: index })));
  }, [saveSidebarConfig]);

  const renderSidebarPage = (pageId: string) => {
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
      case "mishnayot":
        return <MishnayotTracker />;
      case "db-inspector":
        return <SupabaseInspectorPage />;
      default:
        return null;
    }
  };

  const sidebarVisible = pinned || sidebarHovered;

  if (!isHydrated) {
    if (!showLoadingSplash) return null;
    // App-shell skeleton — mimics the real layout (sidebar + header + content area)
    // so users see structure forming, not a blank/text screen (NN/g best practice).
    return (
      <div className="min-h-screen bg-background" dir="rtl">
        <div className="flex">
          {/* Sidebar skeleton */}
          <aside className="hidden lg:flex flex-col bg-sidebar w-64 h-screen sticky top-0 self-start flex-shrink-0">
            <div className="px-4 h-[60px] border-b-2 border-gold/40 flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="flex-1 p-3 space-y-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-3.5 flex-1" />
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-gold/20">
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </aside>

          {/* Main content skeleton */}
          <main className="flex-1 min-h-screen p-4 space-y-4">
            {/* Header bar */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-8 w-48" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
            {/* Tab chips */}
            <div className="flex gap-2 flex-wrap">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-20 rounded-md" />
              ))}
            </div>
            {/* Card grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-gold/20 p-4 space-y-3 bg-secondary/10">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="h-3 w-1/2" />
                  <div className="pt-2 flex items-center gap-2">
                    <Skeleton className="h-6 w-16 rounded-md" />
                    <Skeleton className="h-6 w-12 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
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
            "hidden lg:flex flex-col bg-sidebar",
            pinned
              ? "w-64 h-screen sticky top-0 self-start flex-shrink-0"
              : "fixed right-0 top-0 h-screen w-64 z-40 shadow-2xl transition-transform duration-300",
            !pinned && !sidebarVisible && "translate-x-full",
          )}
          onMouseLeave={() => !pinned && setSidebarHovered(false)}
        >
          <div className="px-4 h-[60px] border-b-2 border-gold/40 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSidebarConfigOpen(true)}
                title="הגדרת סיידבר"
                className="flex items-center justify-center h-8 w-8 rounded-full hover:bg-secondary text-gold hover:text-navy transition-colors"
              >
                <Sliders className="h-4 w-4" />
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
            <SidebarContent items={visibleSidebarItems} active={active} onSelect={(id) => { setActive(id); if (!pinned) setSidebarHovered(false); }} badges={sidebarBadges} />
          </div>
          {/* Sidebar footer: compact icon row */}
          <div className="border-t-2 border-gold/40 p-3 space-y-2 flex-shrink-0">
            {/* User profile button */}
            <button
              onClick={() => setActive("settings")}
              className="w-full flex items-center gap-2 rounded-xl border-2 border-gold/40 bg-card px-3 py-2 hover:bg-secondary transition-colors text-right"
              title="הגדרות משתמש"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-navy text-primary-foreground text-sm font-bold">
                {isGuest ? "א" : (user?.email?.[0] ?? "?").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{isGuest ? "אורח" : (user?.email ?? "")}</div>
                <div className={cn("text-[10px] font-semibold", isAdmin ? "text-yellow-500" : "text-muted-foreground")}>
                  {isAdmin ? "👑 מנהל" : "משתמש"}
                </div>
              </div>
              <Settings className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            </button>
            <div className="flex items-center justify-between gap-1">
              <button
                onClick={() => signOut()}
                title={isGuest ? "יציאה" : "התנתקות"}
                className="flex items-center justify-center h-9 w-9 rounded-full border-2 border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
              <button
                onClick={() => setSidebarConfigOpen(true)}
                title="הגדרת סיידבר"
                className="flex items-center justify-center h-9 w-9 rounded-full border-2 border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
              >
                <Sliders className="h-4 w-4" />
              </button>
              <button
                onClick={() => setTabConfigOpen(true)}
                title="הגדרת טאבים"
                className="flex items-center justify-center h-9 w-9 rounded-full border-2 border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
              <ThemeSwitcher />
            </div>
          </div>
        </aside>

        {/* Main — when not pinned, add margin-right that animates with sidebar */}
        <main
          className="flex-1 min-w-0 transition-[margin] duration-300"
          style={!pinned ? { marginRight: sidebarVisible ? '16rem' : '0' } : undefined}
        >
          {/* Topbar */}
          <header className="flex items-center justify-end gap-2 border-b-2 border-gold/40 bg-background px-2 h-[56px] sm:px-4 sm:gap-3 sm:h-[60px] lg:px-8" style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(56px + env(safe-area-inset-top))' }}>
            <div className="flex-1 min-w-0 px-1 sm:px-4">
              <DedicationBanner />
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden sm:block"><Logo size="sm" /></div>
              <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" className="lg:hidden rounded-full border-2 border-gold h-10 w-10 shrink-0" onClick={() => setMobileSidebarOpen(true)}>
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-72 p-0 border-l-2 border-gold flex flex-col">
                  <div className="p-4 border-b-2 border-gold/30 flex-shrink-0"><Logo /></div>
                  <div className="flex-1 overflow-y-auto no-scrollbar">
                    <SidebarContent items={visibleSidebarItems} active={active} onSelect={(id) => { setActive(id); setMobileSidebarOpen(false); }} badges={sidebarBadges} />
                  </div>
                  <div className="border-t-2 border-gold/40 p-3 space-y-2 flex-shrink-0">
                    {/* User profile button */}
                    <button
                      onClick={() => { setActive("settings"); setMobileSidebarOpen(false); }}
                      className="w-full flex items-center gap-2 rounded-xl border-2 border-gold/40 bg-card px-3 py-2 hover:bg-secondary transition-colors text-right"
                      title="הגדרות משתמש"
                    >
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-navy text-primary-foreground text-sm font-bold">
                        {isGuest ? "א" : (user?.email?.[0] ?? "?").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">{isGuest ? "אורח" : (user?.email ?? "")}</div>
                        <div className={cn("text-[10px] font-semibold", isAdmin ? "text-yellow-500" : "text-muted-foreground")}>
                          {isAdmin ? "👑 מנהל" : "משתמש"}
                        </div>
                      </div>
                      <Settings className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    </button>
                    <div className="flex items-center justify-between gap-1">
                      <button
                        onClick={() => signOut()}
                        title={isGuest ? "יציאה" : "התנתקות"}
                        className="flex items-center justify-center h-9 w-9 rounded-full border-2 border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
                      >
                        <LogOut className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setSidebarConfigOpen(true)}
                        title="הגדרת סיידבר"
                        className="flex items-center justify-center h-9 w-9 rounded-full border-2 border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
                      >
                        <Sliders className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setTabConfigOpen(true)}
                        title="הגדרת טאבים"
                        className="flex items-center justify-center h-9 w-9 rounded-full border-2 border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                      </button>
                      <ThemeSwitcher />
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </header>

          {/* Content */}
          <div className="p-3 sm:p-4 lg:p-8 space-y-4 sm:space-y-6 max-w-6xl mx-auto">
            {active === "settings" ? (
              <SettingsPanel />
            ) : active === "cards" ? (
              <div className="space-y-6">
                <div className="text-center space-y-1 animate-fade-in">
                  <h1 className="font-display text-2xl font-bold text-gold">שאלות חזרה</h1>
                  <p className="text-muted-foreground text-sm">ניהול מערכות, שאלות וקטגוריות</p>
                </div>
                <CardsManager />
              </div>
            ) : active === "categories" ? (
              <CategoriesPage />
            ) : active === "search" ? (
              <div className="space-y-6">
                <div className="text-center space-y-1 animate-fade-in">
                  <h1 className="font-display text-2xl font-bold text-gold">חיפוש חכם</h1>
                  <p className="text-muted-foreground text-sm">חפש שאלות, תשובות, תגיות, קטגוריות ומערכות · קיצור: Ctrl+K</p>
                </div>
                <SmartSearch variant="page" />
              </div>
            ) : active === "admin" ? (
              <AdminPanel />
            ) : active !== "home" ? (
              renderSidebarPage(active)
            ) : (
            <>
            <div className="text-center space-y-2 animate-fade-in">
              <p className="font-display text-3xl sm:text-5xl lg:text-7xl font-bold text-gold leading-tight">למען תהיה תורת ה' בפיך</p>
              <h1 className="font-display text-xl sm:text-2xl lg:text-3xl font-semibold text-foreground">מערכת לימוד וחזרות</h1>
              <p className="text-muted-foreground text-sm sm:text-base">עקוב אחר ההתקדמות שלך וקבל תובנות מתקדמות</p>
            </div>

            <Tabs
              value={activeTab}
              onValueChange={(v) => { setActiveTab(v); setVisitedTabs((s) => { s.has(v) || (s = new Set(s)); s.add(v); return s; }); try { localStorage.setItem("active-tab", v); } catch { /* ignore */ } }}
              className="w-full" dir="rtl"
            >
              <Card className="gold-frame p-1.5 sm:p-2" onMouseEnter={handleTabsMouseEnter} onMouseLeave={handleTabsMouseLeave}>
                <div className="flex items-center gap-2">
                  <TabsList className="flex-1 bg-transparent justify-start gap-1.5 sm:gap-2 h-auto flex-wrap" dir="rtl">
                    {visibleTabs.map(({ v, l, I }) => (
                      <TabsTrigger
                        key={v} value={v}
                        className="flex-1 min-w-[88px] sm:min-w-[110px] justify-center gap-1.5 sm:gap-2 rounded-xl px-2 sm:px-3 py-2 text-xs sm:text-sm data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground data-[state=active]:shadow-elegant"
                      >
                        <span className="relative">
                          {l}
                          {v === "study" && showStudiedBadge && studiedToday && (
                            <span className="absolute -top-1 -right-1.5 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-background" />
                          )}
                        </span>
                        <I className="h-4 w-4" />
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <button
                    onClick={() => setTabConfigOpen(true)}
                    title="הגדרת טאבים"
                    className={cn(
                      "flex items-center justify-center h-9 w-9 shrink-0 rounded-xl border-2 border-gold/70 bg-card text-navy hover:bg-secondary transition-all",
                      showTabsConfigIcon ? "opacity-100" : "opacity-0 pointer-events-none",
                    )}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </button>
                </div>
              </Card>

              <TabsContent value="overview" className="mt-6">
                {visitedTabs.has("overview") && <WidgetGrid
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
                />}
              </TabsContent>

              <TabsContent value="summary" className="mt-6">
                {visitedTabs.has("summary") && <SummaryDashboard />}
              </TabsContent>

              <TabsContent value="study" className="mt-6">
                {visitedTabs.has("study") && <StudyTab showBadge={showStudiedBadge} onToggleBadge={toggleStudiedBadge} />}
              </TabsContent>

              <TabsContent value="daf" className="mt-6">
                {visitedTabs.has("daf") && <DafLearningTab />}
              </TabsContent>

              <TabsContent value="cards" className="mt-6">
                {visitedTabs.has("cards") && <CardsManager />}
              </TabsContent>

              <TabsContent value="goals" className="mt-6">
                {visitedTabs.has("goals") && <WidgetGrid
                  tabId="goals"
                  widgetMap={{
                    "study-plans":       <StudyPlansCard />,
                    "quiz-plans":        <QuizPlansCard />,
                    "today-reviews":     <TodayReviewsCard />,
                    "insights":          <InsightsCard />,
                    "goals-manager":     <GoalsManager />,
                    "reminder-settings": <ReminderSettings />,
                  }}
                />}
              </TabsContent>

              <TabsContent value="analytics" className="mt-6">
                {visitedTabs.has("analytics") && <KnowledgeAnalytics />}
              </TabsContent>

              {["achievements", "ai"].map((v) => (
                <TabsContent key={v} value={v} className="mt-6">
                  <Card className="gold-frame p-12 text-center text-muted-foreground">
                    תוכן <span className="font-semibold text-foreground">{v}</span> בקרוב
                  </Card>
                </TabsContent>
              ))}

              <TabsContent value="backup" className="mt-6">
                {visitedTabs.has("backup") && <BackupRestorePage />}
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
                <DndContext sensors={tabSensors} collisionDetection={closestCenter} onDragEnd={handleTabDragEnd}>
                  <SortableContext items={orderedTabs.map((t) => t.v)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1">
                      {orderedTabs.map((tab) => (
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
                <DndContext sensors={tabSensors} collisionDetection={closestCenter} onDragEnd={handleSidebarDragEnd}>
                  <SortableContext items={orderedSidebarItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1">
                      {orderedSidebarItems.map((item) => (
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

      {/* Global Smart Search modal — Ctrl+K / Cmd+K */}
      <Dialog open={searchModalOpen} onOpenChange={setSearchModalOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle className="text-right text-base">חיפוש חכם</DialogTitle>
          </DialogHeader>
          <div className="p-4 pt-2">
            <SmartSearch
              variant="modal"
              onPick={(hit) => {
                setSearchModalOpen(false);
                if (hit.kind === "card" || hit.kind === "deck") setActive("cards");
                else if (hit.kind === "category" || hit.kind === "tag") setActive("categories");
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
      <AiCardCapture />
    </div>
  );
};

export default Index;
