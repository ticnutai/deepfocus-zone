import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Home, Gauge, Sun, Calendar, CheckSquare, Target, BookOpen, Timer,
  Activity, ListChecks, Library, Folder, FileText, MessageCircle,
  Trophy, Archive, Settings, Menu, Sparkles, Sliders, SlidersHorizontal,
  Pin, PinOff, LogOut, Shield, FolderTree, Search, HardDrive,
  DatabaseZap, RefreshCw, UsersRound, Check, UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listLocalAccounts,
  getActiveUsername,
  switchLocalAccount,
} from "@/lib/auth/localAccount";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useIsMobile } from "@/hooks/use-mobile";
import { useStudy } from "@/lib/study/store";
import { useResolvedFeatureBlocklist } from "@/lib/study/featureBlocklist";
import { NavItem, DEFAULT_SIDEBAR_ITEMS, isDefaultSidebarItemVisible } from "@/config/sidebarItems";
import { usePrompt } from "@/hooks/usePrompt";
import { toast } from "@/hooks/use-toast";
import { canAccessAppSection } from "@/lib/auth/sectionAccess";
import { normalizeSplitWorkspaceSidebarConfig } from "@/lib/study/sidebarItems";

const ROUTE_ITEMS: NavItem[] = [
  { id: "sync-diagnostics", label: "אבחון סנכרון", icon: RefreshCw, to: "/sync-diagnostics" },
];

const Logo = ({ size = "md" }: { size?: "sm" | "md" }) => (
  <div className="flex items-center gap-2">
    <div className={cn("rounded-full bg-gradient-gold flex items-center justify-center shadow-gold",
      size === "md" ? "h-9 w-9" : "h-7 w-7")}>
      <Sparkles className={cn("text-navy", size === "md" ? "h-4 w-4" : "h-3.5 w-3.5")} />
    </div>
    <span className={cn("font-display font-bold text-foreground", size === "md" ? "text-xl" : "text-base")}>
      מעקב למידה
    </span>
  </div>
);

const NavList = ({
  items,
  routeItems,
  activeId,
  activePath,
  onSelect,
  onNavigate,
}: {
  items: (NavItem & { visible: boolean })[];
  routeItems: NavItem[];
  activeId: string;
  activePath: string;
  onSelect: (id: string) => void;
  onNavigate: (to: string) => void;
}) => (
  <nav className="flex flex-col gap-1 p-3">
    {items.filter((i) => i.visible || i.id === "summary").map((item) => {
      const Icon = item.icon;
      const isActive = activeId === item.id && activePath === "/";
      return (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={cn(
            "flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
            isActive
              ? "bg-gradient-navy text-primary-foreground shadow-elegant"
              : "text-foreground hover:bg-secondary",
          )}
        >
          <span>{item.label}</span>
          <span className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full border-2",
            isActive ? "border-gold bg-card/10 text-gold" : "border-gold/70 bg-card text-navy",
          )}>
            <Icon className="h-4 w-4" />
          </span>
        </button>
      );
    })}
    {routeItems.length > 0 && (
      <div className="mt-3 pt-3 border-t border-gold/30 flex flex-col gap-1">
        {routeItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePath === item.to;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.to!)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-gradient-navy text-primary-foreground shadow-elegant"
                  : "text-foreground hover:bg-secondary",
              )}
            >
              <span>{item.label}</span>
              <span className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2",
                isActive ? "border-gold bg-card/10 text-gold" : "border-gold/70 bg-card text-navy",
              )}>
                <Icon className="h-4 w-4" />
              </span>
            </button>
          );
        })}
      </div>
    )}
  </nav>
);

