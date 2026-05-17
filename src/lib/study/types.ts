export type CardType = "flashcard" | "multiple" | "boolean" | "combo";

export interface BaseCard {
  id: string;
  /** Deck this card is directly assigned to. null = category-owned only (no deck). */
  deckId: string | null;
  type: CardType;
  question: string;
  tags: string[];
  createdAt: number;
  updatedAt?: number;
  /** ש"ס: שיוך מובנה לעמוד גמרא (אופציונלי) */
  masechta?: string | null;
  daf?: number | null;       // 2..N
  amud?: 1 | 2 | null;       // 1=ע"א, 2=ע"ב, null=שני העמודים
  // SRS state (SM-2 + optional FSRS fields)
  srs: {
    ease: number; // 1.3 - 2.5+
    interval: number; // days
    repetitions: number;
    dueAt: number; // timestamp ms
    lastReviewedAt: number | null;
    // FSRS-only (populated when algorithm = "fsrs")
    stability?: number;   // days; expected memory stability
    difficulty?: number;  // 1..10; intrinsic difficulty
    lapses?: number;      // count of failed reviews
  };
  // Stats
  stats: {
    totalReviews: number;
    correct: number;
    incorrect: number;
  };
}

export interface FlashcardCard extends BaseCard {
  type: "flashcard";
  answer: string;
}

export interface MultipleChoiceCard extends BaseCard {
  type: "multiple";
  options: string[];
  correctIndices: number[]; // supports multi-correct
}

export interface BooleanCard extends BaseCard {
  type: "boolean";
  correct: boolean;
  explanation?: string;
}

// Combo card: same question can be practiced as flashcard, multiple choice, or both
export interface ComboCard extends BaseCard {
  type: "combo";
  answer?: string; // open answer
  options?: string[]; // multiple choice options
  correctIndices?: number[];
  explanation?: string;
}

export type Card = FlashcardCard | MultipleChoiceCard | BooleanCard | ComboCard;

export interface Category {
  id: string;
  name: string;
  parentId: string | null; // for nesting
  color?: string;
  createdAt: number;
  updatedAt?: number;
  sortOrder?: number;
}

export interface Deck {
  id: string;
  name: string;
  description?: string;
  color: string; // semantic hint
  createdAt: number;
  updatedAt?: number;
  /** Category IDs whose cards this deck collects (in addition to directly-linked cards) */
  categoryIds: string[];
  /** If true, include cards from all descendant sub-categories of categoryIds */
  includeSubCategories: boolean;
}

// Many-to-many link: a card can belong to multiple decks
export interface CardDeckLink {
  cardId: string;
  deckId: string;
  sortOrder: number;
  updatedAt?: number;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  deckId: string | null;
  at: number;
  quality: 0 | 1 | 2 | 3 | 4 | 5;
  correct: boolean;
  durationMs: number;
  updatedAt?: number;
}

// === Goals ===
export type GoalType =
  | "daily_reviews"      // X חזרות ביום
  | "daily_cards"        // X כרטיסים שונים ביום
  | "success_rate"       // אחוז הצלחה מינימלי על חלון ימים
  | "streak"             // רצף ימים פעילים
  | "shas_daf"           // דף יומי בש"ס
  | "custom";            // טקסט חופשי, סימון ידני

export interface Goal {
  id: string;
  type: GoalType;
  title: string;
  target: number;          // לדוג' 20 חזרות, 80%, 7 ימי רצף
  windowDays?: number;     // לסוגי success_rate
  deckId?: string | null;  // אופציונלי - מוגבל לקבוצה
  active: boolean;
  createdAt: number;
  updatedAt?: number;
  // לסימון ידני (custom): רשימת תאריכים (yyyy-mm-dd) שסומנו כהושלמו
  manualDoneDates?: string[];
}

// === Shas tracking ===
export type ShasUnit = "daf" | "amud" | "half";

