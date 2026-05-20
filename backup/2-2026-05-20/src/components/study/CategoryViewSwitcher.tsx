// ⚠️  DO NOT REMOVE VIEWS FROM THIS LIST.
// All 5 views are implemented and actively used:
//   browse   → CategoryBrowseView    list → CategoryListView
//   explorer → CategoryExplorerView  cards → CategoryCardsView
//                                    mindmap → CategoryMindmapView  (CategoryViews.tsx)
import { FolderOpen, LayoutList, List, LayoutGrid, Network } from "lucide-react";
import { cn } from "@/lib/utils";

export type CategoryViewMode = "browse" | "explorer" | "list" | "cards" | "mindmap";

const VIEWS: { id: CategoryViewMode; icon: typeof FolderOpen; label: string }[] = [
  { id: "browse",   icon: LayoutList, label: "שורות + שאלות" },
  { id: "explorer", icon: FolderOpen, label: "סייר קבצים" },
  { id: "list",     icon: List,       label: "רשימה" },
  { id: "cards",    icon: LayoutGrid, label: "כרטיסיות" },
  { id: "mindmap",  icon: Network,    label: "מפת חשיבה" },
];

interface Props {
  value: CategoryViewMode;
  onChange: (v: CategoryViewMode) => void;
}

export function CategoryViewSwitcher({ value, onChange }: Props) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border-2 border-gold/40 bg-card p-0.5" dir="rtl">
      {VIEWS.map((v) => {
        const Icon = v.icon;
        const active = value === v.id;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onChange(v.id)}
            title={v.label}
            aria-label={v.label}
            className={cn(
              "h-8 w-8 rounded-md flex items-center justify-center transition-all",
              active
                ? "bg-gradient-navy text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary",
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
