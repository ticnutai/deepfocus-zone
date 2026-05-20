/**
 * useMultiSelect — reusable multi-selection hook
 *
 * Usage:
 *   const ms = useMultiSelect(items, (item) => item.id);
 *   <Checkbox checked={ms.isSelected(item.id)} onCheckedChange={() => ms.toggle(item.id)} />
 *   <Button onClick={ms.toggleAll}>{ms.allSelected ? "נקה הכל" : "בחר הכל"}</Button>
 */
import { useState, useMemo, useCallback } from "react";

export interface MultiSelect<T> {
  selected: Set<string>;
  selectedItems: T[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectOnly: (id: string) => void;
  /** Toggle: if all are selected → clear; otherwise → select all */
  toggleAll: () => void;
  selectAll: () => void;
  clear: () => void;
  count: number;
  total: number;
  allSelected: boolean;
  anySelected: boolean;
}

export function useMultiSelect<T>(
  items: T[],
  getId: (item: T) => string,
): MultiSelect<T> {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allIds = useMemo(() => items.map(getId), [items, getId]);
  const idToItem = useMemo(() => {
    const m = new Map<string, T>();
    for (const it of items) m.set(getId(it), it);
    return m;
  }, [items, getId]);

  const selectedItems = useMemo(
    () => Array.from(selected).map((id) => idToItem.get(id)).filter(Boolean) as T[],
    [selected, idToItem],
  );

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectOnly = useCallback((id: string) => {
    setSelected(new Set([id]));
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(allIds));
  }, [allIds]);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const allSelected = selected.size > 0 && selected.size >= allIds.length;
  const anySelected = selected.size > 0;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }, [allSelected, allIds]);

  return {
    selected,
    selectedItems,
    isSelected,
    toggle,
    selectOnly,
    toggleAll,
    selectAll,
    clear,
    count: selected.size,
    total: allIds.length,
    allSelected,
    anySelected,
  };
}
