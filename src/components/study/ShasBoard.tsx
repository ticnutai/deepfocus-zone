/**
 * ShasBoard — לוח לימוד ש"ס מלא.
 * - תצוגה היררכית (סדר → מסכת → דפים) + תצוגת מסכת בודדת + תצוגת רשימה שטוחה
 * - סימון לכל עמוד (א/ב) עם מונה חזרות (0 = לא נלמד, 1 = פעם ראשונה, 2 = שניה, …)
 * - בחירה מרובה: סמן הכל / נקה הכל / סימון קבוצתי + 1 / איפוס / קבע ערך
 * - סיכומים פר סדר, מסכת, וכל הש"ס + כמה נשאר לסיום
 * - שמירה בענן דרך uiPrefs (shasBoardProgress)
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft, BookOpen, Layers, Plus, Minus, RotateCcw,
  CheckSquare, Square, Sparkles, LayoutGrid, Rows3, Table2, List as ListIcon, Flag, Columns3, Palette, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStudy } from "@/lib/study/store";
import { SHAS_BAVLI, SEDARIM, type Masechta } from "@/lib/study/shasData";
import { ShasPlanner, type ShasPlannerViewMode } from "./ShasPlanner";
import { ShasCalendar, type ShasCalendarViewMode } from "./ShasCalendar";
import { ThemeEditorDialog } from "@/components/ThemeSwitcher";
import { useTheme, THEME_TOKEN_KEYS } from "@/theme/ThemeProvider";

// ===== Types & helpers =====
type AmudKey = "a" | "b";
type DafEntry = { a?: number; b?: number };           // value = repetition count
type MasechtaProgress = Record<number, DafEntry>;      // daf (2..pages+1) -> entry
type ShasBoardProgress = Record<string, MasechtaProgress>; // masechta name -> ...
type HierarchyLayout = "cards" | "table" | "compact" | "kanban";
type FlatLayout = "grid" | "table" | "compact";
type FlatSort = "name-asc" | "name-desc" | "progress-desc" | "progress-asc" | "remaining-desc" | "remaining-asc";
type ShasBoardThemeMode = "global" | "separate";

const HEB = [
  "א","ב","ג","ד","ה","ו","ז","ח","ט","י",
  "יא","יב","יג","יד","טו","טז","יז","יח","יט","כ",
  "כא","כב","כג","כד","כה","כו","כז","כח","כט","ל",
  "לא","לב","לג","לד","לה","לו","לז","לח","לט","מ",
  "מא","מב","מג","מד","מה","מו","מז","מח","מט","נ",
  "נא","נב","נג","נד","נה","נו","נז","נח","נט","ס",
  "סא","סב","סג","סד","סה","סו","סז","סח","סט","ע",
  "עא","עב","עג","עד","עה","עו","עז","עח","עט","פ",
  "פא","פב","פג","פד","פה","פו","פז","פח","פט","צ",
  "צא","צב","צג","צד","צה","צו","צז","צח","צט","ק",
  "קא","קב","קג","קד","קה","קו","קז","קח","קט","קי",
  "קיא","קיב","קיג","קיד","קטו","קטז","קיז","קיח","קיט","קכ",
  "קכא","קכב","קכג","קכד","קכה","קכו","קכז","קכח","קכט","קל",
  "קלא","קלב","קלג","קלד","קלה","קלו","קלז","קלח","קלט","קמ",
  "קמא","קמב","קמג","קמד","קמה","קמו","קמז","קמח","קמט","קנ",
  "קנא","קנב","קנג","קנד","קנה","קנו","קנז","קנח","קנט","קס",
  "קסא","קסב","קסג","קסד","קסה","קסו","קסז","קסח","קסט","קע",
  "קעא","קעב","קעג","קעד","קעה",
];
const heb = (n: number) => HEB[n - 1] ?? String(n);

// total amudim in shas (each masechet has `pages` dapim, each daf = 2 amudim; first daf is ב)
const TOTAL_AMUDIM = SHAS_BAVLI.reduce((s, m) => s + m.pages * 2, 0);

function amudKeys(): AmudKey[] { return ["a", "b"]; }
function masechtaAmudimCount(m: Masechta) { return m.pages * 2; }

function countMasechtaLearned(p: ShasBoardProgress, name: string): { learned: number; reps: number } {
  const mp = p?.[name] ?? {};
  let learned = 0;
  let reps = 0;
  for (const entry of Object.values(mp)) {
    if ((entry.a ?? 0) > 0) { learned++; reps += entry.a!; }
    if ((entry.b ?? 0) > 0) { learned++; reps += entry.b!; }
  }
  return { learned, reps };
}

function themeVarsStyleFromTokens(tokens: Record<string, string> | undefined): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (!tokens) return style;
  for (const key of THEME_TOKEN_KEYS) {
    const value = tokens[key];
    if (value) {
      (style as Record<string, string>)[`--${key}`] = value;
    }
  }
  return style;
}

// ===== Component =====
export function ShasBoard() {
  const { state, setUiPref } = useStudy();
  const { allThemes, getEffectiveTokens, theme: appTheme, duplicateTheme } = useTheme();
  const progress: ShasBoardProgress = useMemo(
    () => (state.uiPrefs as any)?.shasBoardProgress ?? {},
    [state.uiPrefs],
  );
  const viewPrefs = (state.uiPrefs as any)?.shasBoardViewPrefs ?? {};

  const [view, setView] = useState<"hierarchy" | "flat" | "planner" | "calendar">(viewPrefs.activeTab ?? "hierarchy");
  const [hierarchyLayout, setHierarchyLayout] = useState<HierarchyLayout>(viewPrefs.hierarchyLayout ?? "cards");
  const [flatLayout, setFlatLayout] = useState<FlatLayout>(viewPrefs.flatLayout ?? "grid");
  const [plannerLayout, setPlannerLayout] = useState<ShasPlannerViewMode>(viewPrefs.plannerLayout ?? "rich");
  const [calendarLayout, setCalendarLayout] = useState<ShasCalendarViewMode>(viewPrefs.calendarLayout ?? "month");
  const [flatSort, setFlatSort] = useState<FlatSort>(viewPrefs.flatSort ?? "progress-desc");
  const [boardThemeMode, setBoardThemeMode] = useState<ShasBoardThemeMode>(viewPrefs.boardThemeMode ?? "separate");
  const [boardThemeId, setBoardThemeId] = useState<string>(viewPrefs.boardThemeId ?? viewPrefs.boardTheme ?? appTheme ?? "royal-navy");
  const [boardLocalThemeIds, setBoardLocalThemeIds] = useState<string[]>(viewPrefs.boardLocalThemeIds ?? []);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [selectedMasechta, setSelectedMasechta] = useState<string | null>(null);
  const [selectedSeder, setSelectedSeder] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set()); // "masechta:daf:amud"
  const [defaultReps, setDefaultReps] = useState<number>(1); // increment value for "סמן +N"

  useEffect(() => { document.title = "לוח ש\"ס | מעקב למידה"; }, []);

  useEffect(() => {
    const nextPrefs = {
      activeTab: view,
      hierarchyLayout,
      flatLayout,
      plannerLayout,
      calendarLayout,
      flatSort,
      boardThemeMode,
      boardThemeId,
      boardLocalThemeIds,
    };
    const currentPrefs = (state.uiPrefs as any)?.shasBoardViewPrefs ?? {};
    if (JSON.stringify(currentPrefs) !== JSON.stringify(nextPrefs)) {
      setUiPref("shasBoardViewPrefs", nextPrefs as any);
    }
  }, [view, hierarchyLayout, flatLayout, plannerLayout, calendarLayout, flatSort, boardThemeMode, boardThemeId, boardLocalThemeIds, setUiPref, state.uiPrefs]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.shiftKey && (e.key === "V" || e.key === "v"))) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      e.preventDefault();

      if (view === "hierarchy") {
        const order: HierarchyLayout[] = ["cards", "table", "compact", "kanban"];
        const i = order.indexOf(hierarchyLayout);
        setHierarchyLayout(order[(i + 1) % order.length]);
      } else if (view === "flat") {
        const order: FlatLayout[] = ["grid", "table", "compact"];
        const i = order.indexOf(flatLayout);
        setFlatLayout(order[(i + 1) % order.length]);
      } else if (view === "planner") {
        const order: ShasPlannerViewMode[] = ["rich", "compact", "focus"];
        const i = order.indexOf(plannerLayout);
        setPlannerLayout(order[(i + 1) % order.length]);
      } else {
        const order: ShasCalendarViewMode[] = ["month", "timeline", "milestones"];
        const i = order.indexOf(calendarLayout);
        setCalendarLayout(order[(i + 1) % order.length]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, hierarchyLayout, flatLayout, plannerLayout, calendarLayout]);

  const save = useCallback((next: ShasBoardProgress) => {
    // Compute delta of newly-learned amudim for today's pace log.
    let oldLearned = 0, newLearned = 0;
    for (const mp of Object.values(progress)) for (const e of Object.values(mp)) {
      if ((e.a ?? 0) > 0) oldLearned++; if ((e.b ?? 0) > 0) oldLearned++;
    }
    for (const mp of Object.values(next)) for (const e of Object.values(mp)) {
      if ((e.a ?? 0) > 0) newLearned++; if ((e.b ?? 0) > 0) newLearned++;
    }
    const delta = newLearned - oldLearned;
    // Always write progress first.
    setUiPref("shasBoardProgress", next);
    if (delta > 0) {
      const today = new Date();
      const k = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      // Defer the log write so it doesn't pile another synchronous store update onto the click.
      const prevLog = ((state.uiPrefs as any)?.shasBoardLog ?? {}) as Record<string, number>;
      const nextLog = { ...prevLog, [k]: (prevLog[k] ?? 0) + delta };
      queueMicrotask(() => setUiPref("shasBoardLog", nextLog));
    }
  }, [progress, state.uiPrefs, setUiPref]);

  // ----- Totals -----
  const totals = useMemo(() => {
    let learned = 0;
    let reps = 0;
    const perSeder: Record<string, { learned: number; total: number; reps: number }> = {};
    const perMasechta: Record<string, { learned: number; total: number; reps: number }> = {};
    for (const seder of SEDARIM) perSeder[seder] = { learned: 0, total: 0, reps: 0 };
    for (const m of SHAS_BAVLI) {
      const { learned: ml, reps: mr } = countMasechtaLearned(progress, m.name);
      const total = masechtaAmudimCount(m);
      perMasechta[m.name] = { learned: ml, total, reps: mr };
      perSeder[m.seder].learned += ml;
      perSeder[m.seder].total += total;
      perSeder[m.seder].reps += mr;
      learned += ml;
      reps += mr;
    }
    return { learned, reps, perSeder, perMasechta };
  }, [progress]);

  const overallPct = Math.round((totals.learned / TOTAL_AMUDIM) * 100);
  const remaining = TOTAL_AMUDIM - totals.learned;
  const sederRows = useMemo(() => {
    return SEDARIM.map((sederName) => {
      const s = totals.perSeder[sederName];
      const pct = Math.round((s.learned / s.total) * 100);
      const masechtotCount = SHAS_BAVLI.filter((m) => m.seder === sederName).length;
      return { sederName, s, pct, masechtotCount };
    });
  }, [totals.perSeder]);

  const sortedMasechtot = useMemo(() => {
    const list = [...SHAS_BAVLI];
    list.sort((a, b) => {
      const ta = totals.perMasechta[a.name];
      const tb = totals.perMasechta[b.name];
      const pa = ta.total > 0 ? ta.learned / ta.total : 0;
      const pb = tb.total > 0 ? tb.learned / tb.total : 0;
      const ra = ta.total - ta.learned;
      const rb = tb.total - tb.learned;

      if (flatSort === "name-asc") return a.name.localeCompare(b.name, "he");
      if (flatSort === "name-desc") return b.name.localeCompare(a.name, "he");
      if (flatSort === "progress-desc") return pb - pa;
      if (flatSort === "progress-asc") return pa - pb;
      if (flatSort === "remaining-desc") return rb - ra;
      return ra - rb;
    });
    return list;
  }, [flatSort, totals.perMasechta]);

  const selectedBoardThemeDef = useMemo(
    () => allThemes.find((t) => t.id === boardThemeId) ?? allThemes[0],
    [allThemes, boardThemeId],
  );

  const effectiveBoardThemeId = boardThemeMode === "global" ? appTheme : (selectedBoardThemeDef?.id ?? appTheme);
  const boardThemeStyle = useMemo(() => {
    if (boardThemeMode === "global") return {} as React.CSSProperties;
    return themeVarsStyleFromTokens(getEffectiveTokens(effectiveBoardThemeId));
  }, [boardThemeMode, getEffectiveTokens, effectiveBoardThemeId]);

  const openBoardThemeEditor = useCallback((sourceThemeId: string) => {
    setBoardThemeMode("separate");

    let editableId = sourceThemeId;
    const alreadyLocal = boardLocalThemeIds.includes(sourceThemeId);

    if (!alreadyLocal) {
      const source = allThemes.find((t) => t.id === sourceThemeId);
      const copyLabel = `${source?.label ?? "ערכת נושא"} — לוח ש\"ס`;
      editableId = duplicateTheme(sourceThemeId, copyLabel, {});
      setBoardLocalThemeIds((prev) => (prev.includes(editableId) ? prev : [...prev, editableId]));
    }

    setBoardThemeId(editableId);
    setEditingThemeId(editableId);
    setThemeEditorOpen(true);
  }, [allThemes, boardLocalThemeIds, duplicateTheme]);

  const ThemeMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 border border-gold/40 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
          title="ערכת נושא ללוח ש״ס"
          aria-label="ערכת נושא ללוח ש״ס"
        >
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 text-right">
        <DropdownMenuLabel className="text-right">ערכת נושא ללוח ש"ס</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setBoardThemeMode("global")} className="justify-end text-right">
          כמו המערכת הכללית {boardThemeMode === "global" ? "✓" : ""}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setBoardThemeMode("separate")} className="justify-end text-right">
          תצוגה נפרדת ללוח ש"ס {boardThemeMode === "separate" ? "✓" : ""}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {boardThemeMode === "separate" && allThemes.map((theme) => (
          <DropdownMenuItem
            key={theme.id}
            onClick={() => setBoardThemeId(theme.id)}
            className="gap-2 flex-row-reverse justify-end text-right"
          >
            <div className="flex items-center gap-1.5 min-w-0 w-full">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openBoardThemeEditor(theme.id);
                }}
                title='ערוך ערכה ללוח ש"ס בלבד'
                className="p-1.5 rounded hover:bg-card text-muted-foreground hover:text-foreground shrink-0"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <div
                className="h-4 w-4 rounded-full border border-gold/50 shrink-0"
                style={{ background: theme.swatch[1] ?? theme.swatch[0] ?? "hsl(42 70% 50%)" }}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="truncate flex items-center justify-end gap-1">
                  {boardLocalThemeIds.includes(theme.id) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-gold/40 bg-gold/10 text-gold shrink-0">
                      לוח ש"ס
                    </span>
                  )}
                  <span>{theme.label} {effectiveBoardThemeId === theme.id ? "✓" : ""}</span>
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{theme.description}</div>
              </div>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-[11px] text-muted-foreground text-right">
          עריכה מהירה דרך אייקון העיפרון שומרת ערכה ייעודית ללוח ש"ס בלבד
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const ThemeControls = (
    <div className="flex items-center gap-1">
      {ThemeMenu}
    </div>
  );

  const BoardThemeEditor = editingThemeId ? (
    <ThemeEditorDialog
      open={themeEditorOpen}
      onOpenChange={setThemeEditorOpen}
      themeId={editingThemeId}
    />
  ) : null;

  // ----- Selection helpers -----
  const sKey = (m: string, daf: number, a: AmudKey) => `${m}:${daf}:${a}`;
  const toggleSel = useCallback((m: string, daf: number, a: AmudKey) => {
    setSelection((prev) => {
      const next = new Set(prev);
      const k = `${m}:${daf}:${a}`;
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);
  const clearSel = () => setSelection(new Set());
  const selectAllInMasechta = (m: Masechta) => {
    const next = new Set(selection);
    for (let d = 2; d <= m.pages + 1; d++) {
      next.add(sKey(m.name, d, "a"));
      next.add(sKey(m.name, d, "b"));
    }
    setSelection(next);
  };
  const clearAllInMasechta = (m: Masechta) => {
    const next = new Set(selection);
    for (let d = 2; d <= m.pages + 1; d++) {
      next.delete(sKey(m.name, d, "a"));
      next.delete(sKey(m.name, d, "b"));
    }
    setSelection(next);
  };
  const allInMasechtaSelected = (m: Masechta) => {
    for (let d = 2; d <= m.pages + 1; d++) {
      if (!selection.has(sKey(m.name, d, "a"))) return false;
      if (!selection.has(sKey(m.name, d, "b"))) return false;
    }
    return true;
  };

  // ----- Bulk actions -----
  const bulkApply = (op: "set" | "inc" | "dec" | "reset", value = defaultReps) => {
    if (selection.size === 0) return;
    let next = progress;
    for (const k of selection) {
      const [m, dStr, a] = k.split(":");
      const d = Number(dStr);
      const cur = next[m]?.[d]?.[a as AmudKey] ?? 0;
      let target = cur;
      if (op === "set") target = Math.max(0, value);
      if (op === "inc") target = cur + value;
      if (op === "dec") target = Math.max(0, cur - value);
      if (op === "reset") target = 0;
      next = setAmudReps(next, m, d, a as AmudKey, target);
    }
    save(next);
  };

  const singleClick = useCallback((m: string, daf: number, a: AmudKey) => {
    const cur = progress[m]?.[daf]?.[a] ?? 0;
    save(setAmudReps(progress, m, daf, a, cur + 1));
  }, [progress, save]);
  const singleRightClick = useCallback((e: React.MouseEvent, m: string, daf: number, a: AmudKey) => {
    e.preventDefault();
    const cur = progress[m]?.[daf]?.[a] ?? 0;
    save(setAmudReps(progress, m, daf, a, Math.max(0, cur - 1)));
  }, [progress, save]);

  // ----- Sub views -----
  const renderAmudButton = (m: Masechta, daf: number, a: AmudKey) => {
    const reps = progress[m.name]?.[daf]?.[a] ?? 0;
    const isSel = selection.has(sKey(m.name, daf, a));
    return (
      <AmudButton
        key={`${daf}-${a}`}
        masechtaName={m.name}
        daf={daf}
        amud={a}
        reps={reps}
        isSel={isSel}
        onClick={singleClick}
        onRightClick={singleRightClick}
        onToggleSel={toggleSel}
      />
    );
  };

  // ---- Bulk toolbar ----
  const BulkBar = (
    <Card className="sticky top-2 z-20 gold-frame p-3 flex flex-wrap items-center gap-2 bg-card/95 backdrop-blur">
      <Badge variant="outline" className="border-gold/60">
        נבחרו: {selection.size.toLocaleString("he-IL")}
      </Badge>
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">ערך:</span>
        <Button size="sm" variant="ghost" onClick={() => setDefaultReps((v) => Math.max(1, v - 1))}>
          <Minus className="h-3 w-3" />
        </Button>
        <span className="font-bold text-gold min-w-[1.5rem] text-center">{defaultReps}</span>
        <Button size="sm" variant="ghost" onClick={() => setDefaultReps((v) => v + 1)}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      <Button size="sm" variant="outline" disabled={selection.size === 0} onClick={() => bulkApply("inc")}>
        <Plus className="h-3 w-3 mr-1" /> +{defaultReps} חזרה
      </Button>
      <Button size="sm" variant="outline" disabled={selection.size === 0} onClick={() => bulkApply("dec")}>
        <Minus className="h-3 w-3 mr-1" /> -{defaultReps}
      </Button>
      <Button size="sm" variant="outline" disabled={selection.size === 0} onClick={() => bulkApply("set", defaultReps)}>
        קבע = {defaultReps}
      </Button>
      <Button size="sm" variant="outline" disabled={selection.size === 0} onClick={() => bulkApply("reset")} className="text-destructive">
        <RotateCcw className="h-3 w-3 mr-1" /> איפוס
      </Button>
      <Button size="sm" variant="ghost" disabled={selection.size === 0} onClick={clearSel} className="mr-auto">
        נקה בחירה
      </Button>
    </Card>
  );

  // ===== VIEW: Masechta detail =====
  if (selectedMasechta) {
    const m = SHAS_BAVLI.find((x) => x.name === selectedMasechta)!;
    const total = masechtaAmudimCount(m);
    const { learned, reps } = countMasechtaLearned(progress, m.name);
    const pct = Math.round((learned / total) * 100);

    return (
      <div className="space-y-4 shas-theme-shell" dir="rtl" style={boardThemeStyle}>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setSelectedMasechta(null)} className="gap-1">
            <ChevronLeft className="h-4 w-4" /> חזרה
          </Button>
          <h2 className="font-display text-2xl font-bold">מסכת {m.name}</h2>
          <Badge variant="outline" className="border-gold/60">{learned}/{total} עמודים ({pct}%)</Badge>
          <Badge variant="secondary">סך חזרות: {reps}</Badge>
          <div className="flex items-center gap-1 mr-auto">
            <Button size="sm" variant="outline" onClick={() => allInMasechtaSelected(m) ? clearAllInMasechta(m) : selectAllInMasechta(m)}>
              {allInMasechtaSelected(m) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              <span className="mr-1">{allInMasechtaSelected(m) ? "נקה הכל" : "בחר הכל במסכת"}</span>
            </Button>
          </div>
          {ThemeControls}
        </div>
        <Progress value={pct} className="h-2" />
        {BulkBar}
        <Card className="gold-frame p-4">
          <div className="space-y-2">
            {(() => {
              // Chunk amudim into rows of ~28 cells so each row can opt into
              // content-visibility virtualization independently.
              const allCells: Array<{ daf: number; a: AmudKey }> = [];
              for (let d = 2; d <= m.pages + 1; d++) {
                allCells.push({ daf: d, a: "a" });
                allCells.push({ daf: d, a: "b" });
              }
              const ROW = 28;
              const rows: typeof allCells[] = [];
              for (let i = 0; i < allCells.length; i += ROW) rows.push(allCells.slice(i, i + ROW));
              return rows.map((row, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-10 lg:grid-cols-14 gap-2"
                  style={{ contentVisibility: "auto", containIntrinsicSize: "auto 96px" } as React.CSSProperties}
                >
                  {row.map(({ daf, a }) => renderAmudButton(m, daf, a))}
                </div>
              ));
            })()}
          </div>
        </Card>
        {BoardThemeEditor}
      </div>
    );
  }

  // ===== VIEW: Seder detail =====
  if (selectedSeder) {
    const masechtotInSeder = SHAS_BAVLI.filter((m) => m.seder === selectedSeder);
    const seder = totals.perSeder[selectedSeder];
    const pct = Math.round((seder.learned / seder.total) * 100);

    return (
      <div className="space-y-4 shas-theme-shell" dir="rtl" style={boardThemeStyle}>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setSelectedSeder(null)} className="gap-1">
            <ChevronLeft className="h-4 w-4" /> חזרה
          </Button>
          <h2 className="font-display text-2xl font-bold">סדר {selectedSeder}</h2>
          <Badge variant="outline" className="border-gold/60">{seder.learned}/{seder.total} ({pct}%)</Badge>
          <Badge variant="secondary">חזרות: {seder.reps}</Badge>
          <div className="mr-auto" />
          {ThemeControls}
        </div>
        <Progress value={pct} className="h-2" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {masechtotInSeder.map((m) => {
            const t = totals.perMasechta[m.name];
            const p = Math.round((t.learned / t.total) * 100);
            return (
              <Card key={m.name} onClick={() => setSelectedMasechta(m.name)}
                className="gold-frame p-4 cursor-pointer hover:shadow-elegant transition-all space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-semibold">{m.name}</h3>
                  <span className="gold-icon-circle"><BookOpen className="h-4 w-4" /></span>
                </div>
                <div className="text-xs text-muted-foreground">{m.pages} דפים · {t.total} עמודים</div>
                <Progress value={p} className="h-1.5" />
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">{t.learned}/{t.total} ({p}%)</span>
                  {t.reps > 0 && <Badge variant="secondary" className="text-[10px]">חזרות: {t.reps}</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
        {BoardThemeEditor}
      </div>
    );
  }

  // ===== VIEW: Root (hierarchy / flat) =====
  return (
    <div className="space-y-4 shas-theme-shell" dir="rtl" style={boardThemeStyle}>
      {/* Summary header */}
      <Card className="gold-frame p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="gold-icon-circle"><Sparkles className="h-5 w-5" /></span>
          <h2 className="font-display text-2xl font-bold">לוח לימוד ש"ס</h2>
          <Badge variant="outline" className="border-gold/60 text-base">
            {totals.learned.toLocaleString("he-IL")}/{TOTAL_AMUDIM.toLocaleString("he-IL")} ({overallPct}%)
          </Badge>
          <div className="mr-auto" />
          {ThemeControls}
        </div>
        <Progress value={overallPct} className="h-3" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="text-center p-2 rounded-md bg-secondary">
            <div className="text-muted-foreground">נלמד</div>
            <div className="font-bold text-gold text-base">{totals.learned.toLocaleString("he-IL")}</div>
          </div>
          <div className="text-center p-2 rounded-md bg-secondary">
            <div className="text-muted-foreground">נשאר לסיום</div>
            <div className="font-bold text-base">{remaining.toLocaleString("he-IL")}</div>
          </div>
          <div className="text-center p-2 rounded-md bg-secondary">
            <div className="text-muted-foreground">סך חזרות</div>
            <div className="font-bold text-base">{totals.reps.toLocaleString("he-IL")}</div>
          </div>
          <div className="text-center p-2 rounded-md bg-secondary">
            <div className="text-muted-foreground">מסכתות הושלמו</div>
            <div className="font-bold text-base">
              {SHAS_BAVLI.filter((m) => totals.perMasechta[m.name].learned === totals.perMasechta[m.name].total).length}/{SHAS_BAVLI.length}
            </div>
          </div>
        </div>
      </Card>
      {BoardThemeEditor}

      <Tabs value={view} onValueChange={(v) => setView(v as any)}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <TabsList>
            <TabsTrigger value="hierarchy">לפי סדרים</TabsTrigger>
            <TabsTrigger value="flat">כל המסכתות</TabsTrigger>
            <TabsTrigger value="planner">תכנון לסיום</TabsTrigger>
            <TabsTrigger value="calendar">לוח שנה</TabsTrigger>
          </TabsList>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 border border-gold/40 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
                title="אפשרויות תצוגה"
                aria-label="אפשרויות תצוגה"
              >
                {view === "hierarchy"
                  ? hierarchyLayout === "cards"
                    ? <LayoutGrid className="h-4 w-4" />
                    : hierarchyLayout === "compact"
                      ? <Rows3 className="h-4 w-4" />
                      : hierarchyLayout === "kanban"
                        ? <Columns3 className="h-4 w-4" />
                        : <Table2 className="h-4 w-4" />
                  : view === "flat"
                    ? flatLayout === "grid"
                      ? <LayoutGrid className="h-4 w-4" />
                      : flatLayout === "compact"
                        ? <Rows3 className="h-4 w-4" />
                        : <Table2 className="h-4 w-4" />
                    : view === "planner"
                      ? plannerLayout === "rich"
                        ? <LayoutGrid className="h-4 w-4" />
                        : plannerLayout === "compact"
                          ? <Rows3 className="h-4 w-4" />
                          : <ListIcon className="h-4 w-4" />
                      : calendarLayout === "month"
                        ? <LayoutGrid className="h-4 w-4" />
                        : calendarLayout === "timeline"
                          ? <Rows3 className="h-4 w-4" />
                          : <Flag className="h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52 text-right">
              {view === "hierarchy" && (
                <>
                  <DropdownMenuLabel className="text-right">תצוגת סדרים</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setHierarchyLayout("cards")} className="gap-2 flex-row-reverse justify-end text-right">
                    כרטיסים {hierarchyLayout === "cards" ? "✓" : ""}
                    <LayoutGrid className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setHierarchyLayout("table")} className="gap-2 flex-row-reverse justify-end text-right">
                    טבלה {hierarchyLayout === "table" ? "✓" : ""}
                    <Table2 className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setHierarchyLayout("compact")} className="gap-2 flex-row-reverse justify-end text-right">
                    קומפקטי {hierarchyLayout === "compact" ? "✓" : ""}
                    <Rows3 className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setHierarchyLayout("kanban")} className="gap-2 flex-row-reverse justify-end text-right">
                    קאנבן {hierarchyLayout === "kanban" ? "✓" : ""}
                    <Columns3 className="h-4 w-4" />
                  </DropdownMenuItem>
                </>
              )}

              {view === "flat" && (
                <>
                  <DropdownMenuLabel className="text-right">תצוגת מסכתות</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setFlatLayout("grid")} className="gap-2 flex-row-reverse justify-end text-right">
                    רשת {flatLayout === "grid" ? "✓" : ""}
                    <LayoutGrid className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFlatLayout("table")} className="gap-2 flex-row-reverse justify-end text-right">
                    טבלה {flatLayout === "table" ? "✓" : ""}
                    <Table2 className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFlatLayout("compact")} className="gap-2 flex-row-reverse justify-end text-right">
                    קומפקטי {flatLayout === "compact" ? "✓" : ""}
                    <Rows3 className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-right">מיון</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setFlatSort("progress-desc")} className="justify-end text-right">
                    התקדמות: גבוה לנמוך {flatSort === "progress-desc" ? "✓" : ""}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFlatSort("progress-asc")} className="justify-end text-right">
                    התקדמות: נמוך לגבוה {flatSort === "progress-asc" ? "✓" : ""}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFlatSort("remaining-desc")} className="justify-end text-right">
                    נשאר: גבוה לנמוך {flatSort === "remaining-desc" ? "✓" : ""}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFlatSort("remaining-asc")} className="justify-end text-right">
                    נשאר: נמוך לגבוה {flatSort === "remaining-asc" ? "✓" : ""}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFlatSort("name-asc")} className="justify-end text-right">
                    שם: א-ת {flatSort === "name-asc" ? "✓" : ""}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFlatSort("name-desc")} className="justify-end text-right">
                    שם: ת-א {flatSort === "name-desc" ? "✓" : ""}
                  </DropdownMenuItem>
                </>
              )}

              {view === "planner" && (
                <>
                  <DropdownMenuLabel className="text-right">תצוגת תכנון</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setPlannerLayout("rich")} className="gap-2 flex-row-reverse justify-end text-right">
                    עשיר {plannerLayout === "rich" ? "✓" : ""}
                    <LayoutGrid className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPlannerLayout("compact")} className="gap-2 flex-row-reverse justify-end text-right">
                    קומפקטי {plannerLayout === "compact" ? "✓" : ""}
                    <Rows3 className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPlannerLayout("focus")} className="gap-2 flex-row-reverse justify-end text-right">
                    פוקוס {plannerLayout === "focus" ? "✓" : ""}
                    <ListIcon className="h-4 w-4" />
                  </DropdownMenuItem>
                </>
              )}

              {view === "calendar" && (
                <>
                  <DropdownMenuLabel className="text-right">תצוגת לוח שנה</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setCalendarLayout("month")} className="gap-2 flex-row-reverse justify-end text-right">
                    חודשי {calendarLayout === "month" ? "✓" : ""}
                    <LayoutGrid className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCalendarLayout("timeline")} className="gap-2 flex-row-reverse justify-end text-right">
                    ציר זמן {calendarLayout === "timeline" ? "✓" : ""}
                    <Rows3 className="h-4 w-4" />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCalendarLayout("milestones")} className="gap-2 flex-row-reverse justify-end text-right">
                    אבני דרך {calendarLayout === "milestones" ? "✓" : ""}
                    <Flag className="h-4 w-4" />
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <TabsContent value="hierarchy" className="space-y-3">
          {hierarchyLayout === "cards" && (
            <>
              {sederRows.map(({ sederName, s, pct, masechtotCount }) => (
                <Card key={sederName} onClick={() => setSelectedSeder(sederName)}
                  className="gold-frame p-4 cursor-pointer hover:shadow-elegant transition-all">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="gold-icon-circle"><Layers className="h-4 w-4" /></span>
                      <h3 className="font-display text-xl font-bold">סדר {sederName}</h3>
                      <Badge variant="secondary">{masechtotCount} מסכתות</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-gold/60">{s.learned}/{s.total} ({pct}%)</Badge>
                      {s.reps > 0 && <Badge variant="secondary" className="text-[10px]">חזרות: {s.reps}</Badge>}
                    </div>
                  </div>
                  <Progress value={pct} className="h-1.5 mt-2" />
                </Card>
              ))}
            </>
          )}

          {hierarchyLayout === "compact" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {sederRows.map(({ sederName, s, pct, masechtotCount }) => (
                <Card
                  key={sederName}
                  onClick={() => setSelectedSeder(sederName)}
                  className="gold-frame p-3 cursor-pointer hover:shadow-elegant transition-all"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-lg font-bold">סדר {sederName}</h3>
                    <Badge variant="outline" className="border-gold/60">{pct}%</Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {masechtotCount} מסכתות · {s.learned}/{s.total}
                  </div>
                  <Progress value={pct} className="h-1 mt-2" />
                </Card>
              ))}
            </div>
          )}

          {hierarchyLayout === "table" && (
            <Card className="gold-frame p-0 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>סדר</TableHead>
                    <TableHead>מסכתות</TableHead>
                    <TableHead>נלמד</TableHead>
                    <TableHead>אחוז</TableHead>
                    <TableHead>חזרות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sederRows.map(({ sederName, s, pct, masechtotCount }) => (
                    <TableRow
                      key={sederName}
                      onClick={() => setSelectedSeder(sederName)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-semibold">סדר {sederName}</TableCell>
                      <TableCell>{masechtotCount}</TableCell>
                      <TableCell>{s.learned}/{s.total}</TableCell>
                      <TableCell>{pct}%</TableCell>
                      <TableCell>{s.reps.toLocaleString("he-IL")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {hierarchyLayout === "kanban" && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              {[
                { id: "not-started", title: "לא התחיל", filter: (p: number) => p === 0 },
                { id: "in-progress", title: "בתהליך", filter: (p: number) => p > 0 && p < 40 },
                { id: "advanced", title: "מתקדם", filter: (p: number) => p >= 40 && p < 100 },
                { id: "done", title: "הושלם", filter: (p: number) => p === 100 },
              ].map((col) => {
                const rows = sederRows.filter((r) => col.filter(r.pct));
                return (
                  <Card key={col.id} className="gold-frame p-3 space-y-2 min-h-[220px]">
                    <div className="flex items-center justify-between">
                      <h4 className="font-display text-base font-bold">{col.title}</h4>
                      <Badge variant="secondary">{rows.length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {rows.map(({ sederName, s, pct, masechtotCount }) => (
                        <button
                          key={sederName}
                          type="button"
                          onClick={() => setSelectedSeder(sederName)}
                          className="w-full text-right rounded-md border border-gold/30 p-2 hover:border-gold/70 hover:bg-secondary/40 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">סדר {sederName}</span>
                            <span className="text-xs text-gold">{pct}%</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {masechtotCount} מסכתות · {s.learned}/{s.total}
                          </div>
                        </button>
                      ))}
                      {rows.length === 0 && (
                        <div className="text-xs text-muted-foreground p-2 border border-dashed border-gold/30 rounded-md">
                          אין פריטים כרגע
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="flat" className="space-y-2">
          {flatLayout === "grid" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {sortedMasechtot.map((m) => {
                const t = totals.perMasechta[m.name];
                const p = Math.round((t.learned / t.total) * 100);
                return (
                  <Card key={m.name} onClick={() => setSelectedMasechta(m.name)}
                    className="gold-frame p-3 cursor-pointer hover:shadow-elegant transition-all">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-display font-semibold">{m.name}</h4>
                        <div className="text-[11px] text-muted-foreground">{m.seder} · {m.pages} דפים</div>
                      </div>
                      <Badge variant="outline" className="border-gold/60">{p}%</Badge>
                    </div>
                    <Progress value={p} className="h-1 mt-2" />
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {t.learned}/{t.total}{t.reps > 0 ? ` · חזרות ${t.reps}` : ""}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {flatLayout === "compact" && (
            <div className="space-y-1">
              {sortedMasechtot.map((m) => {
                const t = totals.perMasechta[m.name];
                const p = Math.round((t.learned / t.total) * 100);
                return (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => setSelectedMasechta(m.name)}
                    className="w-full text-right rounded-md border border-gold/30 p-2 hover:border-gold/70 hover:bg-secondary/60 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{m.name}</span>
                      <span className="text-xs text-gold">{p}%</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{m.seder} · {t.learned}/{t.total}</div>
                  </button>
                );
              })}
            </div>
          )}

          {flatLayout === "table" && (
            <Card className="gold-frame p-0 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>מסכת</TableHead>
                    <TableHead>סדר</TableHead>
                    <TableHead>דפים</TableHead>
                    <TableHead>נלמד</TableHead>
                    <TableHead>אחוז</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedMasechtot.map((m) => {
                    const t = totals.perMasechta[m.name];
                    const p = Math.round((t.learned / t.total) * 100);
                    return (
                      <TableRow key={m.name} onClick={() => setSelectedMasechta(m.name)} className="cursor-pointer">
                        <TableCell className="font-semibold">{m.name}</TableCell>
                        <TableCell>{m.seder}</TableCell>
                        <TableCell>{m.pages}</TableCell>
                        <TableCell>{t.learned}/{t.total}</TableCell>
                        <TableCell>{p}%</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="planner">
          <ShasPlanner viewMode={plannerLayout} />
        </TabsContent>

        <TabsContent value="calendar">
          <ShasCalendar viewMode={calendarLayout} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Memoized amud cell — prevents re-rendering all 300 cells on every click.
type AmudButtonProps = {
  masechtaName: string;
  daf: number;
  amud: AmudKey;
  reps: number;
  isSel: boolean;
  onClick: (m: string, daf: number, a: AmudKey) => void;
  onRightClick: (e: React.MouseEvent, m: string, daf: number, a: AmudKey) => void;
  onToggleSel: (m: string, daf: number, a: AmudKey) => void;
};
const AmudButton = memo(function AmudButton({
  masechtaName, daf, amud, reps, isSel, onClick, onRightClick, onToggleSel,
}: AmudButtonProps) {
  const learned = reps > 0;
  return (
    <button
      onClick={() => onClick(masechtaName, daf, amud)}
      onContextMenu={(e) => onRightClick(e, masechtaName, daf, amud)}
      onDoubleClick={(e) => { e.preventDefault(); onToggleSel(masechtaName, daf, amud); }}
      className={cn(
        "relative h-11 rounded-md border-2 text-xs font-semibold transition-all flex flex-col items-center justify-center leading-tight",
        learned
          ? "bg-gradient-navy text-primary-foreground border-gold shadow-sm"
          : "bg-card text-foreground border-gold/30 hover:border-gold hover:bg-secondary",
        isSel && "ring-2 ring-gold ring-offset-1 ring-offset-background",
      )}
      title={`${masechtaName} ${heb(daf)} ${amud === "a" ? "ע״א" : "ע״ב"} — ${reps > 0 ? `נלמד ${reps}×` : "לא נלמד"} (לחיצה: +1, ימני: -1, דבל-קליק: בחירה)`}
    >
      <span className="text-[11px]">{heb(daf)}{amud === "a" ? "." : ":"}</span>
      {reps > 0 && (
        <span className={cn(
          "absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center",
          reps >= 3 ? "bg-amber-500 text-black" : "bg-gold text-primary-foreground",
        )}>
          {reps}
        </span>
      )}
    </button>
  );
});