export interface ShasPlan {
  id: string;
  name?: string;
  selectedMasechtos: string[]; // names
  pagesPerDay: number;         // לדוגמה 1 = דף יומי
  startDate: number;           // ms
  // יחידת לימוד: דף שלם / עמוד / חצי עמוד
  unit: ShasUnit;
  // current position
  currentMasechta: string;
  currentDaf: number;          // starts at 2
  currentAmud: 1 | 2;          // 1=ע"א, 2=ע"ב
  currentHalf: 1 | 2;          // 1=חצי ראשון, 2=חצי שני (רלוונטי ל-unit=half)
  // log of completed dafim: { masechta, daf, at }
  completed: { masechta: string; daf: number; amud?: 1 | 2; half?: 1 | 2; at: number }[];
  // ימי דילוג: 0=ראשון … 6=שבת
  skipWeekdays?: number[];
  // תאריכים מיוחדים חוזרים בפורמט MM-DD
  skipDates?: string[];
  // עוגן: תאריך + מיקום ידוע → מחשבים מה הציפייה להיום
  anchorDate?: string;       // YYYY-MM-DD (גרגוריאני)
  anchorPosition?: { masechta: string; daf: number; amud: 1 | 2 };
}

export interface DayNote {
  date: string;          // yyyy-mm-dd
  text: string;
  updatedAt: number;
}

// === Shas review schedule (תזכורות חזרה על דפים) ===
export interface ShasReview {
  id: string;
  masechta: string;
  daf: number;
  amud: 1 | 2;
  half?: 1 | 2 | null;
  unit: ShasUnit;
  reviewIndex: number;     // 1=ראשון (לימוד), 2,3,4...=חזרות
  dueDate: string;         // yyyy-mm-dd
  doneAt: string | null;   // yyyy-mm-dd אם הושלם
  isInitial: boolean;      // רשומת לימוד ראשונית
  note?: string | null;
  updatedAt?: number;
}

// === General Learning Sessions ===
export interface LearningSession {
  id: string;
  date: string;                            // yyyy-mm-dd
  subject: string;                         // נושא (גמרא, הלכה, פרשה, ...)
  sessionType: "initial" | "review";       // לימוד ראשוני / חזרה
  quality: 1 | 2 | 3 | 4 | 5;             // איכות 1-5
  durationMinutes?: number;                // משך בדקות
  note?: string;
  nextReviewDate?: string | null;          // yyyy-mm-dd
  reviewNumber: number;                    // 1=ראשון, 2,3...
  createdAt: number;
  updatedAt?: number;
}

// === Tab configuration ===
export interface TabConfig {
  id: string;       // unique tab id
  visible: boolean; // shown or hidden
  order: number;    // sort order
}

export interface SidebarConfig {
  id: string;       // unique sidebar item id
  visible: boolean; // shown or hidden
  order: number;    // sort order
}

// === Widget layout ===
export interface WidgetConfig {
  id: string;
  visible: boolean;
  size: 'half' | 'full';
  order: number;
  height?: number;
  collapsed?: boolean; // when true, render only header strip
}
export type WidgetLayout = Record<string, WidgetConfig[]>;

// === UI preferences (per-user toggles) ===
export interface UiPrefs {
  showCalendarSubjects?: boolean; // הצגת שמות הלימודים על תאי לוח השנה
  showStudiedBadge?: boolean;     // נקודת "למדתי היום" על לשונית הלימוד
  // Calendar legend toggles (default true = visible)
  calShowCompleted?: boolean;     // הושלם — ירוק + וי
  calShowOverdue?: boolean;       // פיגור — נקודה אדומה
  calShowShasDue?: boolean;       // ש"ס לחזרה — נקודה זהב
  calShowHoliday?: boolean;       // חג / מועד — רקע זהב + טקסט
  // Study session preferences (synced local + cloud, last-write-wins)
  studyViewMode?: "classic" | "flip" | "list" | "test";
  studyComboPref?: "flash" | "multi" | "both";
  studyOptLayout?: "letters" | "grid" | "list";
  studyAnswerMode?: "instant" | "button";
  studyQuizTheme?: "classic" | "millionaire" | "navy" | "dark" | "colorful" | "custom";
  // CardEditor: pinned category names (synced)
  pinnedCats?: string[];
  // CardsManager: deck list view mode (synced)
  cardsDeckView?: "list" | "grid" | "compact";
  // CategoriesPage / PinnedCategoriesWidget: pinned category names (synced)
  pinnedCategoryNames?: string[];
  // CategoryManager: selected view mode (synced across devices)
  categoryViewMode?: "browse" | "explorer" | "list" | "cards" | "mindmap";
  // CategoriesPage: per-category sort mode for the cards list
  categorySortOrders?: Record<string, "name" | "createdNew" | "createdOld" | "favorites" | "manual">;
  // Mishnayot tracker: { [sederName]: { [masechetName]: { [perekIndex]: number[] of learned mishna indices (1-based) } } }
  mishnayotProgress?: Record<string, Record<string, Record<number, number[]>>>;
  // Cloud-sync toggle (persisted to cloud so it roams across devices)
  syncEnabled?: boolean;
  // Bookkeeping for last-write-wins between local cache and cloud
  updatedAt?: number;
}

