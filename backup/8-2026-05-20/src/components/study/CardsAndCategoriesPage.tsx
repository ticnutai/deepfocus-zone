import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FolderTree, BookOpen } from "lucide-react";
import { CardsManager } from "./CardsManager";
import { CategoriesPage } from "./CategoriesPage";

type SubTab = "categories" | "cards";
const STORAGE_KEY = "cards-categories:sub-tab";
const STORAGE_VISITED_KEY = "cards-categories:visited-tabs";

/**
 * Unified shell section that merges the former "Categories" and
 * "Review questions" sidebar tabs into a single screen with two
 * internal sub-tabs. Both legacy components are reused as-is — no
 * logic duplication.
 */
export function CardsAndCategoriesPage({ initialTab }: { initialTab?: SubTab }) {
  const [tab, setTab] = useState<SubTab>(() => {
    if (initialTab) return initialTab;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "categories" || saved === "cards") return saved;
    } catch { /* ignore */ }
    return "categories";
  });

  const [visited, setVisited] = useState<Set<SubTab>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const active: SubTab = (saved === "categories" || saved === "cards") ? saved : "categories";
      return new Set<SubTab>([active]);
    } catch { return new Set<SubTab>(["categories"]); }
  });

  useEffect(() => {
    if (initialTab && initialTab !== tab) { setTab(initialTab); setVisited((s) => { const n = new Set(s); n.add(initialTab); return n; }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, tab); } catch { /* ignore */ }
  }, [tab]);

  const switchTab = (v: SubTab) => {
    setTab(v);
    setVisited((s) => { const n = new Set(s); n.add(v); return n; });
  };

  return (
    <div dir="rtl" className="space-y-4">
      <div className="text-right space-y-1 animate-fade-in">
        <h1 className="font-display text-2xl font-bold text-gold">קטגוריות ושאלות</h1>
        <p className="text-muted-foreground text-sm">
          ניהול קטגוריות, מערכות ושאלות חזרה במקום אחד
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => switchTab(v as SubTab)}>
        <TabsList className="grid grid-cols-2 w-full max-w-md mx-auto">
          <TabsTrigger value="categories" className="gap-2">
            <FolderTree className="h-4 w-4" />
            קטגוריות
          </TabsTrigger>
          <TabsTrigger value="cards" className="gap-2">
            <BookOpen className="h-4 w-4" />
            שאלות חזרה
          </TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="mt-4">
          {visited.has("categories") && <CategoriesPage />}
        </TabsContent>
        <TabsContent value="cards" className="mt-4">
          {visited.has("cards") && <CardsManager />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
