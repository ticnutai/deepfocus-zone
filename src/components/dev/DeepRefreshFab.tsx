import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { navigateWithCacheBuster, performDeepRefresh } from "@/lib/app/deepRefresh";
import { useStudy } from "@/lib/study/store";

const MIN_SIZE = 32;
const MAX_SIZE = 56;
const DEFAULT_SIZE = 44;
const MARGIN = 12;

type Pos = { x: number; y: number };

function clampSize(raw: number): number {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(raw)));
}

function clampPos(pos: Pos, size: number): Pos {
  const maxX = Math.max(MARGIN, window.innerWidth - size - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - size - MARGIN);
  return {
    x: Math.max(MARGIN, Math.min(maxX, pos.x)),
    y: Math.max(MARGIN, Math.min(maxY, pos.y)),
  };
}

function getDefaultPos(size: number): Pos {
  return clampPos({ x: window.innerWidth - size - 16, y: window.innerHeight - size - 16 }, size);
}

export function DeepRefreshFab() {
  const { state, setUiPref } = useStudy();
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);

  const dragOffsetRef = useRef<Pos>({ x: 0, y: 0 });
  const didDragRef = useRef(false);

  const size = useMemo(() => {
    const raw = Number(state.uiPrefs?.devDeepRefreshSize ?? DEFAULT_SIZE);
    return clampSize(Number.isFinite(raw) ? raw : DEFAULT_SIZE);
  }, [state.uiPrefs?.devDeepRefreshSize]);

  const [pos, setPos] = useState<Pos>(() => {
    const saved = state.uiPrefs?.devDeepRefreshPos;
    return clampPos(saved ?? getDefaultPos(size), size);
  });

  useEffect(() => {
    const saved = state.uiPrefs?.devDeepRefreshPos;
    setPos(clampPos(saved ?? getDefaultPos(size), size));
  }, [state.uiPrefs?.devDeepRefreshPos, size]);

  useEffect(() => {
    const onResize = () => setPos((prev) => clampPos(prev, size));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size]);

  const handleDeepRefresh = useCallback(async () => {
    if (running) return;
    setRunning(true);

    try {
      const result = await performDeepRefresh();
      toast.info("ריענון עמוק מתחיל", {
        description: `נוקו ${result.clearedCaches.length} מטמונים ועודכנו ${result.swRegistrations} רישומי Service Worker.`,
        duration: 2500,
      });
      window.setTimeout(() => navigateWithCacheBuster(), 350);
    } catch {
      // Even if cleanup fails, we still navigate with a cache-busting URL.
      navigateWithCacheBuster();
    }
  }, [running]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    didDragRef.current = false;
    dragOffsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pos.x, pos.y]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const next = clampPos(
      {
        x: e.clientX - dragOffsetRef.current.x,
        y: e.clientY - dragOffsetRef.current.y,
      },
      size,
    );
    if (Math.abs(next.x - pos.x) > 1 || Math.abs(next.y - pos.y) > 1) {
      didDragRef.current = true;
    }
    setPos(next);
  }, [dragging, pos.x, pos.y, size]);

  const handlePointerUp = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    setUiPref("devDeepRefreshPos", pos);
  }, [dragging, pos, setUiPref]);

  const handleClick = useCallback(async () => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    await handleDeepRefresh();
  }, [handleDeepRefresh]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          dir="rtl"
          disabled={running}
          style={{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${size}px`, height: `${size}px` }}
          className={cn(
            "fixed z-[60] flex items-center justify-center rounded-full border border-gold/60",
            "bg-card/95 text-foreground shadow-sm backdrop-blur transition",
            "hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70",
            dragging && "cursor-grabbing",
          )}
          aria-label="ריענון עמוק של האפליקציה"
        >
          <RefreshCw
            className={cn(running && "animate-spin")}
            style={{ width: `${Math.max(14, Math.round(size * 0.38))}px`, height: `${Math.max(14, Math.round(size * 0.38))}px` }}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" dir="rtl" className="text-right">
        <div className="space-y-1 text-xs">
          <div className="font-semibold">ריענון חזק לכל האפליקציה</div>
          <div>גרור כדי לשנות מיקום.</div>
          <div>מנקה Cache Storage ומכריח טעינה מחדש עם cache-buster.</div>
          <div className="text-muted-foreground">לא מוחק נתוני לימוד מקומיים (IndexedDB).</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
