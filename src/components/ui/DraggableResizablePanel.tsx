import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  titleExtra?: ReactNode;
  children: ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  className?: string;
}

const MIN_W = 380;
const MIN_H = 320;
const VIEWPORT_MARGIN = 8;

const clampPanelToViewport = (
  nextPos: { x: number; y: number },
  nextSize: { w: number; h: number },
) => {
  const maxW = Math.max(MIN_W, window.innerWidth - VIEWPORT_MARGIN * 2);
  const maxH = Math.max(MIN_H, window.innerHeight - VIEWPORT_MARGIN * 2);
  const w = Math.min(nextSize.w, maxW);
  const h = Math.min(nextSize.h, maxH);
  const maxX = Math.max(
    VIEWPORT_MARGIN,
    window.innerWidth - w - VIEWPORT_MARGIN,
  );
  const maxY = Math.max(
    VIEWPORT_MARGIN,
    window.innerHeight - h - VIEWPORT_MARGIN,
  );
  const x = Math.min(Math.max(nextPos.x, VIEWPORT_MARGIN), maxX);
  const y = Math.min(Math.max(nextPos.y, VIEWPORT_MARGIN), maxY);
  return { pos: { x, y }, size: { w, h } };
};

export function DraggableResizablePanel({
  open,
  onClose,
  title,
  titleExtra,
  children,
  defaultWidth = 620,
  defaultHeight = 640,
  className,
}: Props) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: defaultWidth, h: defaultHeight });
  const [initialized, setInitialized] = useState(false);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    posX: number;
    posY: number;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startPosX: number;
    startPosY: number;
    dir: string;
  } | null>(null);

  // Center on first open
  useEffect(() => {
    if (open && !initialized) {
      const centered = clampPanelToViewport(
        {
          x: (window.innerWidth - defaultWidth) / 2,
          y: (window.innerHeight - defaultHeight) / 4,
        },
        { w: defaultWidth, h: defaultHeight },
      );
      setPos(centered.pos);
      setSize(centered.size);
      setInitialized(true);
    }
    if (!open) setInitialized(false);
  }, [open, initialized, defaultWidth, defaultHeight]);

  // Keep panel visible when viewport changes (resize / zoom / orientation changes).
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      setPos((prevPos) => {
        const clamped = clampPanelToViewport(prevPos, size);
        setSize((prevSize) =>
          prevSize.w !== clamped.size.w || prevSize.h !== clamped.size.h
            ? clamped.size
            : prevSize,
        );
        return clamped.pos;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, size]);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    const w = window as Window & {
      __panelLifecycleTrace?: Array<{
        at: number;
        iso: string;
        open: boolean;
        title: string;
        event: "render-open" | "render-closed";
      }>;
    };
    const titleText = typeof title === "string" ? title : "[non-string-title]";
    const prev = Array.isArray(w.__panelLifecycleTrace)
      ? w.__panelLifecycleTrace
      : [];
    w.__panelLifecycleTrace = [
      ...prev,
      {
        at: performance.now(),
        iso: new Date().toISOString(),
        open,
        title: titleText,
        event: (open ? "render-open" : "render-closed") as
          | "render-open"
          | "render-closed",
      },
    ].slice(-80);
  }, [open, title]);

  // Drag from header
  const onDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const snapshot = {
        startX: e.clientX,
        startY: e.clientY,
        posX: pos.x,
        posY: pos.y,
      };
      dragRef.current = snapshot;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - snapshot.startX;
        const dy = ev.clientY - snapshot.startY;
        const clamped = clampPanelToViewport(
          { x: snapshot.posX + dx, y: snapshot.posY + dy },
          size,
        );
        setPos(clamped.pos);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [pos.x, pos.y],
  );

  // Resize from handles
  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent, dir: string) => {
      e.preventDefault();
      e.stopPropagation();
      const snapshot = {
        startX: e.clientX,
        startY: e.clientY,
        startW: size.w,
        startH: size.h,
        startPosX: pos.x,
        startPosY: pos.y,
        dir,
      };
      resizeRef.current = snapshot;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - snapshot.startX;
        const dy = ev.clientY - snapshot.startY;
        let newW = snapshot.startW;
        let newH = snapshot.startH;
        let newX = snapshot.startPosX;
        let newY = snapshot.startPosY;
        if (dir.includes("e")) newW = Math.max(MIN_W, snapshot.startW + dx);
        if (dir.includes("w")) {
          newW = Math.max(MIN_W, snapshot.startW - dx);
          newX = snapshot.startPosX + snapshot.startW - newW;
        }
        if (dir.includes("s")) newH = Math.max(MIN_H, snapshot.startH + dy);
        if (dir.includes("n")) {
          newH = Math.max(MIN_H, snapshot.startH - dy);
          newY = snapshot.startPosY + snapshot.startH - newH;
        }
        const clamped = clampPanelToViewport(
          { x: newX, y: newY },
          { w: newW, h: newH },
        );
        setSize(clamped.size);
        setPos(clamped.pos);
      };
      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [pos.x, pos.y, size],
  );

  if (!open) return null;

  const HANDLE_SIZE = 8; // px hit area

  const handles: { dir: string; style: React.CSSProperties; cursor: string }[] =
    [
      {
        dir: "n",
        style: {
          top: 0,
          left: HANDLE_SIZE,
          right: HANDLE_SIZE,
          height: HANDLE_SIZE,
        },
        cursor: "n-resize",
      },
      {
        dir: "s",
        style: {
          bottom: 0,
          left: HANDLE_SIZE,
          right: HANDLE_SIZE,
          height: HANDLE_SIZE,
        },
        cursor: "s-resize",
      },
      {
        dir: "e",
        style: {
          top: HANDLE_SIZE,
          bottom: HANDLE_SIZE,
          right: 0,
          width: HANDLE_SIZE,
        },
        cursor: "e-resize",
      },
      {
        dir: "w",
        style: {
          top: HANDLE_SIZE,
          bottom: HANDLE_SIZE,
          left: 0,
          width: HANDLE_SIZE,
        },
        cursor: "w-resize",
      },
      {
        dir: "ne",
        style: { top: 0, right: 0, width: HANDLE_SIZE, height: HANDLE_SIZE },
        cursor: "ne-resize",
      },
      {
        dir: "nw",
        style: { top: 0, left: 0, width: HANDLE_SIZE, height: HANDLE_SIZE },
        cursor: "nw-resize",
      },
      {
        dir: "se",
        style: { bottom: 0, right: 0, width: HANDLE_SIZE, height: HANDLE_SIZE },
        cursor: "se-resize",
      },
      {
        dir: "sw",
        style: { bottom: 0, left: 0, width: HANDLE_SIZE, height: HANDLE_SIZE },
        cursor: "sw-resize",
      },
    ];

  const panelNode = (
    <div
      className={cn(
        "fixed z-50 flex flex-col rounded-xl border-2 border-gold/40 bg-card shadow-2xl",
        className,
      )}
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      dir="rtl"
    >
      {/* Drag handle header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-gold/20 cursor-move select-none bg-secondary/20 rounded-t-xl shrink-0"
        onMouseDown={onDragMouseDown}
      >
        <button
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex-1 font-medium text-right text-sm truncate">
          {title}
        </div>
        {titleExtra && (
          <div onMouseDown={(e) => e.stopPropagation()}>{titleExtra}</div>
        )}
        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 opacity-50" />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3">{children}</div>

      {/* Resize handles */}
      {handles.map(({ dir, style, cursor }) => (
        <div
          key={dir}
          style={{ ...style, position: "absolute", cursor }}
          onMouseDown={(e) => onResizeMouseDown(e, dir)}
        />
      ))}
    </div>
  );

  return createPortal(panelNode, document.body);
}
