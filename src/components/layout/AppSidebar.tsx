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
import { useIsMobile } from "@/hooks/use-mobile";
import { useStudy } from "@/lib/study/store";
import { useResolvedFeatureBlocklist } from "@/lib/study/featureBlocklist";
import { NavItem, DEFAULT_SIDEBAR_ITEMS } from "@/config/sidebarItems";

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
  <div className="border-t-2 border-gold/40 p-2 flex-shrink-0">
    <div className="flex items-center gap-1.5 rounded-full border-2 border-gold/50 bg-card px-2 py-1.5">
      {/* Left: small round action icons (gold border, white bg, navy icon) */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onSignOut}
          title="התנתקות"
          className="flex items-center justify-center h-7 w-7 rounded-full border-2 border-gold/70 bg-card text-navy hover:bg-secondary transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
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
          <div className="text-[11px] font-medium text-navy leading-tight truncate" dir="ltr">{userLabel}</div>
          <div className={cn("text-[9px] font-semibold leading-tight", isAdmin ? "text-yellow-600" : "text-muted-foreground")}>
            {isAdmin ? "👑 מנהל" : "משתמש"}
          </div>
        </div>
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 border-gold/70 bg-gradient-navy text-primary-foreground text-[11px] font-bold">
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
  const { isAdmin, roles } = usePermissions();
  const isMobile = useIsMobile();
  const { state } = useStudy();
  const previewRoleId = useMemo(() => new URLSearchParams(search).get("previewRole") ?? "", [search]);
  const roleIdsForBlocklist = useMemo(
    () => (previewRoleId ? [previewRoleId] : roles.map((r) => r.id)),
    [previewRoleId, roles],
  );
  const blocklist = useResolvedFeatureBlocklist(roleIdsForBlocklist, { scope: isMobile ? "mobile" : "desktop" });

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
    const blockedSet = new Set(blocklist.sections ?? []);
    return result
      .filter((i) => i.id !== "admin" || isAdmin)
      .filter((i) => (isAdmin && !previewRoleId) || !blockedSet.has(i.id));
  }, [state.sidebarConfig, isAdmin, previewRoleId, blocklist]);

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
          <SidebarFooter
            onOpenSettings={() => goSection("settings")}
            onSignOut={() => signOut()}
            userLabel={userLabel}
            userInitial={userInitial}
            isAdmin={isAdmin}
          />
        </div>
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
            <SidebarFooter
              onOpenSettings={() => goSection("settings")}
              onSignOut={() => signOut()}
              userLabel={userLabel}
              userInitial={userInitial}
              isAdmin={isAdmin}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
