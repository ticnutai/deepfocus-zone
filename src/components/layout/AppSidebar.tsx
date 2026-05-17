import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Home, Gauge, Sun, Calendar, CheckSquare, Target, BookOpen, Timer,
  Activity, ListChecks, Library, Folder, FileText, MessageCircle,
  Trophy, Archive, Settings, Menu, Sparkles, Sliders, SlidersHorizontal,
  Pin, PinOff, LogOut, Shield, FolderTree, Search, HardDrive,
  DatabaseZap, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useStudy } from "@/lib/study/store";

type NavItem = { id: string; label: string; icon: typeof Home; to?: string };

const DEFAULT_SIDEBAR_ITEMS: NavItem[] = [
  { id: "home", label: "בית", icon: Home },
  { id: "blocker", label: "בודק רצפים", icon: Gauge },
  { id: "morning", label: "קימה בבוקר", icon: Sun },
  { id: "today", label: "היום שלי", icon: Calendar },
  { id: "tasks", label: "לוח משימות", icon: CheckSquare },
  { id: "cards", label: "שאלות חזרה", icon: BookOpen },
  { id: "categories", label: "קטגוריות", icon: FolderTree },
  { id: "search", label: "חיפוש חכם", icon: Search },
  { id: "habits", label: "הרגלים", icon: Target },
  { id: "journal", label: "יומן", icon: BookOpen },
  { id: "timer", label: "טיימר", icon: Timer },
  { id: "monitor", label: "בקרת מעקב", icon: Activity },
  { id: "goals", label: "יעדים יומיים", icon: ListChecks },
  { id: "book", label: "הספר שלי", icon: Library },
  { id: "studio", label: "סטודיו מסמכים", icon: Folder },
  { id: "pdf", label: "צפיין PDF", icon: FileText },
  { id: "ai", label: "מאמן AI", icon: MessageCircle },
  { id: "achievements", label: "הישגים", icon: Trophy },
  { id: "archive", label: "ארכיון", icon: Archive },
  { id: "backup-restore", label: "גיבוי ושחזור", icon: HardDrive },
  { id: "db-inspector", label: "מסד נתונים", icon: DatabaseZap },
  { id: "admin", label: "ניהול משתמשים", icon: Shield },
  { id: "settings", label: "הגדרות", icon: Settings },
];

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
    {items.filter((i) => i.visible).map((item) => {
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

const SidebarFooter = ({
  onOpenSettings,
  onSignOut,
  userLabel,
  userInitial,
  isAdmin,
}: {
  onOpenSettings: () => void;
  onSignOut: () => void;
  userLabel: string;
  userInitial: string;
  isAdmin: boolean;
}) => (
  <div className="border-t-2 border-gold/40 p-3 space-y-2 flex-shrink-0">
    <button
      onClick={onOpenSettings}
      className="w-full flex items-center gap-2 rounded-xl border-2 border-gold/40 bg-card px-3 py-2 hover:bg-secondary transition-colors text-right"
      title="הגדרות משתמש"
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-navy text-primary-foreground text-sm font-bold">
        {userInitial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground truncate">{userLabel}</div>
        <div className={cn("text-[10px] font-semibold", isAdmin ? "text-yellow-500" : "text-muted-foreground")}>
          {isAdmin ? "👑 מנהל" : "משתמש"}
        </div>
      </div>
      <Settings className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
    </button>
    <div className="flex items-center justify-between gap-1">
      <button
        onClick={onSignOut}
        title="התנתקות"
        className="flex items-center justify-center h-9 w-9 rounded-full border-2 border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
      >
        <LogOut className="h-4 w-4" />
      </button>
      <ThemeSwitcher />
    </div>
  </div>
);

export function AppShellSidebar() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { user, signOut, isGuest } = useAuth();
  const { isAdmin } = usePermissions();
  const { state } = useStudy();

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

  const orderedItems = useMemo(() => {
    const cfg = state.sidebarConfig ?? [];
    if (cfg.length === 0) return DEFAULT_SIDEBAR_ITEMS.map((item) => ({ ...item, visible: true }));
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
      if (!used.has(def.id)) result.push({ ...def, visible: true });
    }
    return result.filter((i) => i.id !== "admin" || isAdmin);
  }, [state.sidebarConfig, isAdmin]);

  const goSection = (id: string) => {
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
            routeItems={ROUTE_ITEMS}
            activeId={activeId}
            activePath={pathname}
            onSelect={goSection}
            onNavigate={goRoute}
          />
        </div>
        <SidebarFooter
          onOpenSettings={() => goSection("settings")}
          onSignOut={() => signOut()}
          userLabel={userLabel}
          userInitial={userInitial}
          isAdmin={isAdmin}
        />
      </aside>

      {/* Mobile trigger + sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
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
        <SheetContent side="right" className="w-72 p-0 border-l-2 border-gold flex flex-col">
          <div className="p-4 border-b-2 border-gold/30 flex-shrink-0"><Logo /></div>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <NavList
              items={orderedItems}
              routeItems={ROUTE_ITEMS}
              activeId={activeId}
              activePath={pathname}
              onSelect={goSection}
              onNavigate={goRoute}
            />
          </div>
          <SidebarFooter
            onOpenSettings={() => goSection("settings")}
            onSignOut={() => signOut()}
            userLabel={userLabel}
            userInitial={userInitial}
            isAdmin={isAdmin}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
