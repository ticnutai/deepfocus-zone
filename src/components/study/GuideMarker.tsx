import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type MarkerTone = "primary" | "success";

/**
 * A hollow, see-through numbered marker for annotating guide screenshots.
 *
 * The center is transparent so the element it points at stays fully visible
 * (unlike a solid filled badge, which hides exactly what it highlights). A
 * colored ring plus a white halo keep it legible on any background — light
 * fields or dark buttons alike — and the digit carries a white text-halo so
 * it reads clearly even over busy content.
 *
 * Positioning is the caller's job: pass `className`/`style` (e.g. an absolute
 * `left`/`top` with a centering translate) to place it on the image.
 */
export function GuideMarker({
  number,
  tone = "primary",
  size = 34,
  className,
  style,
}: {
  number: number | string;
  tone?: MarkerTone;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ringColor = tone === "success" ? "rgb(22 163 74)" : "hsl(var(--navy))";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "z-10 inline-flex select-none items-center justify-center rounded-full font-extrabold leading-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        color: ringColor,
        fontSize: size * 0.46,
        // A soft white glow, strongest behind the digit and fading to fully
        // transparent before the ring — so the number stays crisp on ANY
        // background (dark buttons included) while the element still shows
        // through around it. Not a solid fill: the target remains visible.
        background:
          "radial-gradient(closest-side, rgba(255,255,255,0.72), rgba(255,255,255,0.30) 55%, rgba(255,255,255,0) 80%)",
        boxShadow: [
          "0 0 0 2px rgba(255,255,255,0.95)", // outer white halo (contrast on dark)
          "0 2px 6px rgba(0,0,0,0.30)", // soft drop shadow for depth
          `inset 0 0 0 3px ${ringColor}`, // the colored ring itself
          "inset 0 0 0 4.5px rgba(255,255,255,0.9)", // thin inner white line
        ].join(", "),
        textShadow: "0 0 3px #fff, 0 0 3px #fff, 0 0 4px #fff, 0 1px 1px rgba(255,255,255,0.9)",
        ...style,
      }}
    >
      {number}
    </span>
  );
}
