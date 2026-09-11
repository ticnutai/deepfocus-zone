/**
 * Shared sidebar navigation items — single source of truth.
 * Imported by Index.tsx, AppSidebar.tsx, and SystemRubric.tsx so that
 * adding a new tab here automatically surfaces it in the System Rubric.
 */
import {
  Home, Gauge, Sun, Calendar, CheckSquare, Target, BookOpen, Timer,
  Activity, ListChecks, Library, Folder, FileText, MessageCircle,
  Trophy, Archive, Settings, Shield, FolderTree, Search, HardDrive,
  DatabaseZap, LayoutGrid, Zap, BrainCircuit, ScrollText, CircleHelp, LineChart,
} from "lucide-react";

export type NavItem = { id: string; label: string; icon: typeof Home; to?: string };

export const DEFAULT_SIDEBAR_ITEMS: NavItem[] = [
  { id: "home",           label: "בית",                icon: Home },
  { id: "daf",            label: "תרגול",              icon: BookOpen },
  { id: "admin",          label: "ניהול משתמשים",       icon: Shield },
  { id: "settings",       label: "הגדרות",              icon: Settings },
  { id: "questions",      label: "בניית שאלות",         icon: CircleHelp },
  { id: "decks",          label: "בניית מבחנים",        icon: BookOpen },
  { id: "categories",     label: "קטגוריות",            icon: FolderTree },
  { id: "search",         label: "חיפוש",               icon: Search },
  { id: "study",          label: "חזרות",               icon: BookOpen },
  { id: "shas-board",     label: "לוח ש\"ס",            icon: ScrollText },
  { id: "summary",        label: "התקדמות",             icon: LineChart },
  { id: "system-rubric",  label: "מפת מערכת",          icon: LayoutGrid },
  { id: "blocker",        label: "בודק רצפים",          icon: Gauge },
  { id: "morning",        label: "קימה בבוקר",          icon: Sun },
  { id: "today",          label: "היום שלי",            icon: Calendar },
  { id: "tasks",          label: "לוח משימות",           icon: CheckSquare },
  { id: "habits",         label: "הרגלים",              icon: Target },
  { id: "journal",        label: "יומן",                icon: BookOpen },
  { id: "timer",          label: "טיימר",               icon: Timer },
  { id: "monitor",        label: "בקרת מעקב",           icon: Activity },
  { id: "goals",          label: "יעדים יומיים",         icon: ListChecks },
  { id: "book",           label: "הספר שלי",            icon: Library },
  { id: "studio",         label: "סטודיו מסמכים",       icon: Folder },
  { id: "pdf",            label: "צפיין PDF",           icon: FileText },
  { id: "ai",             label: "מאמן AI",             icon: MessageCircle },
  { id: "ai-generator",   label: "יצירת שאלות AI",     icon: BrainCircuit },
  { id: "question-lab",   label: "מעבדת שאלות",         icon: BrainCircuit },
  { id: "achievements",   label: "הישגים",              icon: Trophy },
  { id: "archive",        label: "ארכיון",              icon: Archive },
  { id: "backup-restore", label: "גיבוי ושחזור",        icon: HardDrive },
  { id: "db-inspector",   label: "מסד נתונים",          icon: DatabaseZap },
  { id: "perf",           label: "בדיקת מהירות",         icon: Zap },
];

/** The clean-install sidebar mirrors the approved compact desktop layout. */
export const DEFAULT_VISIBLE_SIDEBAR_IDS = new Set([
  "home",
  "daf",
  "admin",
  "settings",
  "questions",
  "decks",
  "categories",
  "search",
  "study",
  "shas-board",
  "summary",
]);

export const isDefaultSidebarItemVisible = (id: string) => DEFAULT_VISIBLE_SIDEBAR_IDS.has(id);
