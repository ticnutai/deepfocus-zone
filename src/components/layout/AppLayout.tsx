import { Outlet } from "react-router-dom";
import { AppShellSidebar } from "./AppSidebar";

export default function AppLayout() {
  return (
    <div className="min-h-screen flex w-full bg-background" dir="rtl">
      <AppShellSidebar />
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
