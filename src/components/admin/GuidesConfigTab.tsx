import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DndContext, type DragEndEvent, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { Save, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SortableConfigItem } from "@/components/study/SortableConfigItem";
import { GUIDE_TOPICS } from "@/lib/onboarding/guideTopics";
import { loadGuidesConfig, saveGuidesConfig, applyGuidesConfig, type GuideConfigEntry } from "@/lib/onboarding/guidesAdminConfig";

export function GuidesConfigTab() {
  const [items, setItems] = useState(() => GUIDE_TOPICS.map((t) => ({ id: t.id, label: t.title, icon: t.icon, visible: true })));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    let cancelled = false;
    void loadGuidesConfig().then((config) => {
      if (cancelled) return;
      if (config.length === 0) {
        setLoading(false);
        return;
      }
      const orderedIds = applyGuidesConfig(GUIDE_TOPICS.map((t) => t.id), config.map((c) => ({ ...c, visible: true })));
      const byId = new Map(GUIDE_TOPICS.map((t) => [t.id, t]));
      const visibleSet = new Set(config.filter((c) => c.visible).map((c) => c.id));
      const ordered = orderedIds
        .map((id) => byId.get(id))
        .filter((t): t is (typeof GUIDE_TOPICS)[number] => !!t)
        .map((t) => ({ id: t.id, label: t.title, icon: t.icon, visible: visibleSet.has(t.id) }));
      setItems(ordered);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIdx = prev.findIndex((i) => i.id === active.id);
      const newIdx = prev.findIndex((i) => i.id === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const toggle = (id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const entries: GuideConfigEntry[] = items.map((item, order) => ({ id: item.id, visible: item.visible, order }));
      await saveGuidesConfig(entries);
      toast.success("הגדרות המדריכים נשמרו — יחולו על כל המשתמשים.");
    } catch (err) {
      toast.error("שמירת הגדרות המדריכים נכשלה: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = () => {
    setItems(GUIDE_TOPICS.map((t) => ({ id: t.id, label: t.title, icon: t.icon, visible: true })));
  };

  if (loading) {
    return (
      <Card className="gold-frame p-6 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> טוען הגדרות מדריכים…
      </Card>
    );
  }

  return (
    <Card className="gold-frame p-4 space-y-4" dir="rtl">
      <div className="text-right">
        <h3 className="font-display text-lg font-semibold">מדריכי כניסה ראשונה</h3>
        <p className="text-sm text-muted-foreground">
          בחר אילו מדריכים יופיעו בפאנל הכניסה הראשונה של כל המשתמשים, ובאיזה סדר (גרור לשינוי סדר).
        </p>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1 rounded-xl border-2 border-gold/30 p-2">
            {items.map((item) => (
              <SortableConfigItem
                key={item.id}
                item={item}
                visible={item.visible}
                onToggle={() => toggle(item.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving} className="gap-2 bg-gradient-navy text-primary-foreground">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          שמור לכל המשתמשים
        </Button>
        <Button variant="outline" onClick={resetToDefault} className="gap-2">
          <RotateCcw className="h-4 w-4" /> אפס לברירת מחדל
        </Button>
      </div>
    </Card>
  );
}
