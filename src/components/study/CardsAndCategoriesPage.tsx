import { useEffect, useState, useRef, memo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FolderTree, BookOpen, CircleHelp } from "lucide-react";
import { CardsManager } from "./CardsManager";
import { CategoriesPage } from "./CategoriesPage";
import { QuestionCreationPage } from "./QuestionCreationPage";
import { debugLog } from "@/lib/debug/perf";

type SubTab = "categories" | "decks" | "questions";
const STORAGE_KEY = "cards-categories:sub-tab";
const STORAGE_VISITED_KEY = "cards-categories:visited-tabs";
const ENABLE_TAB_SWITCH_PERF = import.meta.env.DEV;

const percentile = (vals: number[], p: number): number => {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

/**
 * Unified shell section that merges the former "Categories" and
 * "Review questions" sidebar tabs into a single screen with two
 * internal sub-tabs. Both legacy components are reused as-is — no
 * logic duplication.
 */
function CardsAndCategoriesPage({ initialTab }: { initialTab?: SubTab }) {
  const [tab, setTab] = useState<SubTab>(() => {
    if (initialTab) return initialTab;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "categories" || saved === "decks" || saved === "questions") return saved;
      if (saved === "cards") return "decks";
    } catch { /* ignore */ }
    return "categories";
  });

  const [visited, setVisited] = useState<Set<SubTab>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const active: SubTab = saved === "decks" || saved === "questions"
        ? saved
        : saved === "cards"
          ? "decks"
          : "categories";
      return new Set<SubTab>([active]);
    } catch { return new Set<SubTab>(["categories"]); }
  });

  const tabSwitchStartRef = useRef<number | null>(null);
  const tabSwitchFromRef = useRef<SubTab>(tab);
  const tabSwitchSamplesRef = useRef<number[]>([]);

  useEffect(() => {
    if (initialTab && initialTab !== tab) { setTab(initialTab); setVisited((s) => { const n = new Set(s); n.add(initialTab); return n; }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, tab); } catch { /* ignore */ }
  }, [tab]);

  const switchTab = (v: SubTab) => {
    if (v === tab) return;
    if (ENABLE_TAB_SWITCH_PERF) {
      tabSwitchStartRef.current = performance.now();
      tabSwitchFromRef.current = tab;
    }
    setTab(v);
    setVisited((s) => { const n = new Set(s); n.add(v); return n; });
  };

  useEffect(() => {
    if (!ENABLE_TAB_SWITCH_PERF) return;
    const startedAt = tabSwitchStartRef.current;
    if (startedAt == null) return;

    let raf1 = 0;
    let raf2 = 0;

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        const durationMs = performance.now() - startedAt;
        tabSwitchStartRef.current = null;

        const nextSamples = [...tabSwitchSamplesRef.current, durationMs].slice(-40);
        tabSwitchSamplesRef.current = nextSamples;

        const avgMs = nextSamples.reduce((sum, n) => sum + n, 0) / nextSamples.length;
        const p95Ms = percentile(nextSamples, 95);
        const fromTab = tabSwitchFromRef.current;
        const toTab = tab;

        debugLog.record(
          "ui:cards-categories:tab-switch",
          "other",
          Math.round(durationMs),
          `from=${fromTab} to=${toTab} avg=${avgMs.toFixed(1)}ms p95=${p95Ms.toFixed(1)}ms n=${nextSamples.length}`,
        );
      });
    });

    return () => {
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [tab]);

  return (
    <div dir="rtl" className="space-y-4">
      <div className="text-right space-y-1 animate-fade-in">
        <h1 className="font-display text-2xl font-bold text-gold">קטגוריות ושאלות</h1>
        <p className="text-muted-foreground text-sm">
          ניהול קטגוריות, מערכות ושאלות חזרה במקום אחד
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => switchTab(v as SubTab)}>
        <TabsList className="grid h-auto w-full max-w-2xl grid-cols-1 gap-1 mx-auto sm:grid-cols-3">
          <TabsTrigger value="categories" className="gap-2">
            <FolderTree className="h-4 w-4" />
            קטגוריות
          </TabsTrigger>
          <TabsTrigger value="decks" className="gap-2">
            <BookOpen className="h-4 w-4" />
            יצירת מערכת מבחנים
          </TabsTrigger>
          <TabsTrigger value="questions" className="gap-2">
            <CircleHelp className="h-4 w-4" />
            יצירת שאלות
          </TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="mt-4" forceMount>
          {visited.has("categories") && <CategoriesPage />}
        </TabsContent>
        <TabsContent value="decks" className="mt-4" forceMount>
          {visited.has("decks") && <CardsManager />}
        </TabsContent>
        <TabsContent value="questions" className="mt-4" forceMount>
          {visited.has("questions") && <QuestionCreationPage />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

const CardsAndCategoriesPageMemo = memo(CardsAndCategoriesPage);
export { CardsAndCategoriesPageMemo as CardsAndCategoriesPage };
