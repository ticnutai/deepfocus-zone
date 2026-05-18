/**
 * CategoryManager — view switcher + all category views.
 *
 * ⚠️  DO NOT SIMPLIFY THIS FILE INTO A STUB.
 * All 5 views are intentionally implemented and used:
 *   browse   → CategoryBrowseView   (chips + card rows)
 *   explorer → CategoryExplorerView (file-browser with zoom & templates)
 *   list     → CategoryListView     (flat sorted list)
 *   cards    → CategoryCardsView    (folder grid)
 *   mindmap  → CategoryMindmapView  (radial hierarchy)
 * Collapsing to a single-view stub silently discards working views.
 */
import { useEffect, useState } from "react";
import { CategoryViewSwitcher, type CategoryViewMode } from "./CategoryViewSwitcher";
import { CategoryExplorerView } from "./CategoryExplorerView";
import { CategoryBrowseView } from "./CategoryBrowseView";
import { CategoryListView, CategoryCardsView, CategoryMindmapView } from "./CategoryViews";
import { useStudy } from "@/lib/study/store";
import type { Card as StudyCard } from "@/lib/study/types";

interface Props {
  selectedCategory: string | null;
  onSelectCategory: (name: string | null) => void;
  onAddCardToCategory?: (categoryName: string) => void;
  onEditCard?: (card: StudyCard) => void;
  expanded?: boolean;
  activeDeckId?: string | null;
  onStudyCategory?: (categoryName: string) => void;
  onStudyMultipleCategories?: (catNames: string[], filter?: "all" | "due" | "failed") => void;
  onStudyCardIds?: (ids: string[]) => void;
  onQuickRun?: (categoryId: string, categoryName: string) => void;
}

const VIEW_MODE_KEY = "cat-view-mode-v1";
const VALID_VIEWS: CategoryViewMode[] = ["browse", "explorer", "list", "cards", "mindmap"];

export function CategoryManager({
  selectedCategory, onSelectCategory, onAddCardToCategory,
  onEditCard, activeDeckId, onStudyCategory, onStudyMultipleCategories, onStudyCardIds,
}: Props) {
  const { state, setUiPref } = useStudy();
  const cloudView = state.uiPrefs?.categoryViewMode;

  const [viewMode, setViewMode] = useState<CategoryViewMode>(() => {
    if (cloudView && VALID_VIEWS.includes(cloudView)) return cloudView;
    if (typeof window === "undefined") return "explorer";
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return (VALID_VIEWS.includes(v as CategoryViewMode) ? v : "explorer") as CategoryViewMode;
  });

  // Sync from cloud when it changes (e.g. on another device)
  useEffect(() => {
    if (cloudView && VALID_VIEWS.includes(cloudView) && cloudView !== viewMode) {
      setViewMode(cloudView);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudView]);

  const addCard = onAddCardToCategory ?? (() => {});

  const handleViewChange = (v: CategoryViewMode) => {
    setViewMode(v);
    try { localStorage.setItem(VIEW_MODE_KEY, v); } catch { /* noop */ }
    setUiPref("categoryViewMode", v);
  };

  return (
    <div dir="rtl" className="space-y-2">
      {/* View switcher — always visible so user can switch at any time */}
      <div className="flex justify-end">
        <CategoryViewSwitcher value={viewMode} onChange={handleViewChange} />
      </div>

      {viewMode === "explorer" && (
        <CategoryExplorerView
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          onAddCardToCategory={addCard}
          onEditCard={onEditCard}
          activeDeckId={activeDeckId}
          onStudyCategory={onStudyCategory}
          onStudyMultipleCategories={onStudyMultipleCategories}
          onStudyCardIds={onStudyCardIds}
        />
      )}
      {viewMode === "browse" && (
        <CategoryBrowseView onAddCardToCategory={addCard} onEditCard={onEditCard} />
      )}
      {viewMode === "list" && (
        <CategoryListView
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          onAddCardToCategory={addCard}
        />
      )}
      {viewMode === "cards" && (
        <CategoryCardsView
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          onAddCardToCategory={addCard}
        />
      )}
      {viewMode === "mindmap" && (
        <CategoryMindmapView
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          onAddCardToCategory={addCard}
        />
      )}
    </div>
  );
}
