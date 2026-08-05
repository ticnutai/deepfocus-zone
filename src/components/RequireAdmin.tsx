import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";

/** Route-level guard for management and diagnostic pages. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { loading: authLoading } = useAuth();
  const { isAdmin, loading: permissionsLoading } = usePermissions();

  if (authLoading || permissionsLoading) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        טוען…
      </div>
    );
  }

  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

