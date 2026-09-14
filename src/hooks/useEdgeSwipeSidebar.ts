import { useEffect } from "react";

/**
 * Single source of truth for the mobile sidebar edge-swipe gesture.
 * RTL app → the sidebar lives on the right edge:
 *  - swipe starting near the right edge and moving right→left opens it
 *  - while open, a left→right swipe closes it
 * Only active below the lg breakpoint (1024px).
 */
export function useEdgeSwipeSidebar(open: boolean, setOpen: (v: boolean) => void) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const EDGE = 48;
    const THRESHOLD = 40;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let decided = false;

    const onTouchStart = (e: TouchEvent) => {
      tracking = false;
      decided = false;
      if (window.innerWidth >= 1024) return;
      const t = e.touches[0];
      if (!t) return;
      if (open || t.clientX >= window.innerWidth - EDGE) {
        tracking = true;
        startX = t.clientX;
        startY = t.clientY;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!decided) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        if (Math.abs(dy) > Math.abs(dx)) { tracking = false; return; }
        decided = true;
      }
      if (e.cancelable) e.preventDefault();
      if (!open && dx < -THRESHOLD) {
        setOpen(true);
        tracking = false;
      } else if (open && dx > THRESHOLD) {
        setOpen(false);
        tracking = false;
      }
    };
    const onTouchEnd = () => { tracking = false; decided = false; };

    const moveOpts: AddEventListenerOptions = { passive: false, capture: true };
    window.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    window.addEventListener("touchmove", onTouchMove, moveOpts);
    window.addEventListener("touchend", onTouchEnd, { capture: true });
    window.addEventListener("touchcancel", onTouchEnd, { capture: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchmove", onTouchMove, moveOpts as EventListenerOptions);
      window.removeEventListener("touchend", onTouchEnd, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchcancel", onTouchEnd, { capture: true } as EventListenerOptions);
    };
  }, [open, setOpen]);
}
