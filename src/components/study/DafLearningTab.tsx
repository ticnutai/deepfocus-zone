import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import { ChevronRight, ChevronLeft, BookOpen, ListChecks, GraduationCap, PanelRightOpen, Maximize2, Minimize2, X, ZoomIn, BookText, Scroll, Layers, ArrowLeftRight, ChevronDown, Landmark, LibraryBig, Files, BookMarked, Move } from "lucide-react";
import { MishnaLearningTab } from "./MishnaLearningTab";
import { ChumashLearningTab } from "./ChumashLearningTab";
import { NeviimKetuvimLearningTab } from "./NeviimKetuvimLearningTab";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStudy } from "@/lib/study/store";
import { SHAS_BAVLI, SEDARIM } from "@/lib/study/shasData";
import { dafLabel, toGematria } from "@/lib/study/shasGen";
import { filterCardsByDafAmud, countCardsPerDaf } from "@/lib/study/dafCards";
import { GemaraViewer } from "./GemaraViewer";
import { StudySession } from "./StudySession";
import { CardDecksDialog } from "./CardDecksDialog";
import { BulkCardDecksDialog } from "./BulkCardDecksDialog";
import { FitToContainer } from "./FitToContainer";
import { cn } from "@/lib/utils";
import { useLocation, useNavigate } from "react-router-dom";
import type { Card as StudyCardType } from "@/lib/study/types";

type Layout = "split" | "text-only" | "cards-only";
type PracticeMode = "inline" | "fullscreen";
type SplitSide = "gemara-right" | "gemara-left";
type NavStep = "seder" | "masechta" | "daf" | "amud";
type ResizeDirection = "e" | "w" | "s";

const STORAGE_KEY = "daf-learning-state";
const MIN_NAV_DIALOG_WIDTH = 280;
const MIN_NAV_DIALOG_HEIGHT = 220;

interface SavedState {
  seder?: string;
  masechta?: string;
  daf?: number;
  amud?: 1 | 2;
  layout?: Layout;
  splitSide?: SplitSide;
  splitRatio?: number;
  practiceMode?: PracticeMode;
  practiceScale?: number;
  navDialogX?: number;
  navDialogY?: number;
  navDialogWidth?: number;
  navDialogHeight?: number;
}