// === User-defined category templates ===
export interface CategoryTemplateNodeData {
  name: string;
  children?: CategoryTemplateNodeData[];
}
export interface CustomCategoryTemplate {
  id: string;
  title: string;
  description?: string;
  emoji?: string;
  roots: CategoryTemplateNodeData[];
  createdAt: number;
  updatedAt: number;
}

export interface StudyState {
  decks: Deck[];
  cards: Card[];
  logs: ReviewLog[];
  categories?: Category[];
  goals?: Goal[];
  shasPlan?: ShasPlan | null;
  shasPlans?: ShasPlan[];
  activeShasPlanId?: string | null;
  notificationsEnabled?: boolean;
  reminderTime?: string; // "HH:MM"
  dayNotes?: DayNote[];
  cardDecks?: CardDeckLink[]; // many-to-many: card <-> deck
  shasReviews?: ShasReview[];
  reviewIntervals?: number[]; // ימים אחרי הלימוד שבהם להזכיר חזרה
  planReviewIntervals?: number[]; // מרווחי חזרה לתוכניות לימוד (ברירת מחדל 1/7/30/90)
  learningSessions?: LearningSession[];
  tabConfig?: TabConfig[]; // per-user tab order + visibility
  sidebarConfig?: SidebarConfig[]; // per-user sidebar order + visibility
  widgetLayout?: WidgetLayout; // per-tab widget order, size, visibility
  uiPrefs?: UiPrefs; // per-user UI toggles (calendar labels, badges, ...)
  generalPlans?: GeneralStudyPlan[];
  planReviews?: PlanReview[];
  customCategoryTemplates?: CustomCategoryTemplate[];
  /** Per-deck category names (local-only, not synced to Supabase). Empty array = explicitly no classification. */
  deckCategories?: Record<string, string[]>;
  quizPlans?: QuizPlan[];
  quizAttempts?: QuizAttempt[];
}

export type StudyMode = "practice" | "srs";

// === General Study Plans ===
export type GeneralPlanType = "chumash" | "rambam" | "shulchan_aruch" | "tehillim" | "nach" | "custom" | "masechta_review" | "shas" | "deck_review" | "mishnayot";

export type MishnaUnit = "perek" | "mishna";

export type ReviewScopeType = "masechta" | "perek" | "daf_range" | "custom";
export type ReviewScheduleType = "srs" | "fixed_interval" | "manual";
export type ReviewSpacingMode = "from_start" | "from_completion" | "between_reviews";

export interface GeneralStudyPlan {
  id: string;
  planType: GeneralPlanType;
  title: string;
  units: string[];           // ordered list of selected units
  unitsPerDay: number;       // float: 1=daily, 1/7=weekly, 1/30=monthly
  startDate: number;         // ms timestamp
  completedUnits: string[];  // names of completed units (in completion order)
  // ימי דילוג: 0=ראשון … 6=שבת
  skipWeekdays?: number[];
  // תאריכים מיוחדים חוזרים בפורמט MM-DD
  skipDates?: string[];
  // עוגן: תאריך + מיקום ידוע → מחשבים מה הציפייה להיום
  anchorDate?: string;       // YYYY-MM-DD (גרגוריאני)
  anchorPosition?: { unitIndex: number };

  // ── שדות ייחודיים לתוכנית ש"ס (shas) ──
  shasUnit?: ShasUnit;             // daf / amud / half (מאפיין של shas plans)

  // ── שדות ייחודיים לתוכנית משניות (mishnayot) ──
  mishnaUnit?: MishnaUnit;         // perek / mishna

