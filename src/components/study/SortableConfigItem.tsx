import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

export type SortableConfigDef = { id: string; label: string; icon: typeof GripVertical };

/**
 * One draggable, checkbox-toggleable row — shared by every "reorder + show/hide"
 * admin config list in the app (sidebar, tabs, guides, ...).
 */
export function SortableConfigItem({
  item,
  visible,
  onToggle,
  toggleDisabled = false,
}: {
  item: SortableConfigDef;
  visible: boolean;
  onToggle: () => void;
  toggleDisabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const Icon = item.icon;
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary">
      <span className="text-sm flex-1 text-right">{item.label}</span>
      <Icon className="h-4 w-4 text-navy" />
      <input
        type="checkbox"
        checked={visible}
        onChange={onToggle}
        disabled={toggleDisabled}
        className="h-4 w-4 accent-[hsl(var(--gold))] disabled:opacity-60 disabled:cursor-not-allowed"
      />
      <button {...listeners} {...attributes} className="cursor-grab text-muted-foreground touch-none"><GripVertical className="h-4 w-4" /></button>
    </div>
  );
}
