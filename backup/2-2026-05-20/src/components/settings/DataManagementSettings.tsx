import { useState, useEffect, useCallback } from "react";
import { Trash2, AlertTriangle, Search, ChevronDown, ChevronLeft, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useStudy } from "@/lib/study/store";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface DbCat {
  id: string;
  name: string;
  parent_id: string | null;
}

// Row rendered for each category in the tree
function CatRow({
  cat, depth, hasKids, isOpen, onToggle, checked, onCheck, childCount,
}: {
  cat: DbCat; depth: number; hasKids: boolean; isOpen: boolean;
  onToggle: () => void; checked: boolean;
  onCheck: (checked: boolean) => void; childCount: number;
}) {
  return (
    <div
      className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-secondary transition-colors"
      style={{ paddingRight: `${depth * 16 + 8}px` }}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheck(!!v)}
        className="shrink-0"
      />
      {hasKids ? (
        <button type="button" onClick={onToggle} className="opacity-60 hover:opacity-100">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      {isOpen && hasKids
        ? <FolderOpen className="h-4 w-4 text-gold/80 shrink-0" />
        : <Folder className="h-4 w-4 text-gold/70 shrink-0" />
      }
      <span className="flex-1 text-sm text-right truncate">{cat.name}</span>
      {childCount > 0 && (
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-gold/40 text-gold shrink-0">
          {childCount}
        </Badge>
      )}
    </div>
  );
}

export function DataManagementSettings() {
  const { user } = useAuth();
  const { deleteAllUserData } = useStudy();

  // DB state
  const [roots, setRoots] = useState<DbCat[]>([]);
  const [childrenMap, setChildrenMap] = useState<Record<string, DbCat[]>>({});
  const [childCountMap, setChildCountMap] = useState<Record<string, number>>({});
  const [totalCatCount, setTotalCatCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // UI state
  const [search, setSearch] = useState("");
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmCatOpen, setConfirmCatOpen] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [allConfirmText, setAllConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  // Load root categories + total count from DB
  const loadRoots = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const [rootsRes, totalRes] = await Promise.all([
      supabase.from("categories").select("id,name,parent_id").is("parent_id", null).is("deleted_at", null).order("sort_order"),
      supabase.from("categories").select("*", { count: "exact", head: true }).is("deleted_at", null),
    ]);
    const rootList = rootsRes.data ?? [];
    setRoots(rootList);
    setTotalCatCount(totalRes.count ?? 0);
    // Load direct-child counts for each root
    if (rootList.length > 0) {
      const counts: Record<string, number> = {};
      await Promise.all(rootList.map(async (r) => {
        const { count } = await supabase
          .from("categories").select("*", { count: "exact", head: true }).eq("parent_id", r.id).is("deleted_at", null);
        counts[r.id] = count ?? 0;
      }));
      setChildCountMap((prev) => ({ ...prev, ...counts }));
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { loadRoots(); }, [loadRoots]);

  // Lazy-load children when expanding a node
  const loadChildren = useCallback(async (parentId: string) => {
    const { data } = await supabase
      .from("categories").select("id,name,parent_id").eq("parent_id", parentId).is("deleted_at", null).order("sort_order");
    if (!data) return;
    setChildrenMap((prev) => ({ ...prev, [parentId]: data }));
    if (data.length > 0) {
      const counts: Record<string, number> = {};
      await Promise.all(data.map(async (c) => {
        const { count } = await supabase
          .from("categories").select("*", { count: "exact", head: true }).eq("parent_id", c.id).is("deleted_at", null);
        counts[c.id] = count ?? 0;
      }));
      setChildCountMap((prev) => ({ ...prev, ...counts }));
    }
  }, []);

  const toggleOpen = async (id: string) => {
    const opening = !openIds[id];
    setOpenIds((prev) => ({ ...prev, [id]: opening }));
    if (opening && !childrenMap[id]) {
      await loadChildren(id);
    }
  };

  const handleCheck = (id: string, check: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (check) next.add(id); else next.delete(id);
      return next;
    });
  };

  // Recursive render of a category node
  const renderNode = (cat: DbCat, depth: number) => {
    const childCount = childCountMap[cat.id] ?? 0;
    const hasKids = childCount > 0;
    const isOpen = !!openIds[cat.id];
    const selfMatches = !search.trim() || cat.name.toLowerCase().includes(search.toLowerCase());
    const kids = childrenMap[cat.id] ?? [];
    const anyKidMatches = kids.some((k) => k.name.toLowerCase().includes(search.toLowerCase()));
    if (!selfMatches && !anyKidMatches) return null;

    return (
      <div key={cat.id}>
        <CatRow
          cat={cat} depth={depth} hasKids={hasKids} isOpen={isOpen}
          onToggle={() => toggleOpen(cat.id)}
          checked={selected.has(cat.id)}
          onCheck={(v) => handleCheck(cat.id, v)}
          childCount={childCount}
        />
        {(isOpen || (search.trim() && anyKidMatches)) && hasKids && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  const visibleRoots = roots.filter((r) => {
    if (!search.trim()) return true;
    if (r.name.toLowerCase().includes(search.toLowerCase())) return true;
    return (childrenMap[r.id] ?? []).some((k) => k.name.toLowerCase().includes(search.toLowerCase()));
  });

  const handleDeleteCategories = async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      // Soft delete: mark as deleted (tombstone) so other devices honor the removal.
      // We need to recursively collect all descendants (no DB cascade for soft-delete).
      const allIds = new Set<string>(selected);
      const pending = [...selected];
      while (pending.length) {
        const chunk = pending.splice(0, 100);
        const { data: kids } = await supabase
          .from("categories").select("id").in("parent_id", chunk).is("deleted_at", null);
        for (const k of (kids ?? [])) {
          if (!allIds.has(k.id)) {
            allIds.add(k.id);
            pending.push(k.id);
          }
        }
      }
      const nowIso = new Date().toISOString();
      const idsArr = [...allIds];
      for (let i = 0; i < idsArr.length; i += 100) {
        const chunk = idsArr.slice(i, i + 100);
        const { error } = await supabase.from("categories").update({ deleted_at: nowIso }).in("id", chunk);
        if (error) throw error;
      }
      toast({ title: `🗑 ${selected.size} קטגוריות נמחקו`, description: "כל תת-הקטגוריות נמחקו אוטומטית" });
      setSelected(new Set());
      setChildrenMap({});
      setChildCountMap({});
      setOpenIds({});
      setConfirmCatOpen(false);
      await loadRoots();
    } catch (err) {
      toast({ title: "שגיאה במחיקה", description: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAll = async () => {
    setBusy(true);
    try {
      await deleteAllUserData();
      toast({ title: "🗑 כל הנתונים נמחקו" });
      setConfirmAllOpen(false);
      setAllConfirmText("");
      setRoots([]);
      setTotalCatCount(0);
    } catch (err) {
      toast({ title: "שגיאה במחיקה", description: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* ── Delete by categories ── */}
      <Card className="gold-frame">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Folder className="h-4 w-4 text-gold" />
            מחיקה לפי קטגוריות
            {totalCatCount > 0 && (
              <Badge variant="outline" className="text-[10px] border-gold/40 text-gold mr-auto">
                {totalCatCount.toLocaleString()} קטגוריות
              </Badge>
            )}
            <Button variant="ghost" size="icon" className="h-6 w-6 mr-auto" onClick={loadRoots} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            בחר קטגוריות למחיקה. כל תת-קטגוריות וכרטיסים שמשויכים אליהן יימחקו.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חפש קטגוריה..."
              className="pr-8 text-right"
              dir="rtl"
            />
          </div>

          <div className="border border-gold/20 rounded-lg max-h-80 overflow-y-auto bg-background/60 p-1">
            {loading ? (
              <p className="text-xs text-muted-foreground text-center py-4">טוען קטגוריות...</p>
            ) : visibleRoots.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                {search ? "לא נמצאו קטגוריות" : "אין קטגוריות"}
              </p>
            ) : (
              visibleRoots.map((cat) => renderNode(cat, 0))
            )}
          </div>

          {selected.size > 0 && (
            <div className="flex items-center justify-between bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-sm">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmCatOpen(true)}
                disabled={busy}
                className="gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                מחק נבחרות
              </Button>
              <span className="text-destructive font-medium">
                {selected.size} קטגוריות נבחרות
              </span>
            </div>
          )}

          {selected.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground text-xs"
              onClick={() => setSelected(new Set())}
            >
              נקה בחירה
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Delete all data ── */}
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="h-4 w-4" />
            מחיקת כל הנתונים
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            מוחק לצמיתות את <strong>כל</strong> הקטגוריות, הכרטיסים, המערכות, יומן החזרות, יעדים וכל שאר הנתונים. פעולה זו <strong>בלתי הפיכה</strong>.
          </p>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => setConfirmAllOpen(true)}
            disabled={busy}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            מחק את כל הנתונים
          </Button>
        </CardContent>
      </Card>

      {/* ── Confirm: delete categories ── */}
      <Dialog open={confirmCatOpen} onOpenChange={setConfirmCatOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-right">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              אישור מחיקת קטגוריות
            </DialogTitle>
            <DialogDescription className="text-right">
              עומד למחוק <strong>{selected.size}</strong> קטגוריות (כולל כל תת-הקטגוריות שלהן). הפעולה בלתי הפיכה.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button variant="destructive" onClick={handleDeleteCategories} disabled={busy} className="gap-1.5">
              {busy ? "מוחק..." : "כן, מחק"}
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => setConfirmCatOpen(false)} disabled={busy}>ביטול</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirm: delete all ── */}
      <Dialog open={confirmAllOpen} onOpenChange={(o) => { setConfirmAllOpen(o); if (!o) setAllConfirmText(""); }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-right text-destructive">
              <AlertTriangle className="h-5 w-5" />
              מחיקת כל הנתונים
            </DialogTitle>
            <DialogDescription className="text-right">
              פעולה זו תמחק לצמיתות את <strong>כל</strong> הנתונים שלך ואין דרך לשחזרם.
              <br />
              כדי לאשר, הקלד <strong>מחק הכל</strong> בתיבה למטה.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={allConfirmText}
            onChange={(e) => setAllConfirmText(e.target.value)}
            placeholder='הקלד "מחק הכל"'
            className="text-right border-destructive/40"
            dir="rtl"
          />
          <DialogFooter className="flex-row-reverse gap-2">
            <Button
              variant="destructive"
              onClick={handleDeleteAll}
              disabled={busy || allConfirmText.trim() !== "מחק הכל"}
              className="gap-1.5"
            >
              {busy ? "מוחק..." : "מחק הכל לצמיתות"}
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => { setConfirmAllOpen(false); setAllConfirmText(""); }} disabled={busy}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
