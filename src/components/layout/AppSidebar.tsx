import {
  Home, Gauge, Sun, Calendar, CheckSquare, Target, BookOpen, Timer,
  Activity, ListChecks, Library, Folder, FileText, MessageCircle,
  Trophy, Archive, Settings, Shield, FolderTree, Search, HardDrive,
  DatabaseZap, RefreshCw,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type Item = { id: string; label: string; icon: typeof Home; to?: string };

// Items that navigate to Index with a ?section query param
const SECTION_ITEMS: Item[] = [
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

const ROUTE_ITEMS: Item[] = [
  { id: "sync-diagnostics", label: "אבחון סנכרון", icon: RefreshCw, to: "/sync-diagnostics" },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const currentSection = new URLSearchParams(search).get("section");

  const isSectionActive = (id: string) =>
    pathname === "/" && (currentSection === id || (!currentSection && id === "home"));

  const goToSection = (id: string) => {
    navigate(`/?section=${id}`);
  };

  return (
    <Sidebar collapsible="icon" side="right">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>ניווט</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {SECTION_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = isSectionActive(item.id);
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={active}
                      onClick={() => goToSection(item.id)}
                      tooltip={item.label}
                      className={cn(active && "bg-sidebar-accent text-sidebar-accent-foreground")}
                    >
                      <Icon className="h-4 w-4" />
                      {!collapsed && <span>{item.label}</span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>כלים</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ROUTE_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton asChild tooltip={item.label} isActive={pathname === item.to}>
                      <NavLink to={item.to!}>
                        <Icon className="h-4 w-4" />
                        {!collapsed && <span>{item.label}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
