import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useStudy } from "@/lib/study/store";
import { CATEGORY_TEMPLATES } from "@/lib/study/categoryTemplates";
import { toast } from "@/hooks/use-toast";

const FLAG_KEY = (uid: string) => `shas-auto-init-v1:${uid}`;

/**
 * Auto-creates the ש"ס category template on first hydration for a real (non-guest) user
 * who has no categories yet. Runs once per user (tracked in localStorage).
 */
export function AutoInitShasTemplate() {
  const { user, isGuest } = useAuth();
  const { state, addCategoriesBulk, getHydrationSnapshot } = useStudy();
  const { isHydrated } = getHydrationSnapshot();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    if (!user || isGuest) return;
    if (!isHydrated) return;

    const uid = user.id;
    let flag: string | null = null;
    try { flag = localStorage.getItem(FLAG_KEY(uid)); } catch { /* ignore */ }
    if (flag) { ranRef.current = true; return; }

    // Only auto-create if user has no categories at all.
    if ((state.categories ?? []).length > 0) {
      ranRef.current = true;
      try { localStorage.setItem(FLAG_KEY(uid), "1"); } catch { /* ignore */ }
      return;
    }

    const shas = CATEGORY_TEMPLATES.find((t) => t.id === "shas");
    if (!shas) return;

    ranRef.current = true;
    try {
      const created = addCategoriesBulk(shas.roots, null);
      try { localStorage.setItem(FLAG_KEY(uid), "1"); } catch { /* ignore */ }
      if (created > 0) {
        toast({
          title: 'תבנית ש"ס נוצרה',
          description: `נוצרו ${created} קטגוריות אוטומטית עבור החשבון החדש.`,
        });
      }
    } catch (err) {
      ranRef.current = false;
      console.error("[AutoInitShasTemplate] failed", err);
    }
  }, [user, isGuest, isHydrated, state.categories, addCategoriesBulk]);

  return null;
}
