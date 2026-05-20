import { useState, useMemo, useEffect } from "react";
import {
  Home, Gauge, Sun, Calendar, CheckSquare, Target, BookOpen, Timer,
  Activity, ListChecks, Library, Folder, FileText, MessageCircle,
  Trophy, Archive, Settings, Sparkles, FolderTree, Search, HardDrive,
  DatabaseZap, Shield, LayoutGrid, ChevronDown, ChevronUp, ChevronsUpDown,
  CheckCircle2, AlertCircle, XCircle, BarChart2, Tag, Hash,
  Download, Globe, Printer, Clipboard, ExternalLink, X as XIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { DEFAULT_SIDEBAR_ITEMS } from "@/config/sidebarItems";
import { useNavigate } from "react-router-dom";

// ──────────────────────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────────────────────
type FeatureStatus = "working" | "partial" | "placeholder";
type ThemeCategory = "learning" | "daily" | "tools" | "management";

interface Feature {
  name: string;
  status: FeatureStatus;
  /** קצר — מוצג בשורה */
  description?: string;
  /** ארוך — מוצג בטולטיפ */
  tooltip?: string;
}

/** Feature enriched with a global sequential number (assigned at runtime) */
interface NumberedFeature extends Feature {
  globalIndex: number;
}

interface TabRubric {
  id: string;
  label: string;
  icon: LucideIcon;
  themeCategory: ThemeCategory;
  overallStatus: FeatureStatus;
  description: string;
  features: Feature[];
}

// ──────────────────────────────────────────────────────────────
//  Data — complete rubric for every sidebar tab
// ──────────────────────────────────────────────────────────────
const TABS_RUBRIC: TabRubric[] = [
  {
    id: "home",
    label: "בית",
    icon: Home,
    themeCategory: "learning",
    overallStatus: "partial",
    description: "דף ראשי עם 10 תת-טאבים — סקירה, לימוד, חזרות, ניתוח, יעדים",
    features: [
      { name: "סקירה כללית", status: "working", description: "WidgetGrid עם WeeklySummary, StudyPlans, TodayReviews, Insights, DailyTrackers, Pomodoro, Heatmap, ReviewCalendar" },
      { name: "סיכום", status: "working", description: "SummaryDashboard — נתוני למידה מצטברים" },
      { name: "חזרות לימוד", status: "working", description: "StudyTab — מנוע חזרות SRS מלא" },
      { name: "לימוד דף", status: "working", description: "DafLearningTab — לימוד גמרא דף-יומי" },
      { name: "שאלות חזרה", status: "working", description: "CardsManager — ניהול כרטיסיות שאלות" },
      { name: "ניתוחים", status: "working", description: "KnowledgeAnalytics — גרפים ומדדי ביצועים" },
      { name: "הישגים", status: "placeholder", description: "Coming soon — תגים ומדדי עקביות" },
      { name: "ניתוח AI", status: "placeholder", description: "Coming soon — המלצות מבוססות מכונה" },
      { name: "יעדים", status: "working", description: "StudyPlans, GoalsManager, ReminderSettings" },
      { name: "גיבוי וייצוא", status: "working", description: "BackupRestorePage — גיבוי ידני/ענן" },
    ],
  },
  {
    id: "blocker",
    label: "בודק רצפים",
    icon: Gauge,
    themeCategory: "daily",
    overallStatus: "partial",
    description: "מדדי רצף, ניתוח נקודות שבירה ופעולות שיפור",
    features: [
      { name: "סיכום שבועי", status: "working", description: "WeeklySummary — ימי למידה לאורך השבוע" },
      { name: "תובנות רצף", status: "placeholder", description: "ניתוח ימים חזקים/חלשים — טרם הושלם" },
      { name: "פעולות מומלצות", status: "placeholder", description: "צעדים יומיים לשימור הרצף — טרם הושלם" },
    ],
  },
  {
    id: "morning",
    label: "קימה בבוקר",
    icon: Sun,
    themeCategory: "daily",
    overallStatus: "partial",
    description: "שגרת בוקר, בקרה ומעקב רציף",
    features: [
      { name: "שגרת בוקר", status: "working", description: "DailyTrackers — מסמן הרגלי בוקר" },
      { name: "מדדי אנרגיה", status: "placeholder", description: "מדדי פתיחה יומיים — טרם הושלם" },
    ],
  },
  {
    id: "today",
    label: "היום שלי",
    icon: Calendar,
    themeCategory: "daily",
    overallStatus: "partial",
    description: "פוקוס יומי, לוח זמנים והערות מהירות",
    features: [
      { name: "מאמן יומי AI", status: "working", description: "AICoachCard — הכוונה יומית מבוססת AI" },
      { name: "לוח זמנים יומי", status: "placeholder", description: "תכנון בלוקי זמן — טרם הושלם" },
      { name: "הערות היום", status: "placeholder", description: "רשומות קצרות ותובנות — טרם הושלם" },
    ],
  },
  {
    id: "tasks",
    label: "לוח משימות",
    icon: CheckSquare,
    themeCategory: "daily",
    overallStatus: "placeholder",
    description: "ניהול משימות חכם עם סדרי עדיפויות",
    features: [
      { name: "לוח קנבן", status: "placeholder", description: "לוח משימות אישי עם מצבי עבודה — טרם הושלם" },
      { name: "עדיפויות", status: "placeholder", description: "משימות קריטיות עם דירוג דחיפות — טרם הושלם" },
      { name: "תיבת משימות", status: "placeholder", description: "ריכוז משימות חדשות לפני סיווג — טרם הושלם" },
      { name: "TaskCard (סקירה)", status: "working", description: "TaskCard מוטמע בלוח הסקירה הכללית" },
    ],
  },
  {
    id: "cards",
    label: "קטגוריות ושאלות",
    icon: FolderTree,
    themeCategory: "learning",
    overallStatus: "working",
    description: "מנהל קטגוריות, עורך כרטיסיות וכלי ייבוא",
    features: [
      { name: "עץ קטגוריות", status: "working", description: "CategoryTreeView — עץ היררכי מלא" },
      { name: "עורך כרטיסיות", status: "working", description: "CardEditor — יצירה ועריכת שאלות/תשובות" },
      { name: "יבוא מרובה", status: "working", description: "BulkImporter — ייבוא עשרות כרטיסיות בבת-אחת" },
      { name: "תבניות קטגוריות", status: "working", description: "CategoryTemplatesDialog — תבניות מוגדרות מראש" },
      { name: "קלט AI", status: "working", description: "AiCardCapture — יצירת כרטיסיות באמצעות AI" },
      { name: "דפדפן קטגוריות", status: "working", description: "CategoryBrowseView — סריקה וסינון קטגוריות" },
      { name: "היסטוריית כרטיסייה", status: "working", description: "CardHistoryDialog — לוג שינויים לכל כרטיסייה" },
    ],
  },
  {
    id: "search",
    label: "חיפוש חכם",
    icon: Search,
    themeCategory: "tools",
    overallStatus: "working",
    description: "חיפוש full-text בשאלות, קטגוריות ומערכות",
    features: [
      { name: "חיפוש שאלות", status: "working", description: "SmartSearch — חיפוש מיידי בכל הכרטיסיות" },
      { name: "חיפוש קטגוריות", status: "working", description: "סינון לפי קטגוריה, תגית, מערכת" },
      { name: "קיצור Ctrl+K", status: "working", description: "פותח SmartSearch מכל מקום באפליקציה" },
    ],
  },
  {
    id: "habits",
    label: "הרגלים",
    icon: Target,
    themeCategory: "daily",
    overallStatus: "partial",
    description: "מעקב ביצוע והרגלי מפתח",
    features: [
      { name: "מעקב יומי", status: "working", description: "DailyTrackers — סימון הרגלים יומיים" },
      { name: "רצפי הרגלים", status: "placeholder", description: "מעקב רצף יומי/שבועי — טרם הושלם" },
    ],
  },
  {
    id: "journal",
    label: "יומן",
    icon: BookOpen,
    themeCategory: "daily",
    overallStatus: "placeholder",
    description: "כתיבה יומית ותיעוד תובנות",
    features: [
      { name: "רשומה חדשה", status: "placeholder", description: "כתיבה חופשית של מהלך היום — טרם הושלם" },
      { name: "היסטוריית רשומות", status: "placeholder", description: "ניווט ברשומות קודמות — טרם הושלם" },
    ],
  },
  {
    id: "timer",
    label: "טיימר",
    icon: Timer,
    themeCategory: "daily",
    overallStatus: "partial",
    description: "זמני פוקוס פומודורו, הפסקות ומדדי קצב",
    features: [
      { name: "שעון פומודורו", status: "working", description: "PomodoroCard — 25 דקות פוקוס, slider עוצמת בליטה" },
      { name: "סיכום סשנים", status: "placeholder", description: "סטטיסטיקת סשנים וזמן מצטבר — טרם הושלם" },
    ],
  },
  {
    id: "monitor",
    label: "בקרת מעקב",
    icon: Activity,
    themeCategory: "learning",
    overallStatus: "partial",
    description: "תמונת מצב כוללת של למידה וביצועים",
    features: [
      { name: "סיכום שבועי", status: "working", description: "WeeklySummary — ימי למידה ומגמות" },
      { name: "ניתוחי ידע", status: "working", description: "KnowledgeAnalytics — גרפי ביצועים" },
      { name: "התראות חריגות", status: "placeholder", description: "איתור חריגות ודגשים לפעולה — טרם הושלם" },
    ],
  },
  {
    id: "goals",
    label: "יעדים יומיים",
    icon: ListChecks,
    themeCategory: "learning",
    overallStatus: "working",
    description: "יעדים, תזכורות והתקדמות מול יעדי שס\"ת",
    features: [
      { name: "מנהל יעדים", status: "working", description: "GoalsManager — יצירה ומעקב יעדי לימוד" },
      { name: "הגדרת תזכורות", status: "working", description: "ReminderSettings — תזכורות Push/Email" },
      { name: "מעקב שס\"ת", status: "working", description: "ShasTracker — התקדמות בשישה סדרי משנה" },
    ],
  },
  {
    id: "book",
    label: "הספר שלי",
    icon: Library,
    themeCategory: "learning",
    overallStatus: "working",
    description: "מעקב לימוד אישי, תכניות ספציפיות וחזרות יומיות",
    features: [
      { name: "מעקב שס\"ת", status: "working", description: "ShasTracker — התקדמות בשס\"ת ובגמרא" },
      { name: "תכניות לימוד", status: "working", description: "StudyPlansCard — יצירת תכניות לימוד מותאמות" },
      { name: "חזרות היום", status: "working", description: "TodayReviewsCard — כרטיסיות שצריך לחזור היום" },
    ],
  },
  {
    id: "studio",
    label: "סטודיו מסמכים",
    icon: Folder,
    themeCategory: "tools",
    overallStatus: "placeholder",
    description: "ניהול מסמכים, טיוטות וגרסאות",
    features: [
      { name: "ניהול קבצים", status: "placeholder", description: "רשימת קבצים וארגון תיקיות — טרם הושלם" },
      { name: "פעילות אחרונה", status: "placeholder", description: "שינויים ועדכונים אחרונים — טרם הושלם" },
    ],
  },
  {
    id: "pdf",
    label: "צפיין PDF",
    icon: FileText,
    themeCategory: "tools",
    overallStatus: "placeholder",
    description: "קריאת מסמכי PDF, סימון והערות",
    features: [
      { name: "תצוגת מסמך", status: "placeholder", description: "ריינדור PDF — טרם הושלם" },
      { name: "הערות וסימונים", status: "placeholder", description: "סיכומים לפי עמוד — טרם הושלם" },
    ],
  },
  {
    id: "ai",
    label: "מאמן AI",
    icon: MessageCircle,
    themeCategory: "tools",
    overallStatus: "partial",
    description: "הכוונה יומית חכמה וכלי עזר מבוססי AI",
    features: [
      { name: "מאמן יומי", status: "working", description: "AICoachCard — הודעת בוקר מוטיבציונלית" },
      { name: "כלי AI נוספים", status: "placeholder", description: "סיכום, ניסוח, שאלות מונחות — טרם הושלם" },
    ],
  },
  {
    id: "achievements",
    label: "הישגים",
    icon: Trophy,
    themeCategory: "tools",
    overallStatus: "placeholder",
    description: "תגים, נקודות, רצפים ולוח תהילה",
    features: [
      { name: "רצף הישגים", status: "placeholder", description: "מדידת עקביות בלמידה — טרם הושלם" },
      { name: "תגי אבני דרך", status: "placeholder", description: "איסוף תגים לפי אירועים — טרם הושלם" },
    ],
  },
  {
    id: "archive",
    label: "ארכיון",
    icon: Archive,
    themeCategory: "tools",
    overallStatus: "placeholder",
    description: "חיפוש והחזרת תכנים היסטוריים",
    features: [
      { name: "חיפוש בארכיון", status: "placeholder", description: "איתור לפי תגיות/תאריך — טרם הושלם" },
      { name: "פריטים אחרונים", status: "placeholder", description: "פריטים שנשמרו לאחרונה — טרם הושלם" },
    ],
  },
  {
    id: "backup-restore",
    label: "גיבוי ושחזור",
    icon: HardDrive,
    themeCategory: "management",
    overallStatus: "working",
    description: "גיבוי ידני, שחזור, ייצוא נושאים והעלאה לענן",
    features: [
      { name: "גיבוי ידני", status: "working", description: "הורדת snapshot מלא של כל הנתונים" },
      { name: "שחזור גיבוי", status: "working", description: "טעינת קובץ גיבוי ושחזור מצב קודם" },
      { name: "ייצוא נושאים", status: "working", description: "TopicBackupWizard — ייצוא קטגוריות ספציפיות" },
      { name: "העלאה לענן", status: "working", description: "גיבוי אוטומטי ל-Supabase Storage" },
    ],
  },
  {
    id: "db-inspector",
    label: "מסד נתונים",
    icon: DatabaseZap,
    themeCategory: "management",
    overallStatus: "working",
    description: "ניהול ובדיקת מסד הנתונים ישירות מהאפליקציה",
    features: [
      { name: "עורך SQL", status: "working", description: "הרצת שאילתות SQL דרך exec_sql RPC" },
      { name: "בדיקת מיגרציות", status: "working", description: "רשימת מיגרציות שהורצו ובדיקת סטטוס" },
      { name: "תצוגת טבלאות", status: "working", description: "SupabaseInspectorPage — מבנה הסכמה" },
    ],
  },
  {
    id: "admin",
    label: "ניהול משתמשים",
    icon: Shield,
    themeCategory: "management",
    overallStatus: "working",
    description: "לוח בקרה למנהל — משתמשים, הרשאות, סטטיסטיקות",
    features: [
      { name: "רשימת משתמשים", status: "working", description: "AdminPanel — כל המשתמשים הרשומים" },
      { name: "ניהול הרשאות", status: "working", description: "קידום/הורדת הרשאות למנהל" },
      { name: "נגישות מנהל בלבד", status: "working", description: "הטאב מוסתר ממשתמשים רגילים" },
    ],
  },
  {
    id: "settings",
    label: "הגדרות",
    icon: Settings,
    themeCategory: "management",
    overallStatus: "working",
    description: "הגדרות אלגוריתם SRS, ממשק, תזכורות ונגישות",
    features: [
      { name: "אלגוריתם SRS", status: "working", description: "SrsAlgorithmSettings — כוונון מרווחי חזרות" },
      { name: "הגדרות תזכורות", status: "working", description: "ReminderSettings — שעות וערוצי התראה" },
      { name: "ערכת נושא", status: "working", description: "ThemeSwitcher — מצב כהה/בהיר" },
      { name: "ניהול סיידבר", status: "working", description: "גרור לסידור מחדש, הסתרה/הצגה של טאבים" },
      { name: "ניהול טאבים (בית)", status: "working", description: "הגדרת סדר וחשיפת תת-טאבי דף הבית" },
    ],
  },
];

// ──────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────
const THEME_CATEGORIES: { id: ThemeCategory; label: string; color: string }[] = [
  { id: "learning", label: "לימוד", color: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400/40" },
  { id: "daily", label: "יומי", color: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/40" },
  { id: "tools", label: "כלים", color: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-400/40" },
  { id: "management", label: "ניהול", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/40" },
];

function statusConfig(status: FeatureStatus) {
  switch (status) {
    case "working":
      return { icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-400/40", label: "פועל" };
    case "partial":
      return { icon: AlertCircle, color: "text-amber-500", bg: "bg-amber-500/10 border-amber-400/40", label: "חלקי" };
    case "placeholder":
      return { icon: XCircle, color: "text-rose-500", bg: "bg-rose-500/10 border-rose-400/40", label: "Placeholder" };
  }
}

function overallStats(tabs: TabRubric[]) {
  const allFeatures = tabs.flatMap((t) => t.features);
  const working = allFeatures.filter((f) => f.status === "working").length;
  const partial = allFeatures.filter((f) => f.status === "partial").length;
  const placeholder = allFeatures.filter((f) => f.status === "placeholder").length;
  const total = allFeatures.length;
  const pct = total > 0 ? Math.round(((working + partial * 0.5) / total) * 100) : 0;
  return { total, working, partial, placeholder, pct };
}

// ──────────────────────────────────────────────────────────────
//  Export helpers
// ──────────────────────────────────────────────────────────────
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function statusLabel(s: FeatureStatus) {
  return s === "working" ? "פועל" : s === "partial" ? "חלקי" : "Placeholder";
}
function doExportJSON(tabs: TabRubric[]) {
  const data = tabs.map((t) => ({
    id: t.id, label: t.label, overallStatus: t.overallStatus,
    themeCategory: t.themeCategory, description: t.description,
    features: t.features.map((f) => ({ name: f.name, status: f.status, description: f.description ?? "" })),
  }));
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "system-rubric.json");
}
function doExportCSV(tabs: TabRubric[]) {
  const BOM = "\uFEFF";
  const rows: string[][] = [["#", "טאב", "קטגוריה", "סטטוס טאב", "פיצ'ר", "סטטוס פיצ'ר", "תיאור"]];
  let n = 1;
  for (const t of tabs) {
    if (t.features.length === 0)
      rows.push([String(n++), t.label, t.themeCategory, statusLabel(t.overallStatus), "—", "—", t.description]);
    else
      for (const f of t.features)
        rows.push([String(n++), t.label, t.themeCategory, statusLabel(t.overallStatus), f.name, statusLabel(f.status), f.description ?? ""]);
  }
  const csv = BOM + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "system-rubric.csv");
}
function doExportXLS(tabs: TabRubric[]) {
  const rows = tabs.flatMap((t) =>
    t.features.length === 0
      ? [`<tr><td>${t.label}</td><td>\u2014</td><td>${statusLabel(t.overallStatus)}</td><td>${t.description}</td></tr>`]
      : t.features.map((f) => `<tr><td>${t.label}</td><td>${f.name}</td><td>${statusLabel(f.status)}</td><td>${f.description ?? ""}</td></tr>`)
  );
  const xls = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>\u05de\u05e4\u05ea \u05de\u05e2\u05e8\u05db\u05ea</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml></head><body><table dir="rtl"><tr><th>\u05d8\u05d0\u05d1</th><th>\u05e4\u05d9\u05e6'\u05e8</th><th>\u05e1\u05d8\u05d8\u05d5\u05e1</th><th>\u05ea\u05d9\u05d0\u05d5\u05e8</th></tr>${rows.join("")}</table></body></html>`;
  downloadBlob(new Blob(["\uFEFF" + xls], { type: "application/vnd.ms-excel;charset=utf-8;" }), "system-rubric.xls");
}
function doExportHTML(tabs: TabRubric[]) {
  const clr = (s: FeatureStatus) => s === "working" ? "#22c55e" : s === "partial" ? "#f59e0b" : "#ef4444";
  const rows = tabs.flatMap((t) =>
    t.features.length === 0
      ? [`<tr><td>${t.label}</td><td>\u2014</td><td style="color:${clr(t.overallStatus)}">${statusLabel(t.overallStatus)}</td><td>${t.description}</td></tr>`]
      : t.features.map((f) => `<tr><td>${t.label}</td><td>${f.name}</td><td style="color:${clr(f.status)}">${statusLabel(f.status)}</td><td>${f.description ?? ""}</td></tr>`)
  );
  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"><title>\u05de\u05e4\u05ea \u05de\u05e2\u05e8\u05db\u05ea</title><style>body{font-family:Arial,sans-serif;direction:rtl;text-align:right;padding:20px;background:#fafaf8}h1{color:#d4a839}table{border-collapse:collapse;width:100%;margin-top:16px}th{background:#1a2540;color:#d4a839;padding:10px}td{border:1px solid #ddd;padding:8px}tr:nth-child(even){background:#f5f5f2}</style></head><body><h1>\u05de\u05e4\u05ea \u05de\u05e2\u05e8\u05db\u05ea</h1><p>${new Date().toLocaleDateString("he-IL")}</p><table><thead><tr><th>\u05d8\u05d0\u05d1</th><th>\u05e4\u05d9\u05e6'\u05e8</th><th>\u05e1\u05d8\u05d8\u05d5\u05e1</th><th>\u05ea\u05d9\u05d0\u05d5\u05e8</th></tr></thead><tbody>${rows.join("")}</tbody></table></body></html>`;
  downloadBlob(new Blob([html], { type: "text/html;charset=utf-8;" }), "system-rubric.html");
}
function doExportMarkdown(tabs: TabRubric[]) {
  const lines = ["# \u05de\u05e4\u05ea \u05de\u05e2\u05e8\u05db\u05ea\n", `> ${new Date().toLocaleDateString("he-IL")}\n`, "| # | \u05d8\u05d0\u05d1 | \u05e4\u05d9\u05e6'\u05e8 | \u05e1\u05d8\u05d8\u05d5\u05e1 | \u05ea\u05d9\u05d0\u05d5\u05e8 |", "| --- | --- | --- | --- | --- |"];
  let n = 1;
  for (const t of tabs) {
    if (t.features.length === 0)
      lines.push(`| ${n++} | **${t.label}** | \u2014 | ${statusLabel(t.overallStatus)} | ${t.description} |`);
    else
      for (const f of t.features)
        lines.push(`| ${n++} | **${t.label}** | ${f.name} | ${statusLabel(f.status)} | ${f.description ?? ""} |`);
  }
  downloadBlob(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8;" }), "system-rubric.md");
}
function doExportClipboard(tabs: TabRubric[]) {
  const text = tabs.map((t) => {
    const fl = t.features.map((f) => `  \u2022 ${f.name} [${statusLabel(f.status)}]`).join("\n");
    return `${t.label}:\n${fl || "  (\u05dc\u05dc\u05d0 \u05e4\u05d9\u05e6'\u05e8\u05d9\u05dd)"}`;
  }).join("\n\n");
  navigator.clipboard.writeText(text).catch(() => {});
}

// ──────────────────────────────────────────────────────────────
//  Sub-components
// ──────────────────────────────────────────────────────────────
const FeatureRow = ({ feature, globalIndex, search = "" }: { feature: Feature; globalIndex: number; search?: string }) => {
  const cfg = statusConfig(feature.status);
  const StatusIcon = cfg.icon;
  const tooltipBody = feature.tooltip ?? feature.description ?? "";
  const isMatch = search.trim() !== "" && feature.name.toLowerCase().includes(search.toLowerCase());

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "flex items-start gap-2 py-1.5 px-2 rounded-lg hover:bg-secondary/50 transition-colors cursor-default group",
          isMatch && "bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-950/30"
        )}>
          {/* Status icon */}
          <StatusIcon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", cfg.color)} />

          {/* Name */}
          <div className="flex-1 min-w-0 text-right">
            <span className="text-sm font-medium text-foreground">{feature.name}</span>
            {feature.description && (
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{feature.description}</p>
            )}
          </div>

          {/* Global number badge */}
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-secondary border border-gold/30 text-[10px] font-bold text-muted-foreground flex-shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
            <Hash className="h-2.5 w-2.5" />
            {globalIndex}
          </span>
        </div>
      </TooltipTrigger>

      <TooltipContent
        side="right"
        align="start"
        className="max-w-[260px] space-y-1.5 text-right p-3"
        dir="rtl"
      >
        {/* Header: number + name */}
        <div className="flex items-center gap-2 justify-between">
          <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border", cfg.bg, cfg.color)}>
            <StatusIcon className="h-3 w-3" />
            {cfg.label}
          </span>
          <div className="flex items-center gap-1">
            <p className="text-sm font-semibold text-foreground leading-tight">{feature.name}</p>
            <span className="text-[10px] font-bold text-gold">#{globalIndex}</span>
          </div>
        </div>

        {/* Description body */}
        {tooltipBody && (
          <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-1.5">
            {tooltipBody}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

interface TabCardProps {
  tab: TabRubric;
  isOpen: boolean;
  onToggle: () => void;
  /** 1-based global index of the first feature in this tab */
  startIndex: number;
  onNavigate: () => void;
  search?: string;
}

const TabCard = ({ tab, isOpen, onToggle, startIndex, onNavigate, search = "" }: TabCardProps) => {
  const Icon = tab.icon;
  const cfg = statusConfig(tab.overallStatus);
  const StatusIcon = cfg.icon;
  const working = tab.features.filter((f) => f.status === "working").length;
  const total = tab.features.length;
  const pct = total > 0 ? Math.round((working / total) * 100) : 0;
  const themeInfo = THEME_CATEGORIES.find((c) => c.id === tab.themeCategory);

  return (
    <Card className={cn("gold-frame overflow-hidden transition-shadow", isOpen && "shadow-elegant")}>
      {/* Header row — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 text-right hover:bg-secondary/40 transition-colors"
      >
        {/* Chevron */}
        <span className="text-muted-foreground flex-shrink-0">
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>

        {/* Overall status icon */}
        <StatusIcon className={cn("h-4 w-4 flex-shrink-0", cfg.color)} />

        {/* Progress bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-muted-foreground">{working}/{total} פועלות</span>
            <div className="flex items-center gap-1.5">
              {themeInfo && (
                <span className={cn("text-[10px] font-medium border rounded-full px-1.5 py-0", themeInfo.color)}>
                  {themeInfo.label}
                </span>
              )}
              <span className="text-xs font-semibold text-muted-foreground">{pct}%</span>
            </div>
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-rose-400")}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Tab label + icon + navigate */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-sm font-semibold text-foreground">{tab.label}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate(); }}
            title={`עבור ל${tab.label}`}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-primary transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
          <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-gold/70 bg-card text-navy flex-shrink-0">
            <Icon className="h-4 w-4" />
          </span>
        </div>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="border-t border-gold/20 px-3 pb-3 animate-in slide-in-from-top-2 duration-200">
          {/* Description */}
          <p className="text-xs text-muted-foreground text-right py-2 px-2">{tab.description}</p>

          {/* Feature list */}
          <div className="space-y-0.5">
            {tab.features.map((f, i) => (
              <FeatureRow key={i} feature={f} globalIndex={startIndex + i} search={search} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

// ──────────────────────────────────────────────────────────────
//  Main component
// ──────────────────────────────────────────────────────────────
export function SystemRubric() {
  const [groupMode, setGroupMode] = useState<"sidebar" | "theme">("sidebar");
  const [openTabs, setOpenTabs] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FeatureStatus | "all">("all");
  const navigate = useNavigate();

  const toggleAll = () => {
    if (allIds.length > 0 && openTabs.size === allIds.length) setOpenTabs(new Set());
    else setOpenTabs(new Set(allIds));
  };

  const toggleTab = (id: string) => {
    setOpenTabs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Auto-merge: any sidebar item without a TABS_RUBRIC entry becomes a placeholder tab
  const mergedTabs = useMemo(() => {
    const rubricMap = new Map(TABS_RUBRIC.map((t) => [t.id, t]));
    return DEFAULT_SIDEBAR_ITEMS
      .filter((item) => item.id !== "system-rubric") // skip the rubric tab itself
      .map((item): TabRubric => {
        if (rubricMap.has(item.id)) return rubricMap.get(item.id)!;
        // New tab not yet documented — auto-generated placeholder
        return {
          id: item.id,
          label: item.label,
          icon: item.icon as LucideIcon,
          description: "טאב חדש — לא תועד עדיין ברוברוקה",
          overallStatus: "placeholder",
          themeCategory: "tools",
          features: [],
        };
      });
  }, []);

  // Compute the 1-based global start index for each tab (cumulative feature count)
  const tabStartIndex = useMemo(() => {
    const map: Record<string, number> = {};
    let counter = 1;
    for (const tab of mergedTabs) {
      map[tab.id] = counter;
      counter += tab.features.length;
    }
    return map;
  }, [mergedTabs]);

  // Group the tabs by theme when in theme mode
  const groupedByTheme = useMemo(() => {
    return THEME_CATEGORIES.map((cat) => ({
      ...cat,
      tabs: mergedTabs.filter((t) => t.themeCategory === cat.id),
    }));
  }, [mergedTabs]);

  const stats = useMemo(() => overallStats(mergedTabs), [mergedTabs]);
  const allIds = mergedTabs.map((t) => t.id);

  // Filtered view
  const filteredTabs = useMemo(() => {
    let tabs = mergedTabs;
    if (statusFilter !== "all") {
      tabs = tabs.filter((t) =>
        t.overallStatus === statusFilter || t.features.some((f) => f.status === statusFilter)
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      tabs = tabs.filter((t) =>
        t.label.toLowerCase().includes(q) ||
        t.features.some((f) => f.name.toLowerCase().includes(q) || (f.description ?? "").toLowerCase().includes(q))
      );
    }
    return tabs;
  }, [mergedTabs, search, statusFilter]);

  // Auto-expand matching tabs when searching
  useEffect(() => {
    if (search.trim()) setOpenTabs(new Set(filteredTabs.map((t) => t.id)));
  }, [search, filteredTabs]);

  // Filtered theme groups (hide empty groups when filter active)
  const filteredGroupedByTheme = useMemo(() => {
    const ids = new Set(filteredTabs.map((t) => t.id));
    return groupedByTheme
      .map((g) => ({ ...g, tabs: g.tabs.filter((t) => ids.has(t.id)) }))
      .filter((g) => g.tabs.length > 0);
  }, [groupedByTheme, filteredTabs]);

  const completedTabsCount = mergedTabs.filter(
    (t) => t.features.length > 0 && t.features.every((f) => f.status === "working")
  ).length;
  const undocumentedCount = mergedTabs.filter((t) => t.features.length === 0).length;

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-6 animate-fade-in" dir="rtl">
      {/* Page header */}
      <div className="text-right space-y-1">
        <div className="flex items-center justify-end gap-3">
          <div className="space-y-0.5">
            <h1 className="font-display text-2xl font-bold text-gold">מפת מערכת</h1>
            <p className="text-sm text-muted-foreground">סקירה מלאה של כל הטאבים, הפונקציות וסטטוס המימוש</p>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-gold bg-card text-navy shadow-gold flex-shrink-0">
            <LayoutGrid className="h-6 w-6" />
          </span>
        </div>
      </div>

      {/* Stats bar */}
      <Card className="gold-frame p-4">
        <div className="flex flex-wrap items-center gap-4 justify-between">
          {/* Overall progress */}
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">השלמה כוללת</span>
              <span className="text-sm font-bold text-foreground">{stats.pct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-l from-emerald-500 to-amber-400 transition-all"
                style={{ width: `${stats.pct}%` }}
              />
            </div>
          </div>

          {/* Counters */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-semibold text-foreground">{stats.working}</span>
              <span className="text-xs text-muted-foreground">פועלות</span>
            </div>
            <div className="flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-semibold text-foreground">{stats.partial}</span>
              <span className="text-xs text-muted-foreground">חלקיות</span>
            </div>
            <div className="flex items-center gap-1.5">
              <XCircle className="h-4 w-4 text-rose-500" />
              <span className="text-sm font-semibold text-foreground">{stats.placeholder}</span>
              <span className="text-xs text-muted-foreground">Placeholder</span>
            </div>
            <div className="flex items-center gap-1.5 border-r border-gold/30 pr-3">
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">{stats.total}</span>
              <span className="text-xs text-muted-foreground">סה"כ</span>
            </div>
          </div>
        </div>        {/* Summary row */}
        <div className="flex items-center gap-4 justify-end border-t border-gold/20 mt-3 pt-3 text-xs text-muted-foreground flex-wrap">
          <span>טאבים: <strong className="text-foreground">{mergedTabs.length}</strong></span>
          <span className="text-emerald-600">✔ {completedTabsCount} הושלמו (100%)</span>
          {undocumentedCount > 0 && (
            <span className="text-amber-500">⚠️ {undocumentedCount} לא מתועדים</span>
          )}
        </div>      </Card>

      {/* Search + Filter + Export row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search input */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="\u05d7\u05e4\u05e9 \u05d8\u05d0\u05d1 \u05d0\u05d5 \u05e4\u05d9\u05e6'\u05e8..."
            className="pr-9 text-right text-sm"
            dir="rtl"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Status filter chips */}
        <div className="flex items-center gap-1">
          {(["all", "working", "partial", "placeholder"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap",
                statusFilter === s
                  ? "bg-secondary border-gold text-foreground"
                  : "border-transparent text-muted-foreground hover:border-gold/40"
              )}
            >
              {s === "all" ? "\u05d4\u05db\u05dc" : s === "working" ? "\u2705 \u05e4\u05d5\u05e2\u05dc" : s === "partial" ? "\u26a0\ufe0f \u05d7\u05dc\u05e7\u05d9" : "\u274c Placeholder"}
            </button>
          ))}
        </div>

        {/* Export dropdown */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="border-gold/60 text-xs gap-1.5 flex-shrink-0">
              <Download className="h-3.5 w-3.5" />
              \u05d9\u05e6\u05d5\u05d0 \u25be
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1" dir="rtl">
            {[
              { icon: FileText,    label: "JSON",             fn: () => doExportJSON(filteredTabs) },
              { icon: BarChart2,   label: "CSV (Excel \u05e2\u05d1\u05e8\u05d9\u05ea)",  fn: () => doExportCSV(filteredTabs) },
              { icon: BarChart2,   label: "XLS (Excel RTL)",  fn: () => doExportXLS(filteredTabs) },
              { icon: Globe,       label: "HTML + RTL",       fn: () => doExportHTML(filteredTabs) },
              { icon: Hash,        label: "Markdown",         fn: () => doExportMarkdown(filteredTabs) },
              { icon: Printer,     label: "PDF \u2014 \u05d4\u05d3\u05e4\u05e1\u05d4",    fn: () => window.print() },
              { icon: Clipboard,   label: "\u05d4\u05e2\u05ea\u05e7 \u05dc\u05d6\u05d9\u05db\u05e8\u05d5\u05df",     fn: () => doExportClipboard(filteredTabs) },
            ].map(({ icon: Icon, label, fn }) => (
              <button
                key={label}
                onClick={fn}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-secondary transition-colors text-right"
              >
                <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                {label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Group mode toggle */}
        <div className="flex items-center gap-2 rounded-xl border-2 border-gold/40 bg-card p-1">
          <button
            onClick={() => setGroupMode("theme")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              groupMode === "theme" ? "bg-gradient-navy text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            <Tag className="h-3.5 w-3.5" />
            לפי נושא
          </button>
          <button
            onClick={() => setGroupMode("sidebar")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              groupMode === "sidebar" ? "bg-gradient-navy text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            לפי סיידבר
          </button>
        </div>

        {/* Expand / collapse all */}
        <Button
          variant="outline"
          size="sm"
          onClick={toggleAll}
          className="border-gold/60 text-xs gap-1.5"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
          {allIds.length > 0 && openTabs.size === allIds.length ? "סגור הכל" : "פתח הכל"}
        </Button>
      </div>

      {/* Tab list — sidebar order */}
      {groupMode === "sidebar" && (
        <div className="space-y-3">
          {filteredTabs.map((tab) => (
            <TabCard
              key={tab.id}
              tab={tab}
              isOpen={openTabs.has(tab.id)}
              onToggle={() => toggleTab(tab.id)}
              startIndex={tabStartIndex[tab.id]}
              onNavigate={() => navigate(`/?section=${tab.id}`)}
              search={search}
            />
          ))}
        </div>
      )}

      {/* Tab list — by theme category */}
      {groupMode === "theme" && (
        <div className="space-y-6">
          {filteredGroupedByTheme.map((group) => {
            const groupStats = overallStats(group.tabs);
            return (
              <div key={group.id} className="space-y-3">
                {/* Group header */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t border-gold/30" />
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">{groupStats.pct}%</span>
                    <span className={cn("text-sm font-bold px-3 py-1 rounded-full border", group.color)}>
                      {group.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{group.tabs.length} טאבים</span>
                  </div>
                  <div className="flex-1 border-t border-gold/30" />
                </div>

                {/* Tabs in this group */}
                <div className="space-y-3">
                  {group.tabs.map((tab) => (
                    <TabCard
                      key={tab.id}
                      tab={tab}
                      isOpen={openTabs.has(tab.id)}
                      onToggle={() => toggleTab(tab.id)}
                      startIndex={tabStartIndex[tab.id]}
                      onNavigate={() => navigate(`/?section=${tab.id}`)}
                      search={search}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}
