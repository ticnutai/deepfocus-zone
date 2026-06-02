import { ReactNode, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import type { WidgetConfig } from "@/lib/study/types";

interface RenderItem {
  cfg: WidgetConfig;
  label: string;
  node: ReactNode;
}

/* ─────────────────── Premium Stack ─────────────────── */
export function PremiumStackLayout({ items }: { items: RenderItem[] }) {
  return (
    <div className="space-y-5 pb-6">
      {items.map((it, i) => (
        <section
          key={it.cfg.id}
          className="relative animate-in fade-in slide-in-from-bottom-2 duration-500"
          style={{ animationDelay: `${Math.min(i * 60, 400)}ms` }}
        >
          {/* Premium gold header strip */}
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="h-px flex-1 bg-gradient-to-l from-transparent via-gold/40 to-gold/60" />
            <div className="flex items-center gap-1.5 rounded-full border border-gold/40 bg-gradient-to-l from-gold/20 to-gold/5 px-3 py-1 shadow-sm">
              <Sparkles className="h-3 w-3 text-gold" />
              <span className="font-display text-[11px] font-bold text-gold tracking-wide">{it.label}</span>
            </div>
          </div>
          <div className="rounded-2xl shadow-[0_8px_30px_-12px_hsl(var(--primary)/0.25)] ring-1 ring-gold/15 overflow-hidden">
            {it.node}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ─────────────────── Carousel ─────────────────── */
export function CarouselLayout({ items }: { items: RenderItem[] }) {
  const [idx, setIdx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const total = items.length;

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onScroll = () => {
      const i = Math.round(el.scrollLeft / el.clientWidth);
      // RTL: scrollLeft is negative in some browsers; use abs
      const newIdx = Math.min(total - 1, Math.max(0, Math.abs(i)));
      setIdx(newIdx);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [total]);

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const target = i * el.clientWidth;
    // For RTL, scrollLeft works differently; use scrollBy logic
    el.scrollTo({ left: target * (getComputedStyle(el).direction === "rtl" ? -1 : 1), behavior: "smooth" });
    setIdx(i);
  };

  if (total === 0) return null;

  return (
    <div className="space-y-3 pb-6" dir="rtl">
      {/* Header indicator */}
      <div className="flex items-center justify-between gap-3 px-1">
        <button
          onClick={() => goTo(Math.max(0, idx - 1))}
          disabled={idx === 0}
          className="flex items-center justify-center h-9 w-9 rounded-full border border-gold/50 bg-card text-navy shadow disabled:opacity-30"
          aria-label="הקודם"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="flex flex-col items-center gap-1 min-w-0">
          <span className="font-display text-sm font-bold truncate">{items[idx]?.label}</span>
          <div className="flex items-center gap-1">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`עבור לווידג'ט ${i + 1}`}
                className={cn(
                  "transition-all rounded-full",
                  i === idx ? "h-1.5 w-6 bg-gold" : "h-1.5 w-1.5 bg-gold/30",
                )}
              />
            ))}
          </div>
        </div>
        <button
          onClick={() => goTo(Math.min(total - 1, idx + 1))}
          disabled={idx === total - 1}
          className="flex items-center justify-center h-9 w-9 rounded-full border border-gold/50 bg-card text-navy shadow disabled:opacity-30"
          aria-label="הבא"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      </div>

      <div
        ref={trackRef}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide -mx-3 px-3 gap-3"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {items.map((it) => (
          <div key={it.cfg.id} className="snap-center shrink-0 w-full">
            <div className="rounded-2xl shadow-[0_8px_30px_-12px_hsl(var(--primary)/0.3)] ring-1 ring-gold/20 overflow-hidden">
              {it.node}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────── Magazine ─────────────────── */
export function MagazineLayout({ items }: { items: RenderItem[] }) {
  if (items.length === 0) return null;
  const [hero, ...rest] = items;

  return (
    <div className="space-y-4 pb-6">
      {/* Hero */}
      <section className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-l from-gold to-gold/70 text-navy px-3 py-1 text-[10px] font-bold shadow">
            <Sparkles className="h-3 w-3" /> מומלץ
          </span>
          <span className="font-display text-sm font-bold">{hero.label}</span>
        </div>
        <div className="rounded-2xl shadow-[0_12px_40px_-12px_hsl(var(--primary)/0.4)] ring-2 ring-gold/30 overflow-hidden">
          {hero.node}
        </div>
      </section>

      {/* Rest in 2-col with full-width fallback for size=full */}
      <div className="grid grid-cols-2 gap-3">
        {rest.map((it) => (
          <div
            key={it.cfg.id}
            className={cn(
              "rounded-2xl shadow-md ring-1 ring-gold/15 overflow-hidden",
              it.cfg.size === "full" && "col-span-2",
            )}
          >
            {it.node}
          </div>
        ))}
      </div>
    </div>
  );
}