function loadSaved(): SavedState {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveState(s: SavedState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function normalizeLayout(layout: SavedState["layout"]): Layout {
  if (layout === "split-v" || layout === "split-h") return "split";
  if (layout === "gemara") return "text-only";
  if (layout === "cards") return "cards-only";
  if (layout === "split" || layout === "text-only" || layout === "cards-only") return layout;
  return "split";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function DafLearningTabInner({ isVisible }: { isVisible: boolean }) {
  const { state } = useStudy();
  const navigate = useNavigate();
  const location = useLocation();
  const saved = useMemo(() => loadSaved(), []);

  const [seder, setSeder] = useState<string>(saved.seder ?? "מועד");
  const [masechta, setMasechta] = useState<string>(saved.masechta ?? "שבת");
  const [daf, setDaf] = useState<number>(saved.daf ?? 2);
  const [amud, setAmud] = useState<1 | 2>(saved.amud ?? 1);
  const [layout, setLayout] = useState<Layout>(() => {
    const fallback: Layout = window.innerWidth >= 1024 ? "split" : "cards-only";
    return normalizeLayout(saved.layout) ?? fallback;
  });
  const [splitSide, setSplitSide] = useState<SplitSide>(saved.splitSide ?? "gemara-right");
  const [splitRatio, setSplitRatioState] = useState<number>(Math.max(20, Math.min(80, saved.splitRatio ?? 60)));
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [studyOpen, setStudyOpen] = useState(false);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>(saved.practiceMode ?? "inline");
  const [practiceScale, setPracticeScale] = useState<number>(saved.practiceScale ?? 1);
  const [countsReady, setCountsReady] = useState(false);
  const [deckDialogCard, setDeckDialogCard] = useState<StudyCardType | null>(null);
  const [bulkDeckDialogOpen, setBulkDeckDialogOpen] = useState(false);
  const [navDialogOpen, setNavDialogOpen] = useState(false);
  const [navStep, setNavStep] = useState<NavStep>("seder");
  const [navSeder, setNavSeder] = useState<string>(saved.seder ?? "מועד");
  const [navMasechta, setNavMasechta] = useState<string>(saved.masechta ?? "שבת");
  const [navDaf, setNavDaf] = useState<number>(saved.daf ?? 2);
  const [navAmud, setNavAmud] = useState<1 | 2>(saved.amud ?? 1);
  const [navDafPage, setNavDafPage] = useState(0);
  const [navDialogPosition, setNavDialogPosition] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") return { x: 16, y: 96 };
    const width = clamp(saved.navDialogWidth ?? 760, MIN_NAV_DIALOG_WIDTH, window.innerWidth - 24);
    const maxX = Math.max(16, window.innerWidth - width - 16);
    const maxY = Math.max(12, window.innerHeight - MIN_NAV_DIALOG_HEIGHT - 12);
    return {
      x: clamp(saved.navDialogX ?? Math.round((window.innerWidth - width) / 2), 16, maxX),
      y: clamp(saved.navDialogY ?? 96, 12, maxY),
    };
  });
  const [navDialogSize, setNavDialogSize] = useState<{ width: number; height: number }>(() => {
    if (typeof window === "undefined") return { width: 760, height: 620 };
    return {
      width: clamp(saved.navDialogWidth ?? 760, MIN_NAV_DIALOG_WIDTH, window.innerWidth - 24),
      height: clamp(saved.navDialogHeight ?? 620, MIN_NAV_DIALOG_HEIGHT, window.innerHeight - 24),
    };
  });
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeStateRef = useRef<{
    dir: ResizeDirection;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);
  const isStandaloneSplitPage = location.pathname === "/split-view";

  const handleSplitPageToggle = () => {
    if (isStandaloneSplitPage) {
      navigate("/");
      return;
    }
    navigate("/split-view");
  };

  // שמור בחירה
  useEffect(() => {
    saveState({
      seder,
      masechta,
      daf,
      amud,
      layout,
      splitSide,
      splitRatio,
      practiceMode,
      practiceScale,
      navDialogX: navDialogPosition.x,
      navDialogY: navDialogPosition.y,
      navDialogWidth: navDialogSize.width,
      navDialogHeight: navDialogSize.height,
    });
  }, [
    seder,
    masechta,
    daf,
    amud,
    layout,
    splitSide,
    splitRatio,
    practiceMode,
    practiceScale,
    navDialogPosition.x,
    navDialogPosition.y,
    navDialogSize.width,
    navDialogSize.height,
  ]);

  const setSplitRatio = (value: number) => {
    const next = Math.max(20, Math.min(80, Math.round(value)));
    setSplitRatioState(next);
  };

  useEffect(() => {
    if (!isResizing) return;

    const onMove = (ev: MouseEvent) => {
      const rect = splitContainerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const ratioFromLeft = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitRatio(ratioFromLeft);
    };

    const onUp = () => setIsResizing(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizing]);

  // איפוס מסכת אם הסדר השתנה ולא תואם
  const masechtos = useMemo(() => SHAS_BAVLI.filter((m) => m.seder === seder), [seder]);
  useEffect(() => {
    if (!masechtos.find((m) => m.name === masechta)) {
      setMasechta(masechtos[0]?.name ?? "");
      setDaf(2);
      setAmud(1);
    }
  }, [seder, masechtos, masechta]);

  const currentMasechet = SHAS_BAVLI.find((m) => m.name === masechta);
  const totalPages = currentMasechet?.pages ?? 0;

  // כדי שהטאב יופיע מיידית: דוחים את חישובי הספירות לרגע שאחרי הציור הראשון.
  useEffect(() => {
    setCountsReady(false);
    const timer = window.setTimeout(() => setCountsReady(true), 0);
    return () => window.clearTimeout(timer);
  }, [state.cards, state.categories, masechta, totalPages]);

  // ספירת כרטיסים פר-דף (לבחירה מהירה)
  const dafCounts = useMemo(
    () => (countsReady ? countCardsPerDaf(state.cards, state.categories, masechta, totalPages) : new Map()),
    [state.cards, state.categories, masechta, totalPages, countsReady],
  );

  // כרטיסים לעמוד הנוכחי
  const cards = useMemo(
    () => filterCardsByDafAmud(state.cards, state.categories, masechta, daf, amud),
    [state.cards, state.categories, masechta, daf, amud],
  );
  const cardIds = useMemo(() => cards.map((c) => c.id), [cards]);

  // ניווט דף קודם/הבא
  const goPrev = () => {
    if (amud === 2) { setAmud(1); return; }
    if (daf > 2) { setDaf(daf - 1); setAmud(2); }
  };
  const goNext = () => {
    if (amud === 1) { setAmud(2); return; }
    if (daf < totalPages + 1) { setDaf(daf + 1); setAmud(1); }
  };
  const isFirst = daf === 2 && amud === 1;
  const isLast = daf === totalPages + 1 && amud === 2;
  const closePractice = () => {
    setStudyOpen(false);
    setLayout("split");
  };

  const openNavDialog = (startStep: NavStep) => {
    setNavSeder(seder);
    setNavMasechta(masechta);
    setNavDaf(daf);
    setNavAmud(amud);
    setNavStep(startStep);
    setNavDialogPosition((prev) => {
      const maxX = Math.max(16, window.innerWidth - navDialogSize.width - 16);
      const maxY = Math.max(12, window.innerHeight - navDialogSize.height - 12);
      return {
        x: clamp(prev.x, 16, maxX),
        y: clamp(prev.y, 12, maxY),
      };
    });
    setNavDialogOpen(true);
  };

  const startDialogDrag = (ev: React.PointerEvent<HTMLElement>) => {
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    dragStateRef.current = {
      startX: ev.clientX,
      startY: ev.clientY,
      originX: navDialogPosition.x,
      originY: navDialogPosition.y,
    };
  };

  const startDialogResize = (dir: ResizeDirection, ev: React.PointerEvent<HTMLElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    resizeStateRef.current = {
      dir,
      startX: ev.clientX,
      startY: ev.clientY,
      originX: navDialogPosition.x,
      originY: navDialogPosition.y,
      originWidth: navDialogSize.width,
      originHeight: navDialogSize.height,
    };
  };

  useEffect(() => {
    if (!navDialogOpen) return;

    const onPointerMove = (ev: PointerEvent) => {
      if (dragStateRef.current) {
        const nextX = dragStateRef.current.originX + (ev.clientX - dragStateRef.current.startX);
        const nextY = dragStateRef.current.originY + (ev.clientY - dragStateRef.current.startY);
        const maxX = Math.max(16, window.innerWidth - navDialogSize.width - 16);
        const maxY = Math.max(12, window.innerHeight - navDialogSize.height - 12);
        setNavDialogPosition({
          x: clamp(nextX, 16, maxX),
          y: clamp(nextY, 12, maxY),
        });
        return;
      }

      if (resizeStateRef.current) {
        const minWidth = MIN_NAV_DIALOG_WIDTH;
        const minHeight = MIN_NAV_DIALOG_HEIGHT;
        const leftGap = 16;
        const topGap = 12;
        const rightGap = 16;
        const bottomGap = 12;
        const rs = resizeStateRef.current;
        const widthDelta = ev.clientX - rs.startX;
        const heightDelta = ev.clientY - rs.startY;

        let nextX = rs.originX;
        let nextY = rs.originY;
        let nextWidth = rs.originWidth;
        let nextHeight = rs.originHeight;

        if (rs.dir === "e") {
          const maxWidthFromRight = Math.max(minWidth, window.innerWidth - rs.originX - rightGap);
          nextWidth = clamp(rs.originWidth + widthDelta, minWidth, maxWidthFromRight);
        }

        if (rs.dir === "w") {
          const maxXFromMinWidth = rs.originX + rs.originWidth - minWidth;
          nextX = clamp(rs.originX + widthDelta, leftGap, maxXFromMinWidth);
          const maxWidthFromRight = Math.max(minWidth, window.innerWidth - nextX - rightGap);
          nextWidth = clamp(rs.originWidth - (nextX - rs.originX), minWidth, maxWidthFromRight);
        }

        if (rs.dir === "s") {
          const maxHeightFromBottom = Math.max(minHeight, window.innerHeight - rs.originY - bottomGap);
          nextHeight = clamp(rs.originHeight + heightDelta, minHeight, maxHeightFromBottom);
        }

        const maxY = Math.max(topGap, window.innerHeight - nextHeight - bottomGap);
        nextY = clamp(nextY, topGap, maxY);

        const maxX = Math.max(leftGap, window.innerWidth - nextWidth - rightGap);
        nextX = clamp(nextX, leftGap, maxX);

        setNavDialogPosition({ x: nextX, y: nextY });
        setNavDialogSize({
          width: nextWidth,
          height: nextHeight,
        });
      }
    };

    const onPointerUp = () => {
      dragStateRef.current = null;
      resizeStateRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [navDialogOpen, navDialogSize.width, navDialogSize.height, navDialogPosition.x, navDialogPosition.y]);

  const navMasechtos = useMemo(
    () => SHAS_BAVLI.filter((m) => m.seder === navSeder),
    [navSeder],
  );
  const navCurrentMasechet = useMemo(
    () => SHAS_BAVLI.find((m) => m.name === navMasechta),
    [navMasechta],
  );
  const navTotalPages = navCurrentMasechet?.pages ?? 0;
  const navDafOptions = useMemo(
    () => Array.from({ length: navTotalPages }, (_, i) => i + 2),
    [navTotalPages],
  );
  const navDafCounts = useMemo(
    () =>
      countsReady && navMasechta
        ? countCardsPerDaf(state.cards, state.categories, navMasechta, navTotalPages)
        : new Map<number, { total: number; a: number; b: number }>(),
    [state.cards, state.categories, navMasechta, navTotalPages, countsReady],
  );
  const navDafChunkSize = useMemo(() => {
    if (typeof window === "undefined") return 40;
    if (window.innerWidth < 640) return 24;
    if (window.innerWidth < 1024) return 40;
    return 60;
  }, [navDialogOpen]);
  const navDafPageCount = Math.max(
    1,
    Math.ceil(navDafOptions.length / navDafChunkSize),
  );
  const canGoPrevNavPage = navDafPage > 0;
  const canGoNextNavPage = navDafPage < navDafPageCount - 1;
  const visibleNavDafs = useMemo(() => {
    const from = navDafPage * navDafChunkSize;
    return navDafOptions.slice(from, from + navDafChunkSize);
  }, [navDafOptions, navDafPage, navDafChunkSize]);

  useEffect(() => {
    if (!navDialogOpen || navStep !== "daf") return;
    const idx = Math.max(0, navDafOptions.indexOf(navDaf));
    setNavDafPage(Math.floor(idx / navDafChunkSize));
  }, [navDialogOpen, navStep, navDafOptions, navDaf, navDafChunkSize]);

  const applyNavSelection = (pickedAmud: 1 | 2) => {
    setSeder(navSeder);
    setMasechta(navMasechta);
    setDaf(navDaf);
    setAmud(pickedAmud);
    setNavAmud(pickedAmud);
    setNavDialogOpen(false);
  };

  const handleChooseSeder = (nextSeder: string) => {
    const nextMasechtos = SHAS_BAVLI.filter((m) => m.seder === nextSeder);
    const nextMasechta =
      nextMasechtos.find((m) => m.name === navMasechta)?.name ??
      nextMasechtos[0]?.name ??
      "";
    setNavSeder(nextSeder);
    setNavMasechta(nextMasechta);
    setNavDaf(2);
    setNavStep("masechta");
  };

  const handleChooseMasechta = (nextMasechta: string) => {
    setNavMasechta(nextMasechta);
    setNavDaf(2);
    setNavStep("daf");
  };

  const handleChooseDaf = (nextDaf: number) => {
    setNavDaf(nextDaf);
    setNavStep("amud");
  };

  const handleNavDialogKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setNavDialogOpen(false);
        return;
      }
      if (navStep !== "daf") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setNavDafPage((p) => Math.max(0, p - 1));
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setNavDafPage((p) => Math.min(navDafPageCount - 1, p + 1));
      }
    },
    [navStep, navDafPageCount],
  );

  const navStepMeta: Record<NavStep, { label: string; icon: typeof Landmark }> = {
    seder: { label: "בחירת סדר", icon: Landmark },
    masechta: { label: "בחירת מסכת", icon: LibraryBig },
    daf: { label: "בחירת דף", icon: Files },
    amud: { label: "בחירת עמוד", icon: BookMarked },
  };
  const ActiveNavStepIcon = navStepMeta[navStep].icon;

  // לימוד פעיל במצב מסך מלא בלבד — מציג רק את ה-StudySession
  if (studyOpen && practiceMode === "fullscreen" && cardIds.length > 0) {
    return (
      <StudySession
        deckId={null}
        mode="practice"
        cardIds={cardIds}
        onExit={closePractice}
      />
    );
  }

  // ====== Render ======
  const navigator = (
    <Card className="gold-frame p-3 space-y-3" dir="rtl">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {/* סדר */}
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between px-3"
          onClick={() => openNavDialog("seder")}
          title="בחר סדר"
        >
          <span>{seder}</span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>

        {/* מסכת */}
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between px-3"
          onClick={() => openNavDialog("masechta")}
          title="בחר מסכת"
        >
          <span>{masechta}</span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>

        {/* דף */}
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between px-3"
          onClick={() => openNavDialog("daf")}
          title="פתח בחירה מהירה של דף"
        >
          <span>
            דף {dafLabel(daf).replace(".", "")}
            {dafCounts.get(daf)?.total ? (
              <span className="text-gold mr-2 text-xs">
                ({dafCounts.get(daf)?.total})
              </span>
            ) : null}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>

        {/* עמוד */}
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between px-3"
          onClick={() => openNavDialog("amud")}
          title="בחר עמוד"
        >
          <span>
            {amud === 1 ? 'ע"א' : 'ע"ב'}
            {amud === 1 && dafCounts.get(daf)?.a ? (
              <span className="text-gold mr-2 text-xs">({dafCounts.get(daf)?.a})</span>
            ) : null}
            {amud === 2 && dafCounts.get(daf)?.b ? (
              <span className="text-gold mr-2 text-xs">({dafCounts.get(daf)?.b})</span>
            ) : null}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>

        <Select value={layout} onValueChange={(v) => setLayout(v as Layout)}>
          <SelectTrigger><SelectValue placeholder="פריסה" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="split">טקסט + שאלות</SelectItem>
            <SelectItem value="text-only">טקסט בלבד</SelectItem>
            <SelectItem value="cards-only">שאלות בלבד</SelectItem>
          </SelectContent>
        </Select>

        <div className="col-span-2 lg:col-span-1 rounded-md border border-gold/20 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button onClick={goPrev} disabled={isFirst} variant="outline" size="sm" className="h-8 gap-1 px-2">
                <ChevronRight className="h-4 w-4" /> הקודם
              </Button>
              <Button onClick={goNext} disabled={isLast} variant="outline" size="sm" className="h-8 gap-1 px-2">
                הבא <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
            {layout === "split" && (
              <button
                type="button"
                className="h-6 w-6 rounded-sm border border-gold/40 text-navy hover:bg-gold/10 transition-colors"
                title={isStandaloneSplitPage ? "חזור למסך הראשי" : "פתח בעמוד נפרד"}
                onClick={handleSplitPageToggle}
              >
                {isStandaloneSplitPage ? <Minimize2 className="h-3.5 w-3.5 mx-auto" /> : <Maximize2 className="h-3.5 w-3.5 mx-auto" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );

  const gemara = <GemaraViewer masechta={masechta} daf={daf} amud={amud} className="h-full" isActive={isVisible} />;

  const startPractice = () => setStudyOpen(true);
  const practiceModeMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="outline" className="h-8 w-8 border-gold/50" title="הגדרות תרגול">
          {practiceMode === "inline" ? <PanelRightOpen className="h-4 w-4 text-gold" /> : <Maximize2 className="h-4 w-4 text-gold" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>פתיחת תרגול</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setPracticeMode("inline")} className={cn(practiceMode === "inline" && "bg-gold/10")}>
          <PanelRightOpen className="h-4 w-4 ml-2" /> ליד הגמרא (פאנל)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPracticeMode("fullscreen")} className={cn(practiceMode === "fullscreen" && "bg-gold/10")}>
          <Maximize2 className="h-4 w-4 ml-2" /> מסך מלא
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const practicePanel = (
    <Card className="gold-frame p-3 flex flex-col h-full" dir="rtl">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <GraduationCap className="h-4 w-4 text-gold" /> תרגול · {cards.length} שאלות
        </h3>
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7 border-gold/50"
                title="קנה מידה של התרגול"
              >
                <ZoomIn className="h-4 w-4 text-gold" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3" align="end" dir="rtl">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">קנה מידה</span>
                  <span className="font-bold text-gold">{Math.round(practiceScale * 100)}%</span>
                </div>
                <Slider
                  min={40}
                  max={100}
                  step={5}
                  value={[Math.round(practiceScale * 100)]}
                  onValueChange={(v) => setPracticeScale((v[0] ?? 100) / 100)}
                />
                <div className="flex items-center justify-between gap-1 pt-1">
                  <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={() => setPracticeScale(1)}>100%</Button>
                  <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={() => setPracticeScale(0.75)}>75%</Button>
                  <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={() => setPracticeScale(0.5)}>50%</Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="ghost" onClick={closePractice} className="h-7 gap-1">
            <X className="h-4 w-4" /> סגור תרגול
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <FitToContainer enabled={practiceScale !== 1} manualScale={practiceScale}>
          <StudySession
            key={cardIds.join(",")}
            deckId={null}
            mode="practice"
            cardIds={cardIds}
            onExit={closePractice}
            fillHeight={practiceScale !== 1}
          />
        </FitToContainer>
      </div>
    </Card>
  );

  const cardsPanel = (
    <Card className="gold-frame p-4 flex flex-col h-full" dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <ListChecks className="h-4 w-4 text-gold" /> שאלות לעמוד זה ({cards.length})
        </h3>
        {cards.length > 0 && (
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 border-gold/50"
              title="בחירה מהירה וסיווג"
              onClick={() => setBulkDeckDialogOpen(true)}
            >
              <Layers className="h-4 w-4 text-gold" />
            </Button>
            {practiceModeMenu}
            <Button onClick={startPractice} size="sm" className="bg-gradient-navy text-primary-foreground">
              <GraduationCap className="h-4 w-4" /> תרגול
            </Button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {cards.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-12">
            אין שאלות משויכות לעמוד זה.<br />
            <span className="text-xs">תוכל להוסיף שאלות בלשונית &quot;שאלות חזרה&quot; ולשייך אותן לקטגוריית &quot;{masechta} › דף {toGematria(daf)} › {amud === 1 ? 'ע"א' : 'ע"ב'}&quot;.</span>
          </div>
        ) : (
          cards.map((c, i) => (
            <div key={c.id} className="rounded-lg border border-gold/30 bg-card p-3 hover:border-gold/60 transition-colors">
              <div className="flex items-start gap-2">
                <span className="text-xs text-gold font-bold shrink-0 mt-0.5">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{c.question}</div>
                  <div className="text-xs text-muted-foreground mt-1 capitalize">
                    {c.type === "flashcard" && "פתוחה"}
                    {c.type === "multiple" && "אמריקאית"}
                    {c.type === "boolean" && "נכון/לא נכון"}
                    {c.type === "combo" && "משולבת"}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );

  const cardsContent = studyOpen && practiceMode === "inline" ? practicePanel : cardsPanel;
  const firstPanel = splitSide === "gemara-right" ? gemara : cardsContent;
  const secondPanel = splitSide === "gemara-right" ? cardsContent : gemara;

  return (
    <div className="space-y-4" dir="rtl">
      {navigator}
      <div style={{ height: "calc(100vh - 280px)", minHeight: 500 }}>
        {layout === "split" && (
          <>
            <div className="grid grid-cols-1 gap-4 lg:hidden h-full">
              <div className="min-h-0">{firstPanel}</div>
              <div className="min-h-0">{secondPanel}</div>
            </div>

            <div
              ref={splitContainerRef}
              className="hidden lg:flex h-full min-h-0 relative flex-row-reverse"
            >
              <div className="h-full min-h-0" style={{ width: `${splitRatio}%` }}>
                {firstPanel}
              </div>

              <div className="relative mx-1 w-2 shrink-0 group/divider">
                <button
                  type="button"
                  className="absolute top-2 left-1/2 z-10 -translate-x-1/2 h-7 w-7 rounded-full border border-gold/40 bg-card/90 text-navy shadow-sm backdrop-blur-sm opacity-0 transition-opacity group-hover/divider:opacity-100 hover:opacity-100 hover:bg-gold/10"
                  title={
                    splitSide === "gemara-right"
                      ? "החלף צדדים: גמרא לשמאל, שאלות לימין"
                      : "החלף צדדים: גמרא לימין, שאלות לשמאל"
                  }
                  onClick={() =>
                    setSplitSide((prev) =>
                      prev === "gemara-right" ? "gemara-left" : "gemara-right",
                    )
                  }
                >
                  <ArrowLeftRight className="h-3.5 w-3.5 mx-auto" />
                </button>

                <div
                  className={cn(
                    "w-2 h-full rounded-full bg-gold/20 hover:bg-gold/40 cursor-col-resize opacity-0 group-hover/divider:opacity-100 transition-[opacity,background-color]",
                    isResizing && "bg-gold/50 opacity-100",
                  )}
                  title="גרור לשינוי יחס"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setIsResizing(true);
                  }}
                />
              </div>

              <div className="h-full min-h-0" style={{ width: `${100 - splitRatio}%` }}>
                {secondPanel}
              </div>
            </div>
          </>
        )}

        {layout === "text-only" && (
          <div className="grid grid-cols-1 h-full">
            <div className="min-h-0">{gemara}</div>
          </div>
        )}

        {layout === "cards-only" && (
          <div className="grid grid-cols-1 h-full">
            <div className="min-h-0">{cardsContent}</div>
          </div>
        )}
      </div>

      <CardDecksDialog
        card={deckDialogCard}
        open={!!deckDialogCard}
        onOpenChange={(open) => {
          if (!open) setDeckDialogCard(null);
        }}
      />

      <BulkCardDecksDialog
        cards={cards}
        open={bulkDeckDialogOpen}
        onOpenChange={setBulkDeckDialogOpen}
      />

      <Dialog open={navDialogOpen} onOpenChange={setNavDialogOpen} modal={false}>
        <DialogContent
          className="max-w-none p-0 gap-0 overflow-hidden border-2 border-gold/60 bg-white shadow-[0_28px_80px_-34px_rgba(6,20,58,0.6)] left-0 top-0 translate-x-0 translate-y-0"
          dir="rtl"
          showOverlay={false}
          onKeyDown={handleNavDialogKeyDown}
          style={{
            left: navDialogPosition.x,
            top: navDialogPosition.y,
            width: navDialogSize.width,
            height: navDialogSize.height,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "calc(100vh - 12px)",
          }}
        >
          <DialogHeader
            className="px-5 pt-5 pb-3 bg-[linear-gradient(140deg,#ffffff_0%,#fffbf2_65%,#f8efe0_100%)] border-b border-gold/30 select-none cursor-move"
            onPointerDown={(ev) => {
              const target = ev.target as HTMLElement;
              if (target.closest("button,a,input,select,textarea,[role='button']")) return;
              startDialogDrag(ev);
            }}
          >
            <DialogTitle className="text-right text-navy flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2">
                <ActiveNavStepIcon className="h-5 w-5 text-navy" />
                {navStepMeta[navStep].label}
              </span>
              <span className="inline-flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 bg-white border-gold/55 text-navy hover:bg-gold/10 cursor-move touch-none"
                  title="גרור להזזת החלון"
                  onPointerDown={startDialogDrag}
                >
                  <Move className="h-4 w-4" />
                </Button>
                <span className="text-xs font-medium text-navy/65">ניווט מהיר</span>
              </span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              חלון בחירה מהיר של סדר, מסכת, דף ועמוד.
            </DialogDescription>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {(Object.keys(navStepMeta) as NavStep[]).map((stepKey) => {
                const StepIcon = navStepMeta[stepKey].icon;
                const selected = navStep === stepKey;
                return (
                  <Button
                    key={stepKey}
                    type="button"
                    size="sm"
                    variant="outline"
                    className={cn(
                      "h-9 gap-1.5 rounded-md border text-xs",
                      selected
                        ? "bg-white border-navy text-navy ring-1 ring-navy/25"
                        : "bg-white border-gold/50 text-navy hover:bg-gold/10 hover:text-navy",
                    )}
                    onClick={() => setNavStep(stepKey)}
                  >
                    <StepIcon className="h-3.5 w-3.5" />
                    {navStepMeta[stepKey].label.replace("בחירת ", "")}
                  </Button>
                );
              })}
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 space-y-3 p-5 bg-white overflow-y-auto">
            {navStep === "seder" && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SEDARIM.map((s) => (
                  <Button
                    key={s}
                    variant={s === navSeder ? "default" : "outline"}
                    className={cn(
                      "h-11 rounded-lg border text-base",
                      s === navSeder
                        ? "bg-navy text-white border-navy shadow-md"
                        : "bg-white border-gold/55 text-navy hover:bg-gold/10 hover:text-navy",
                    )}
                    onClick={() => handleChooseSeder(s)}
                  >
                    <Landmark className="h-4 w-4" />
                    {s}
                  </Button>
                ))}
              </div>
            )}

            {navStep === "masechta" && (
              <>
                <div className="flex items-center justify-between">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 bg-white border-gold/55 text-navy hover:bg-gold/10"
                    onClick={() => setNavStep("seder")}
                  >
                    <ChevronRight className="h-4 w-4" /> חזרה לסדרים
                  </Button>
                  <div className="text-sm text-muted-foreground">
                    בחר מסכת מתוך {navSeder}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[55vh] overflow-y-auto p-1">
                  {navMasechtos.map((m) => (
                    <Button
                      key={m.name}
                      variant={m.name === navMasechta ? "default" : "outline"}
                      className={cn(
                        "h-11 rounded-lg border",
                        m.name === navMasechta &&
                          "bg-navy text-white border-navy shadow-md",
                        m.name !== navMasechta &&
                          "bg-white border-gold/55 text-navy hover:bg-gold/10 hover:text-navy",
                      )}
                      onClick={() => handleChooseMasechta(m.name)}
                    >
                      <LibraryBig className="h-4 w-4" />
                      {m.name}
                    </Button>
                  ))}
                </div>
              </>
            )}

            {navStep === "daf" && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 bg-white border-gold/55 text-navy hover:bg-gold/10"
                    onClick={() => setNavStep("masechta")}
                  >
                    <ChevronRight className="h-4 w-4" /> חזרה למסכתות
                  </Button>
                  <div className="text-sm text-muted-foreground">
                    קבוצה {navDafPage + 1} מתוך {navDafPageCount}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 bg-white border-gold/55 text-navy hover:bg-gold/10"
                      disabled={!canGoPrevNavPage}
                      onClick={() => setNavDafPage((p) => Math.max(0, p - 1))}
                    >
                      <ChevronRight className="h-4 w-4" /> קודמת
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 bg-white border-gold/55 text-navy hover:bg-gold/10"
                      disabled={!canGoNextNavPage}
                      onClick={() => setNavDafPage((p) => Math.min(navDafPageCount - 1, p + 1))}
                    >
                      הבאה <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground text-center">
                  קיצורים: חץ ימין לקבוצה קודמת, חץ שמאל לקבוצה הבאה, Esc לסגירה
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2 max-h-[55vh] overflow-y-auto p-1">
                  {visibleNavDafs.map((d) => {
                    const selected = d === navDaf;
                    const cnt = navDafCounts.get(d)?.total ?? 0;
                    return (
                      <Button
                        key={d}
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        className={cn(
                          "h-11 rounded-lg border",
                          selected
                            ? "bg-navy text-white border-navy shadow-md"
                            : "bg-white border-gold/55 text-navy hover:bg-gold/10 hover:text-navy",
                        )}
                        onClick={() => handleChooseDaf(d)}
                      >
                        <Files className="h-3.5 w-3.5" />
                        <span className="text-xs">{dafLabel(d).replace(".", "")}</span>
                        {cnt > 0 ? (
                          <span className={cn("mr-1 text-[10px]", selected ? "text-primary-foreground/90" : "text-gold")}>({cnt})</span>
                        ) : null}
                      </Button>
                    );
                  })}
                </div>
              </>
            )}

            {navStep === "amud" && (
              <>
                <div className="flex items-center justify-between">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 bg-white border-gold/55 text-navy hover:bg-gold/10"
                    onClick={() => setNavStep("daf")}
                  >
                    <ChevronRight className="h-4 w-4" /> חזרה לדפים
                  </Button>
                  <div className="text-sm text-muted-foreground">
                    בחר עמוד עבור דף {dafLabel(navDaf).replace(".", "")}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant={navAmud === 1 ? "default" : "outline"}
                    className={cn(
                      "h-16 text-lg rounded-xl border",
                      navAmud === 1
                        ? "bg-navy text-white border-navy shadow-md"
                        : "bg-white border-gold/55 text-navy hover:bg-gold/10 hover:text-navy",
                    )}
                    onClick={() => applyNavSelection(1)}
                  >
                    <BookMarked className="h-4 w-4" />
                    ע"א
                    {navDafCounts.get(navDaf)?.a ? (
                      <span className="mr-2 text-sm">({navDafCounts.get(navDaf)?.a})</span>
                    ) : null}
                  </Button>
                  <Button
                    variant={navAmud === 2 ? "default" : "outline"}
                    className={cn(
                      "h-16 text-lg rounded-xl border",
                      navAmud === 2
                        ? "bg-navy text-white border-navy shadow-md"
                        : "bg-white border-gold/55 text-navy hover:bg-gold/10 hover:text-navy",
                    )}
                    onClick={() => applyNavSelection(2)}
                  >
                    <BookMarked className="h-4 w-4" />
                    ע"ב
                    {navDafCounts.get(navDaf)?.b ? (
                      <span className="mr-2 text-sm">({navDafCounts.get(navDaf)?.b})</span>
                    ) : null}
                  </Button>
                </div>
              </>
            )}
          </div>
          <div
            className="absolute top-12 bottom-7 right-0 w-2 cursor-ew-resize hover:bg-gold/20 touch-none"
            title="הרחבה או הצרה"
            onPointerDown={(e) => startDialogResize("e", e)}
          />
          <div
            className="absolute top-12 bottom-7 left-0 w-2 cursor-ew-resize hover:bg-gold/20 touch-none"
            title="הרחבה או הצרה"
            onPointerDown={(e) => startDialogResize("w", e)}
          />
          <div
            className="absolute bottom-0 left-7 right-7 h-2 cursor-ns-resize hover:bg-gold/20 touch-none"
            title="הגדלה או הקטנה לגובה"
            onPointerDown={(e) => startDialogResize("s", e)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

type LearnMode = "shas" | "mishna" | "chumash" | "neviim-ketuvim";
const MODE_STORAGE_KEY = "daf-learning-mode";

function DafLearningTab({ isVisible = true }: { isVisible?: boolean }) {
  const [mode, setMode] = useState<LearnMode>(() => {
    try {
      const stored = localStorage.getItem(MODE_STORAGE_KEY);
      if (stored === "daf") return "shas";
      if (stored === "shas" || stored === "mishna" || stored === "chumash" || stored === "neviim-ketuvim") return stored;
      return "shas";
    }
    catch { return "shas"; }
  });
  useEffect(() => {
    try { localStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const tabs: { id: LearnMode; label: string; icon: typeof BookText }[] = [
    { id: "shas",           label: "ש\"ס",            icon: Layers },
    { id: "mishna",         label: "משנה",            icon: BookText },
    { id: "chumash",        label: "חומש",            icon: Scroll },
    { id: "neviim-ketuvim", label: "נביאים וכתובים", icon: BookOpen },
  ];

  return (
    <div className="space-y-3" dir="rtl">
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(v) => v && setMode(v as LearnMode)}
        className="w-full flex justify-center gap-1 rounded-xl border-2 border-gold/40 bg-card p-1"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <ToggleGroupItem
              key={t.id}
              value={t.id}
              className="flex-1 max-w-[200px] gap-2 data-[state=on]:bg-gradient-navy data-[state=on]:text-primary-foreground"
            >
              <Icon className="h-4 w-4" /> {t.label}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      {mode === "shas"    && <DafLearningTabInner isVisible={isVisible} />}
      {mode === "mishna"  && <MishnaLearningTab />}
      {mode === "chumash" && <ChumashLearningTab />}
      {mode === "neviim-ketuvim" && <NeviimKetuvimLearningTab />}
    </div>
  );
}

const DafLearningTabMemo = memo(DafLearningTab);
export { DafLearningTabMemo as DafLearningTab };
