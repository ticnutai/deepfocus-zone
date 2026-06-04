import { useState } from "react";
import { Sparkles, Check, Plus, Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useStudy } from "@/lib/study/store";
import { CATEGORY_TEMPLATES } from "@/lib/study/categoryTemplates";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CategoryTemplateEditor } from "./CategoryTemplateEditor";
import type { CategoryTemplateNodeData, CustomCategoryTemplate } from "@/lib/study/types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function CategoryTemplatesDialog({ open, onOpenChange }: Props) {
  const { state, addCategoriesBulk, deleteCustomTemplate } = useStudy();
  const [busy, setBusy] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CustomCategoryTemplate | null>(null);
  const customs = state.customCategoryTemplates ?? [];

  const apply = async (id: string, title: string, roots: CategoryTemplateNodeData[]) => {
    // בדיקה: אם השורש (העליון) של התבנית כבר קיים — חוסם
    const existingRoots = (state.categories ?? []).filter((c) => c.parentId === null);
    const conflict = roots.find((r) => existingRoots.some((c) => c.name === r.name));
    if (conflict) {
      toast({
        variant: "destructive",
        title: "הקטגוריה כבר קיימת",
        description: `"${conflict.name}" כבר קיימת. מחק אותה תחילה אם תרצה ליצור מחדש.`,
      });
      return;
    }
    setBusy(`${id}:all`);
    try {
      const created = addCategoriesBulk(roots, null);
      toast({ title: "נוצרו בהצלחה", description: `נוספו ${created} קטגוריות מהתבנית "${title}".` });
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  const openNew = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (t: CustomCategoryTemplate) => { setEditing(t); setEditorOpen(true); };

  return (
   <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-row-reverse items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 text-right">
              <Sparkles className="h-5 w-5 text-gold" />
              תבניות קטגוריות
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={openNew} className="bg-gradient-navy text-primary-foreground gap-1">
                <Plus className="h-4 w-4" /> תבנית חדשה
              </Button>
            </div>
          </div>
          <DialogDescription className="text-right">
            בחר תבנית מוכנה, צור תבנית אישית, או ערוך תבנית קיימת. אפשר להפעיל כמה שתרצה.
          </DialogDescription>
        </DialogHeader>

        {customs.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-gold text-right">התבניות שלי</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {customs.map((tpl) => {
                const childCount = tpl.roots.reduce((sum, r) => sum + (r.children?.length ?? 0), 0);
                return (
                  <Card key={tpl.id} className="p-4 border-2 border-gold/40 bg-gold/5 space-y-2 text-right">
                    <div className="flex flex-row-reverse items-start justify-between gap-2">
                      <Badge variant="outline" className="border-gold/50 text-[10px]">
                        {tpl.roots.length} ראשיות · {childCount} פריטים
                      </Badge>
                      <div className="flex items-center gap-2">
                        <h4 className="font-display font-bold text-base">{tpl.title}</h4>
                        <span className="text-2xl">{tpl.emoji ?? "📁"}</span>
                      </div>
                    </div>
                    {tpl.description && (
                      <p className="text-xs text-muted-foreground leading-snug">{tpl.description}</p>
                    )}
                    <div className="flex flex-row-reverse justify-between gap-1 pt-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => openEdit(tpl)} className="h-7 px-2 gap-1">
                          <Pencil className="h-3 w-3" /> ערוך
                        </Button>
                        <Button size="sm" variant="outline"
                          onClick={() => { if (confirm(`למחוק את "${tpl.title}"?`)) deleteCustomTemplate(tpl.id); }}
                          className="h-7 px-2 gap-1 text-destructive border-destructive/40">
                          <Trash2 className="h-3 w-3" /> מחק
                        </Button>
                      </div>
                      <Button size="sm" onClick={() => apply(tpl.id, tpl.title, tpl.roots)}
                        disabled={busy !== null} className="bg-gradient-navy text-primary-foreground h-7 gap-1">
                        <Check className="h-3.5 w-3.5" /> {busy === `${tpl.id}:all` ? "יוצר..." : "צור"}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h4 className="text-xs font-bold text-muted-foreground text-right pt-2">תבניות מוכנות</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {CATEGORY_TEMPLATES.map((tpl) => {
            const childCount = tpl.roots.reduce((sum, r) => sum + (r.children?.length ?? 0), 0);
            return (
              <Card
                key={tpl.id}
                className={cn(
                  "p-4 border-2 border-gold/30 hover:border-gold/70 transition-all space-y-2 text-right",
                )}
              >
                <div className="flex flex-row-reverse items-start justify-between gap-2">
                  <Badge variant="outline" className="border-gold/50 text-[10px]">
                    {tpl.roots.length} ראשיות · {childCount} פריטים
                  </Badge>
                  <div className="flex items-center gap-2">
                    <h4 className="font-display font-bold text-base">{tpl.title}</h4>
                    <span className="text-2xl">{tpl.emoji}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">{tpl.description}</p>
                <div className="flex flex-wrap gap-1 justify-end">
                  {tpl.roots.slice(0, 6).map((r) => (
                    <Badge key={r.name} className="bg-secondary text-foreground text-[10px]">{r.name}</Badge>
                  ))}
                </div>
                <div className="flex justify-end pt-2 gap-2">
                  <Button
                    size="sm"
                    onClick={() => apply(tpl.id, tpl.title, tpl.roots)}
                    disabled={busy !== null}
                    className="bg-gradient-navy text-primary-foreground gap-1"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {busy === `${tpl.id}:all` ? "יוצר..." : "צור"}
                  </Button>
                </div>
              </Card>
            );
            })}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground text-right pt-2 border-t border-gold/20">
          💡 התבנית יוצרת קטגוריה ראשית אחת ומתחתיה את כל העץ. אם השם כבר קיים — מחק אותו תחילה.
        </p>
      </DialogContent>
    </Dialog>
    <CategoryTemplateEditor
      open={editorOpen}
      onOpenChange={setEditorOpen}
      initial={editing}
      seed={null}
    />
   </>
  );
}
