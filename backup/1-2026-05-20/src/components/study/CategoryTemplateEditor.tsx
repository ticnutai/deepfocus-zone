import { useState, useEffect } from "react";
import { Plus, Trash2, ChevronDown, ChevronLeft, FolderTree } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useStudy } from "@/lib/study/store";
import { toast } from "@/hooks/use-toast";
import type { CategoryTemplateNodeData, CustomCategoryTemplate } from "@/lib/study/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: CustomCategoryTemplate | null;
  /** When provided, used instead of `initial` to seed an editable copy of a built-in template. */
  seed?: { title: string; description?: string; emoji?: string; roots: CategoryTemplateNodeData[] } | null;
}

type Node = CategoryTemplateNodeData & { _id: string; _open?: boolean };

let _nid = 0;
const nid = () => `n${++_nid}_${Date.now().toString(36)}`;
const decorate = (n: CategoryTemplateNodeData): Node => ({
  ...n,
  _id: nid(),
  _open: true,
  children: n.children?.map(decorate),
});
const strip = (n: Node): CategoryTemplateNodeData => ({
  name: n.name.trim(),
  children: n.children?.length ? n.children.map(strip) : undefined,
});

export function CategoryTemplateEditor({ open, onOpenChange, initial, seed }: Props) {
  const { addCustomTemplate, updateCustomTemplate } = useStudy();
  const isEdit = !!initial;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("📁");
  const [roots, setRoots] = useState<Node[]>([]);

  useEffect(() => {
    if (!open) return;
    const src = initial ?? seed;
    setTitle(src?.title ?? "");
    setDescription(src?.description ?? "");
    setEmoji(src?.emoji ?? "📁");
    setRoots((src?.roots ?? [{ name: "" }]).map(decorate));
  }, [open, initial, seed]);

  // immutable tree update by _id
  const map = (list: Node[], id: string, fn: (n: Node) => Node | null): Node[] =>
    list.flatMap((n) => {
      if (n._id === id) {
        const r = fn(n);
        return r ? [r] : [];
      }
      return [{ ...n, children: n.children ? (map(n.children as Node[], id, fn) as Node[]) : n.children }];
    });

  const updateNode = (id: string, patch: Partial<Node>) =>
    setRoots((r) => map(r, id, (n) => ({ ...n, ...patch })));
  const deleteNode = (id: string) =>
    setRoots((r) => map(r, id, () => null));
  const addChild = (id: string) =>
    setRoots((r) => map(r, id, (n) => ({
      ...n,
      _open: true,
      children: [...((n.children as Node[]) ?? []), decorate({ name: "" })],
    })));
  const addRoot = () => setRoots((r) => [...r, decorate({ name: "" })]);

  const handleSave = () => {
    const t = title.trim();
    if (!t) { toast({ title: "צריך כותרת לתבנית", variant: "destructive" }); return; }
    const cleaned = roots.map(strip).filter((n) => n.name);
    if (cleaned.length === 0) {
      toast({ title: "הוסף לפחות פריט אחד", variant: "destructive" });
      return;
    }
    const payload = { title: t, description: description.trim() || undefined, emoji: emoji.trim() || "📁", roots: cleaned };
    if (isEdit && initial) {
      updateCustomTemplate(initial.id, payload);
      toast({ title: "התבנית עודכנה" });
    } else {
      addCustomTemplate(payload);
      toast({ title: "התבנית נוצרה" });
    }
    onOpenChange(false);
  };

  const renderNode = (n: Node, depth: number) => {
    const hasKids = (n.children?.length ?? 0) > 0;
    return (
      <div key={n._id}>
        <div
          className="flex items-center gap-1 group rounded-md hover:bg-secondary py-1 px-1"
          style={{ paddingRight: `${depth * 16}px` }}
        >
          {hasKids ? (
            <button onClick={() => updateNode(n._id, { _open: !n._open })} className="opacity-60 hover:opacity-100">
              {n._open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
            </button>
          ) : <span className="w-3.5" />}
          <Input
            value={n.name}
            onChange={(e) => updateNode(n._id, { name: e.target.value })}
            placeholder="שם הפריט"
            className="h-7 text-sm border-gold/30 text-right flex-1"
          />
          <Button size="icon" variant="ghost" className="h-6 w-6" title="הוסף תת-פריט"
            onClick={() => addChild(n._id)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" title="מחק"
            onClick={() => deleteNode(n._id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        {n._open && hasKids && (
          <div className="border-r-2 border-dashed border-gold/20 mr-3">
            {(n.children as Node[]).map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <FolderTree className="h-5 w-5 text-gold" />
            {isEdit ? "עריכת תבנית" : "תבנית אישית חדשה"}
          </DialogTitle>
          <DialogDescription className="text-right">
            בנה מבנה היררכי — כל פריט יכול להכיל תתי-פריטים.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[80px_1fr] gap-2">
          <div className="space-y-1">
            <Label className="text-xs">אייקון</Label>
            <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="h-9 text-center text-xl" maxLength={4} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">כותרת התבנית *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder='לדוג: "יורה דעה - הלכות שחיטה"' className="h-9 text-right border-gold/40" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">תיאור (אופציונלי)</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
            rows={2} className="text-right text-sm border-gold/40" />
        </div>

        <div className="space-y-2 border-t border-gold/20 pt-3">
          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={addRoot}
              className="h-7 gap-1 border-gold/50">
              <Plus className="h-3.5 w-3.5" /> פריט ראשי
            </Button>
            <Label className="text-xs font-semibold">מבנה התבנית</Label>
          </div>
          <div className={cn("rounded-lg border-2 border-gold/30 p-2 max-h-[40vh] overflow-y-auto",
            roots.length === 0 && "py-8 text-center")}>
            {roots.length === 0
              ? <p className="text-xs text-muted-foreground">לחץ "פריט ראשי" להתחיל</p>
              : roots.map((n) => renderNode(n, 0))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button onClick={handleSave} className="bg-gradient-navy text-primary-foreground">
            {isEdit ? "שמור שינויים" : "צור תבנית"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}