  // ── שדות ייחודיים לתוכנית חזרות מסכתות (masechta_review) ──
  reviewScopeType?: ReviewScopeType;     // מסכת שלמה / פרק / טווח דפים / חופשי
  reviewScopeDetail?: string;            // פירוט: "פרק א'", "דפים ב'-כ"", טקסט חופשי
  reviewScheduleType?: ReviewScheduleType; // srs / מרווח קבוע / תאריכים ידניים
  fixedIntervalDays?: number;            // לסוג fixed_interval: כל X ימים
  manualReviewDates?: string[];          // לסוג manual: תאריכי חזרה קבועים YYYY-MM-DD
  linkedDeckId?: string;                 // דק לחיבור לחזרה (שאלות/תשובות)

  // ── שדות ייחודיים לתוכנית חזרה על מערכות (deck_review) ──
  deckIds?: string[];                    // מזהי המערכות הכלולות בתוכנית

  // ── שדות חזרה אופציונליים נוספים ──
  reviewEnabled?: boolean;
  reviewRepetitions?: number;
  reviewSpacingMode?: ReviewSpacingMode;
  reviewIntervals?: number[];
  archivedAt?: number;
}

// === Plan Review Schedule ===
// After completing a unit, reviews are scheduled at fixed intervals
export const PLAN_REVIEW_INTERVALS_DAYS = [1, 7, 30, 90] as const;

// Quality grades when marking a review done — adapts the NEXT interval (SM-2 inspired)
export type PlanReviewQuality = 1 | 2 | 3 | 4; // 1=שכחתי, 2=קשה, 3=טוב, 4=קל

export interface PlanReview {
  id: string;
  planId: string;
  planTitle: string;
  unit: string;
  dueDate: string;        // yyyy-mm-dd
  doneAt: string | null;  // yyyy-mm-dd when marked done
  reviewIndex: number;    // 1=יום, 2=שבוע, 3=חודש, 4=רבעון
  quality?: PlanReviewQuality; // grade given when marked done
  note?: string;          // optional reminder / mnemonic
  createdAt: number;
}

// === Quiz / Exam Plans ===
export type QuizQuestionType = "multiple" | "open"; // אמריקאי / פתוח
export type QuizPerSessionMode = "fixed" | "allDue" | "random";
export type QuizSchedulingMode = "manual" | "notifications" | "quota";

export interface QuizScope {
  /** מסלול קטגוריה מלא (PATH_SEP) — או "" לכלל הקטגוריות */
  path: string;
  /** האם לכלול תת-קטגוריות בכל העומק */
  includeDescendants: boolean;
  /** סוגי שאלות לקטגוריה הזו (אופציונלי — אחרת ברירת המחדל של התוכנית) */
  questionTypes?: QuizQuestionType[];
}

export interface QuizPlan {
  id: string;
  name: string;
  scopes: QuizScope[];
  /** סוגי שאלות ברירת מחדל לתוכנית */
  questionTypes: QuizQuestionType[];
  perSession: {
    /** המשתמש יכול לבחור כמה אופציות יחד */
    modes: QuizPerSessionMode[];
    fixedCount?: number;     // אם נבחר fixed
    randomMin?: number;      // אם נבחר random
    randomMax?: number;
  };
  selection: {
    random: boolean;
    uncoveredFirst: boolean;
    weakFirst: boolean;
    weighted: boolean;
  };
  duration: {
    days?: number | null;
    endDate?: string | null;  // yyyy-mm-dd
    openEnded: boolean;       // ללא הגבלה
  };
  frequency: {
    daily?: number | null;          // כמה מבחנים ביום
    bigExamDates: string[];         // yyyy-mm-dd
  };
  scheduling: {
    manual: boolean;
    notifications: boolean;
    quotaPerWeek?: number | null;
  };
  isActive: boolean;
  createdAt: number;
}

export interface QuizAttempt {
  id: string;
  planId: string;
  startedAt: number;       // ms
  finishedAt: number | null;
  total: number;
  correct: number;
  wrongCardIds: string[];
  /** ציון מצטבר/מנורמל 0-100 */
  score: number;
  /** זמן בmilliseconds לכל שאלה לפי סדר */
  questionTimes?: number[];
}

