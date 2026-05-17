import { lazy, Suspense, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { AuthProvider } from "@/hooks/useAuth";
import { PermissionsProvider } from "@/hooks/usePermissions";
import { RequireAuth } from "@/components/RequireAuth";
import { RestoreProvider } from "@/lib/study/RestoreContext";
import { GlobalRestoreHost } from "@/components/study/GlobalRestoreHost";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";

const Index = lazy(() => import("./pages/Index.tsx"));
const Auth = lazy(() => import("./pages/Auth.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const PlanDetail = lazy(() => import("./pages/PlanDetail.tsx"));
const SyncDiagnostics = lazy(() => import("./pages/SyncDiagnostics.tsx"));
const AppLayout = lazy(() => import("./components/layout/AppLayout.tsx"));
const PerfMonitor = lazy(() => import("@/components/dev/PerfMonitor").then((m) => ({ default: m.PerfMonitor })));

const queryClient = new QueryClient();

// In Electron the app loads via file:// where BrowserRouter cannot push paths.
// The preload script exposes `window.desktop`; fall back to HashRouter there.
const isElectron =
  typeof window !== "undefined" &&
  ((window as unknown as { desktop?: { isElectron?: boolean } }).desktop?.isElectron === true);
const Router = isElectron ? HashRouter : BrowserRouter;

const routerFutureFlags = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

function DeferredPerfMonitor() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 10_000);
    return () => window.clearTimeout(id);
  }, []);

  if (!ready) return null;
  return <PerfMonitor />;
}

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Router future={routerFutureFlags}>
          <AuthProvider>
            <PermissionsProvider>
            <RestoreProvider>
            <Suspense fallback={null}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/" element={<RequireAuth><Index /></RequireAuth>} />
              <Route path="/plan/:planId" element={<PlanDetail />} />
              <Route path="/sync-diagnostics" element={<RequireAuth><SyncDiagnostics /></RequireAuth>} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            <Suspense fallback={null}>
              <DeferredPerfMonitor />
            </Suspense>
            <GlobalRestoreHost />
            <SyncStatusIndicator />
            </RestoreProvider>
            </PermissionsProvider>
          </AuthProvider>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
