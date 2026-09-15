import { useLayoutEffect, useRef, useState } from "react";
import type { UiPrefs } from "@/lib/study/types";

export const DEFAULT_HOME_TITLE: NonNullable<UiPrefs["homeTitle"]> = { style: "gold", font: "heebo", size: 22 };
export const TITLE_FONTS = { heebo: "Heebo, sans-serif", assistant: "Assistant, sans-serif", serif: "Georgia, 'Times New Roman', serif" };
export function HomeTitle({ preferences }: { preferences?: UiPrefs["homeTitle"] }) {
  const prefs = { ...DEFAULT_HOME_TITLE, ...preferences };
  const size = Number.isFinite(prefs.size) ? Math.max(16, Math.min(32, prefs.size)) : 22;
  const host = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const measure = () => { if (host.current && text.current) setFit(Math.min(1, host.current.clientWidth / Math.max(1, text.current.offsetWidth))); };
    measure();
    const observer = new ResizeObserver(measure);
    if (host.current) observer.observe(host.current);
    if (text.current) observer.observe(text.current);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [size, prefs.font, prefs.style]);
  return <div ref={host} data-testid="home-motto" className="w-full min-w-0 flex items-center justify-center overflow-hidden" style={{ height: 42 }} dir="rtl">
    <span ref={text} className={`inline-block shrink-0 whitespace-nowrap font-bold leading-tight ${prefs.style === "gold" ? "text-gold drop-shadow-sm" : "text-foreground"} ${prefs.style === "badge" ? "rounded-full border border-gold/60 bg-gold/10 px-3 py-1" : ""} ${prefs.style === "classic" ? "border-b border-gold/60 pb-1" : ""}`} style={{ fontFamily: TITLE_FONTS[prefs.font] ?? TITLE_FONTS.heebo, fontSize: size, transform: `scale(${fit})` }}>
      למען תהיה <span className={prefs.style === "two-tone" ? "text-gold" : undefined}>תורת ה׳</span> בפיך
    </span>
  </div>;
}
