import { Outlet, useLocation } from "react-router-dom";
import { AppShellSidebar } from "./AppSidebar";

export default function AppLayout() {
  const { pathname } = useLocation();
  // Index renders its own sidebar/topbar; only show shared shell on other routes.
  const showShell = pathname !== "/";

  if (!showShell) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen flex w-full bg-background" dir="rtl">
      <AppShellSidebar />
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