// In-app switcher between local (offline) accounts. Only meaningful in guest
// mode, where each account owns an isolated workspace parked by username. A
// switch parks the live workspace (after a synchronous flush) and swaps the
// target in, then reloads so the study store re-hydrates cleanly from it —
// the most reliable path, and instant on Electron's file:// origin.
const LocalAccountSwitcher = ({ onAddAccount }: { onAddAccount: () => void }) => {
  const [accounts, setAccounts] = useState(() => listLocalAccounts());
  const active = getActiveUsername();
  const [switching, setSwitching] = useState(false);

  if (accounts.length === 0) return null;

  const switchTo = async (uname: string) => {
    if (switching || uname === active) return;
    setSwitching(true);
    const ok = await switchLocalAccount(uname);
    if (!ok) {
      setSwitching(false);
      toast({ title: "החלפת החשבון נכשלה", variant: "destructive" });
      return;
    }
    // Clean, deterministic re-hydration of the study store from the new slot.
    window.location.reload();
  };

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) setAccounts(listLocalAccounts()); }}>
      <DropdownMenuTrigger asChild>
        <button
          title="החלפת חשבון מקומי"
          className="flex aspect-square items-center justify-center h-6 w-6 rounded-full border border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
        >
          <UsersRound className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" style={{ direction: "rtl" }}>
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">חשבונות מקומיים</DropdownMenuLabel>
        {accounts.map((acct) => {
          const isActive = acct.username === active;
          return (
            <DropdownMenuItem
              key={acct.username}
              disabled={switching}
              onSelect={(e) => { e.preventDefault(); void switchTo(acct.username); }}
              className="gap-2"
            >
              <span className="flex h-4 w-4 items-center justify-center shrink-0">
                {isActive && <Check className="h-4 w-4 text-gold" />}
              </span>
              <span className="flex-1 min-w-0 text-right">
                <span className="block text-sm truncate">{acct.displayName || acct.username}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {acct.status === "registered" ? "מסונכרן לשרת" : "ממתין לסנכרון"}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onAddAccount(); }} className="gap-2">
          <UserPlus className="h-4 w-4 text-gold" />
          <span className="text-sm">הוסף חשבון…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const SidebarFooter = ({
  onOpenSettings,
  onSignOut,
  onAddAccount,
  showAccountSwitcher,
  userLabel,
  userInitial,
  isAdmin,
}: {
  onOpenSettings: () => void;
  onSignOut: () => void;
  onAddAccount: () => void;
  showAccountSwitcher: boolean;
  userLabel: string;
  userInitial: string;
  isAdmin: boolean;
}) => (
  <div className="border-t-2 border-gold/40 p-2 flex-shrink-0">
    <div className="flex items-center gap-2 rounded-full border-2 border-gold/50 bg-card px-2 py-1.5">
      {/* Left: tiny round action icons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onSignOut}
          title="התנתקות"
          className="flex aspect-square items-center justify-center h-6 w-6 rounded-full border border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
        >
          <LogOut className="h-3 w-3" />
        </button>
        {showAccountSwitcher && <LocalAccountSwitcher onAddAccount={onAddAccount} />}
        <ThemeSwitcher />
      </div>

      {/* Middle: user identity (clickable → settings) */}
      <button
        onClick={onOpenSettings}
        title="הגדרות משתמש"
        className="flex-1 min-w-0 flex items-center gap-2 px-1 text-right hover:opacity-80 transition-opacity"
        dir="ltr"
      >
        <div className="flex-1 min-w-0 text-right" dir="rtl">
          <div className="text-[10px] font-medium text-navy leading-tight truncate" dir="ltr">{userLabel}</div>
          <div className={cn("text-[9px] font-semibold leading-tight", isAdmin ? "text-yellow-600" : "text-muted-foreground")}>
            {isAdmin ? "👑 מנהל" : "משתמש"}
          </div>
        </div>
        <div className="flex aspect-square h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-gold/70 bg-gradient-navy text-primary-foreground text-[10px] font-bold">
          {userInitial}
        </div>
      </button>
    </div>
  </div>
);

export function AppShellSidebar() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { user, signOut, isGuest } = useAuth();
  const { isAdmin: permissionIsAdmin, roles, can } = usePermissions();
  // Never expose administrator navigation to a local/offline identity, even
  // while a previous cloud session is being cleared.
  const isAdmin = permissionIsAdmin && !isGuest;
  const isMobile = useIsMobile();
  const { state } = useStudy();
  const previewRoleId = useMemo(() => new URLSearchParams(search).get("previewRole") ?? "", [search]);
  const roleIdsForBlocklist = useMemo(
    () => (previewRoleId ? [previewRoleId] : roles.map((r) => r.id)),
    [previewRoleId, roles],
  );
  const blocklist = useResolvedFeatureBlocklist(roleIdsForBlocklist, { scope: isMobile ? "mobile" : "desktop" });
  const sectionAccess = useMemo(() => ({
    isAdmin,
    canViewCards: isAdmin || can("cards", "view"),
    canViewDecks: isAdmin || can("decks", "view"),
    canViewGoals: isAdmin || can("goals", "view"),
    canViewShas: isAdmin || can("shas", "view"),
    canViewAnalytics: isAdmin || can("analytics", "view"),
    canViewSettings: isAdmin || can("settings", "view"),
  }), [can, isAdmin]);

  const activeId = useMemo(() => {
    const s = new URLSearchParams(search).get("section");
    return s ?? "home";
  }, [search]);

  const [pinned, setPinned] = useState<boolean>(() => {
    try { return localStorage.getItem("shell-sidebar-pinned") !== "false"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("shell-sidebar-pinned", String(pinned)); } catch { /* ignore */ }
  }, [pinned]);

  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarVisible = pinned || hovered;

  // Mobile edge-swipe gesture: a right→left swipe starting at the right
  // screen edge opens the sidebar sheet; a left→right swipe while open
  // closes it. Only active below the lg breakpoint.
  // Samsung Internet / Chrome Android reserve the very screen edge for the
  // system back gesture, so an edge-only listener never fires. We therefore
  // capture from a wider strip, listen on a dedicated overlay strip too, and
  // use non-passive touchmove so we can preventDefault once the horizontal
  // intent is clear and the browser doesn't steal the swipe.
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
      if (mobileOpen || t.clientX >= window.innerWidth - EDGE) {
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
      if (!mobileOpen && dx < -THRESHOLD) {
        setMobileOpen(true);
        tracking = false;
      } else if (mobileOpen && dx > THRESHOLD) {
        setMobileOpen(false);
        tracking = false;
      }
    };
    const onTouchEnd = () => { tracking = false; decided = false; };

    const opts: AddEventListenerOptions = { passive: false, capture: true };
    window.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    window.addEventListener("touchmove", onTouchMove, opts);
    window.addEventListener("touchend", onTouchEnd, { capture: true });
    window.addEventListener("touchcancel", onTouchEnd, { capture: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchmove", onTouchMove, opts as EventListenerOptions);
      window.removeEventListener("touchend", onTouchEnd, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchcancel", onTouchEnd, { capture: true } as EventListenerOptions);
    };
  }, [mobileOpen]);

  const orderedItems = useMemo(() => {
    const cfg = normalizeSplitWorkspaceSidebarConfig(state.sidebarConfig ?? []);
    if (cfg.length === 0) return DEFAULT_SIDEBAR_ITEMS.map((item) => ({
      ...item,
      visible: isDefaultSidebarItemVisible(item.id),
    }));
    const sorted = [...cfg].sort((a, b) => a.order - b.order);
    const used = new Set<string>();
    const result: (NavItem & { visible: boolean })[] = [];
    for (const c of sorted) {
      if (used.has(c.id)) continue;
      const def = DEFAULT_SIDEBAR_ITEMS.find((i) => i.id === c.id);
      if (!def) continue;
      result.push({ ...def, visible: c.visible });
      used.add(c.id);
    }
    for (const def of DEFAULT_SIDEBAR_ITEMS) {
      if (!used.has(def.id)) result.push({ ...def, visible: isDefaultSidebarItemVisible(def.id) });
    }
    const blockedSet = new Set(blocklist.sections ?? []);
    return result
      .filter((i) => canAccessAppSection(i.id, sectionAccess))
      .filter((i) => (isAdmin && !previewRoleId) || !blockedSet.has(i.id));
  }, [state.sidebarConfig, isAdmin, previewRoleId, blocklist, sectionAccess]);

  const allowedRouteItems = useMemo(
    () => ROUTE_ITEMS.filter((item) => canAccessAppSection(item.id, sectionAccess)),
    [sectionAccess],
  );

  const SETTINGS_PW = "543211";
  const { prompt: promptText, dialog: promptDialog } = usePrompt();
  // Async settings gate — window.prompt is not supported inside Electron
  // (the call silently fails), so we use the usePrompt dialog instead.
  const requireSettingsAuth = async (): Promise<boolean> => {
    try {
      if (sessionStorage.getItem("settings-unlocked") === "1") return true;
    } catch { /* ignore */ }
    const input = await promptText("להזנת אזור ההגדרות יש להזין סיסמה:", {
      title: "אזור הגדרות",
      password: true,
    });
    if (input === null) return false;
    if (input === SETTINGS_PW) {
      try { sessionStorage.setItem("settings-unlocked", "1"); } catch { /* ignore */ }
      return true;
    }
    toast({ title: "סיסמה שגויה", variant: "destructive" });
    return false;
  };

  const goSection = async (id: string) => {
    if (!canAccessAppSection(id, sectionAccess)) {
      toast({ title: "אין הרשאה לפתוח אזור זה", variant: "destructive" });
      return;
    }
    if (id === "settings" && !(await requireSettingsAuth())) return;
    if (id === "summary") {
      try { localStorage.setItem("active-tab", "summary"); } catch { /* ignore */ }
      navigate("/?section=home");
      if (!pinned) setHovered(false);
      setMobileOpen(false);
      return;
    }
    if (pathname !== "/") {
      navigate(`/?section=${id}`);
    } else {
      navigate(`/?section=${id}`, { replace: true });
    }
    if (!pinned) setHovered(false);
    setMobileOpen(false);
  };
  const goRoute = (to: string) => {
    navigate(to);
    if (!pinned) setHovered(false);
    setMobileOpen(false);
  };

  const userInitial = isGuest ? "א" : (user?.email?.[0] ?? "?").toUpperCase();
  const userLabel = isGuest ? "אורח" : (user?.email ?? "");

  // Adding another local account = leave the current session and land on the
  // sign-up screen; the new offline account gets its own isolated workspace.
  const addLocalAccount = () => {
    void signOut();
    navigate("/auth");
  };

  return (
    <>
      {/* Edge trigger zone when not pinned */}
      {!pinned && (
        <div
          className="fixed right-0 top-0 h-full w-3 z-50 hidden lg:block"
          onMouseEnter={() => setHovered(true)}
        />
      )}

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col bg-sidebar",
          pinned
            ? "w-64 h-screen sticky top-0 self-start flex-shrink-0"
            : "fixed right-0 top-0 h-screen w-64 z-40 shadow-2xl transition-transform duration-300",
          !pinned && !sidebarVisible && "translate-x-full",
        )}
        onMouseLeave={() => !pinned && setHovered(false)}
      >
        <div className="px-4 h-[60px] border-b-2 border-gold/40 flex items-center justify-between">
          <button
            onClick={() => { setPinned((v) => !v); setHovered(false); }}
            title={pinned ? "בטל הצמדה" : "הצמד סרגל"}
            className="flex items-center justify-center h-8 w-8 rounded-full hover:bg-secondary text-gold hover:text-navy transition-colors"
          >
            {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </button>
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <NavList
            items={orderedItems}
            routeItems={allowedRouteItems}
            activeId={activeId}
            activePath={pathname}
            onSelect={goSection}
            onNavigate={goRoute}
          />
          <SidebarFooter
            onOpenSettings={() => goSection("settings")}
            onSignOut={() => signOut()}
            onAddAccount={addLocalAccount}
            showAccountSwitcher={isGuest}
            userLabel={userLabel}
            userInitial={userInitial}
            isAdmin={isAdmin}
          />
        </div>
      </aside>

      {/* Mobile edge strip: claims the right edge so the browser's own
          back/side gesture doesn't swallow the swipe. */}
      {!mobileOpen && (
        <div
          aria-hidden
          className="lg:hidden fixed right-0 top-0 h-full w-6 z-[45]"
          style={{ touchAction: "none" }}
        />
      )}

      {/* Mobile trigger + sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen} modal={false}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden fixed top-2 right-2 z-50 rounded-full border-2 border-gold h-10 w-10 bg-background shadow-md"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" showOverlay={false} className="w-72 p-0 border-l-2 border-gold flex flex-col">
          <div className="p-4 border-b-2 border-gold/30 flex-shrink-0"><Logo /></div>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <NavList
              items={orderedItems}
              routeItems={allowedRouteItems}
              activeId={activeId}
              activePath={pathname}
              onSelect={goSection}
              onNavigate={goRoute}
            />
            <SidebarFooter
              onOpenSettings={() => goSection("settings")}
              onSignOut={() => signOut()}
              onAddAccount={addLocalAccount}
              showAccountSwitcher={isGuest}
              userLabel={userLabel}
              userInitial={userInitial}
              isAdmin={isAdmin}
            />
          </div>
        </SheetContent>
      </Sheet>
      {promptDialog}
    </>
  );
}
