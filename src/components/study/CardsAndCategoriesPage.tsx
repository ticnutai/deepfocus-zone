import { memo, useEffect, useState, type ComponentType } from "react";
import { BookOpen, CircleHelp, FolderTree } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CardsManager } from "./CardsManager";
import { CategoriesPage } from "./CategoriesPage";
import { QuestionCreationPage } from "./QuestionCreationPage";

type SubTab = "categories" | "decks" | "questions";
const STORAGE_KEY = "cards-categories:sub-tab";

const PAGE_META: Record<SubTab, {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = {
  categories: {
    title: "קטגוריות",
    description: "יצירה, סידור וניהול של עץ הקטגוריות ותתי־הקטגוריות.",
    icon: FolderTree,
  },
  decks: {
    title: "יצירת מבחנים",
    description: "בניית מבחנים מהשאלות והקטגוריות שכבר קיימות במערכת.",
    icon: BookOpen,
  },
  questions: {
    title: "יצירת שאלות",
    description: "הוספת שאלות חדשות, תשובות וסיווגן במקום הנכון.",
    icon: CircleHelp,
  },
};

const readInitialPage = (initialTab?: SubTab): SubTab => {
  try {
    const fromUrl = new URL(window.location.href).searchParams.get("workspace");
    if (fromUrl === "categories" || fromUrl === "decks" || fromUrl === "questions") return fromUrl;
    if (initialTab) return initialTab;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "categories" || saved === "decks" || saved === "questions") return saved;
  } catch { /* use default */ }
  return "categories";
};

function CardsAndCategoriesPage({ initialTab }: { initialTab?: SubTab }) {
  const [page, setPage] = useState<SubTab>(() => readInitialPage(initialTab));
  const meta = PAGE_META[page];
  const PageIcon = meta.icon;

  useEffect(() => {
    if (initialTab) setPage(initialTab);
  }, [initialTab]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, page); } catch { /* ignore */ }
  }, [page]);

  useEffect(() => {
    const onPopState = () => setPage(readInitialPage(initialTab));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [initialTab]);

  const openPage = (next: SubTab) => {
    if (next === page) return;
    setPage(next);
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", next);
    window.history.pushState({}, "", url);
  };

  return (
    <div dir="rtl" className="space-y-5">
      <Card className="gold-frame overflow-hidden bg-card/95 p-2 shadow-sm">
        <nav aria-label="עמודי קטגוריות, מבחנים ושאלות" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(Object.keys(PAGE_META) as SubTab[]).map((key) => {
            const item = PAGE_META[key];
            const Icon = item.icon;
            const active = page === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => openPage(key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex min-h-16 items-center justify-center gap-3 rounded-xl border-2 px-4 py-3 text-base font-semibold transition-all",
                  active
                    ? "border-navy bg-gradient-navy text-primary-foreground shadow-md"
                    : "border-transparent bg-secondary/45 text-muted-foreground hover:border-gold/50 hover:bg-gold/10 hover:text-navy",
                )}
              >
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-full border", active ? "border-gold/70 text-gold" : "border-gold/40 bg-card text-navy")}>
                  <Icon className="h-5 w-5" />
                </span>
                {item.title}
              </button>
            );
          })}
        </nav>
      </Card>

      <header className="rounded-2xl border-2 border-gold/35 bg-gradient-to-l from-gold/10 via-card to-card p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-card text-gold shadow-sm">
            <PageIcon className="h-7 w-7" />
          </span>
          <div className="text-right">
            <h1 className="font-display text-2xl font-bold text-foreground">{meta.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
          </div>
        </div>
      </header>

      <main key={page} className="animate-fade-in">
        {page === "categories" && <CategoriesPage />}
        {page === "decks" && <CardsManager />}
        {page === "questions" && <QuestionCreationPage />}
      </main>
    </div>
  );
}

const CardsAndCategoriesPageMemo = memo(CardsAndCategoriesPage);
export { CardsAndCategoriesPageMemo as CardsAndCategoriesPage };
