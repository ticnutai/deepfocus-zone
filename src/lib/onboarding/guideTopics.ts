import {
  GraduationCap, BookOpen, FolderTree, ListChecks, ScrollText, WifiOff, CircleHelp,
  type LucideIcon,
} from "lucide-react";

export interface GuideTopic {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** Sidebar/home-tab id to jump to when the user clicks "עבור לשם" — omit for info-only cards. */
  navigateTo?: string;
  /**
   * When set, clicking the card also force-opens that page's own real
   * step-by-step interactive guide (e.g. DeckCreationGuide) after landing —
   * not just a plain navigation. See lib/onboarding/guideTriggers.ts.
   */
  guideTriggerId?: string;
}

// Deliberately short list (not a dump of every feature) — a first-time user
// should be able to scan this in under a minute. "decks" and "questions" open
// their real per-page interactive step-by-step guides (guideTriggerId); the
// rest are plain navigation + a one-line explanation.
export const GUIDE_TOPICS: GuideTopic[] = [
  {
    id: "study",
    icon: GraduationCap,
    title: "חזרות לימוד",
    description: "המערכת מזכירה לך שאלות בדיוק כשאתה עומד לשכוח אותן (שיטת חזרה מרווחת). כאן מתחילים כל יום.",
    navigateTo: "study",
  },
  {
    id: "daf",
    icon: BookOpen,
    title: "לימוד דף יומי",
    description: "טקסט הגמרא זמין גם ללא אינטרנט — כולל רש\"י ותוספות. עוברים דף אחר דף ומסמנים התקדמות.",
    navigateTo: "daf",
  },
  {
    id: "decks",
    icon: BookOpen,
    title: "יצירת מבחנים",
    description: "מדריך אינטראקטיבי בן 4 שלבים עם צילומי מסך אמיתיים — איך פותחים מבחן חדש, נותנים לו שם, ומשייכים קטגוריות.",
    navigateTo: "decks",
    guideTriggerId: "decks",
  },
  {
    id: "questions",
    icon: CircleHelp,
    title: "יצירת שאלות",
    description: "מדריך אינטראקטיבי בן 5 שלבים — בוחרים קטגוריית סיווג, כותבים שאלה, מגדירים סוג (אמריקאי / נכון-לא נכון / כרטיסיה) ושומרים.",
    navigateTo: "questions",
    guideTriggerId: "questions",
  },
  {
    id: "categories",
    icon: FolderTree,
    title: "קטגוריות",
    description: "מארגנים את השאלות בעץ קטגוריות היררכי (למשל ש\"ס ← מועד ← חגיגה) — כדי שהחזרות יתאימו בדיוק למה שאתם לומדים.",
    navigateTo: "categories",
  },
  {
    id: "goals",
    icon: ListChecks,
    title: "יעדים והישגים",
    description: "קובעים יעד יומי/שבועי ורואים רצף ימים, כרטיסי הישגים והתקדמות לאורך זמן.",
    navigateTo: "goals",
  },
  {
    id: "shas-board",
    icon: ScrollText,
    title: "לוח ש\"ס",
    description: "מפת נוכחות אישית על כל הש\"ס — לראות בבת אחת מה כבר נלמד ומה נשאר.",
    navigateTo: "shas-board",
  },
  {
    id: "offline",
    icon: WifiOff,
    title: "עבודה אופליין",
    description: "האפליקציה עובדת גם בלי אינטרנט לגמרי — ברגע שהחיבור חוזר, הכל מסתנכרן אוטומטית.",
  },
];

const SEEN_KEY = "guides-seen:v1";

export function hasSeenGuides(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // fail closed — never spam if storage is unavailable
  }
}

export function markGuidesSeen(): void {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
}
