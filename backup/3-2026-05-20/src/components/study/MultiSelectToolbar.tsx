/**
 * MultiSelectToolbar — floating action bar that appears when items are selected.
 *
 * Usage:
 *   <MultiSelectToolbar
 *     count={ms.count}
 *     total={ms.total}
 *     allSelected={ms.allSelected}
 *     onToggleAll={ms.toggleAll}
 *     onClear={ms.clear}
 *     actions={[
 *       { icon: Trash2, label: "מחק", onClick: handleDelete, variant: "destructive" },
 *       { icon: Copy, label: "שכפל", onClick: handleDuplicate },
 *     ]}
 *   />
 */
import { Button } from "@/components/ui/button";
import { CheckSquare, Square, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToolbarAction {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant?: "default" | "destructive" | "outline" | "secondary";
  disabled?: boolean;
}

interface MultiSelectToolbarProps {
  count: number;
  total: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  actions?: ToolbarAction[];
  /** Always show toolbar even when nothing is selected (shows just the select-all button). Default false. */
  alwaysVisible?: boolean;
  className?: string;
  /** Sticky position class (default: top-0). Use 'top-16' if there's a header. */
  stickyTop?: string;
}

export function MultiSelectToolbar({
  count,
  total,
  allSelected,
  onToggleAll,
  onClear,
  actions = [],
  alwaysVisible = false,
  className,
  stickyTop = "top-0",
}: MultiSelectToolbarProps) {
  const anySelected = count > 0;

  if (!anySelected && !alwaysVisible) {
    // Always show the bare select-all button — minimal, non-sticky
    return (
      <div className={cn("flex items-center gap-2 px-2 py-1.5", className)}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleAll}
          className="gap-2 text-xs text-muted-foreground hover:text-gold"
        >
          <Square className="h-4 w-4" />
          בחר הכל ({total})
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "sticky z-20 -mx-2 px-2",
        stickyTop,
        anySelected && "animate-slide-in-down",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-gold/60 bg-card/95 backdrop-blur-md p-2 shadow-lg">
        {/* Select-all toggle */}
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleAll}
          className={cn(
            "gap-2 border-gold/40 shrink-0",
            allSelected && "bg-gold/20 text-gold border-gold/70",
          )}
        >
          {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          {allSelected ? "נקה הכל" : "בחר הכל"}
        </Button>

        {/* Counter */}
        {anySelected && (
          <div className="text-sm font-medium text-foreground px-2 shrink-0">
            <span className="text-gold font-bold">{count.toLocaleString("he-IL")}</span>
            <span className="text-muted-foreground"> / {total.toLocaleString("he-IL")} נבחרו</span>
          </div>
        )}

        {/* Action buttons */}
        {anySelected && actions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mr-auto">
            {actions.map((action, i) => {
              const Icon = action.icon;
              return (
                <Button
                  key={i}
                  variant={action.variant ?? "outline"}
                  size="sm"
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className="gap-1.5"
                  title={action.label}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{action.label}</span>
                </Button>
              );
            })}
          </div>
        )}

        {/* Clear button (X) */}
        {anySelected && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="gap-1 text-muted-foreground hover:text-destructive shrink-0"
            title="בטל בחירה"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
