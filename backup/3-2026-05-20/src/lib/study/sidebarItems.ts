// Shared list of all available shell sidebar section IDs and labels.
// Used by AppSidebar (rendering) and RoleDefaultsTab (admin blocklist editor).
export interface SidebarItemMeta {
  id: string;
  label: string;
}

export const ALL_SIDEBAR_ITEMS: SidebarItemMeta[] = [
  { id: "home", label: "בית" },
  { id: "blocker", label: "בודק רצפים" },
  { id: "morning", label: "קימה בבוקר" },
  { id: "today", label: "היום שלי" },
  { id: "tasks", label: "לוח משימות" },
  { id: "cards", label: "קטגוריות ושאלות" },
  { id: "search", label: "חיפוש חכם" },
  { id: "habits", label: "הרגלים" },
  { id: "journal", label: "יומן" },
  { id: "timer", label: "טיימר" },
  { id: "monitor", label: "בקרת מעקב" },
  { id: "goals", label: "יעדים יומיים" },
  { id: "book", label: "הספר שלי" },
  { id: "studio", label: "סטודיו מסמכים" },
  { id: "pdf", label: "צפיין PDF" },
  { id: "ai", label: "מאמן AI" },
  { id: "achievements", label: "הישגים" },
  { id: "archive", label: "ארכיון" },
  { id: "backup-restore", label: "גיבוי ושחזור" },
  { id: "db-inspector", label: "מסד נתונים" },
  { id: "admin", label: "ניהול משתמשים" },
  { id: "settings", label: "הגדרות" },
];
