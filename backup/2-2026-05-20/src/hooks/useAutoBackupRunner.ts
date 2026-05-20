/**
 * useAutoBackupRunner
 * Runs a background interval that checks if an auto-backup is due
 * and executes it silently (no UI feedback).
 * Mount this once at the app root (Index.tsx).
 */
import { useEffect, useRef } from "react";
import { useStudy } from "@/lib/study/store";
import { useAuth } from "./useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  loadAutoBackupConfig, saveAutoBackupConfig,
  retrieveFolderHandle, queryFolderPermission,
  writeAutoBackup, buildAutoSnapshot,
} from "@/lib/study/autoBackup";
import { saveCloudBackup } from "@/lib/study/backup";

export function useAutoBackupRunner() {
  const { state } = useStudy();
  const { user }  = useAuth();

  // Stable refs so the interval callback always sees latest values
  const stateRef  = useRef(state);
  const userRef   = useRef(user);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { userRef.current  = user;  }, [user]);

  const busy = useRef(false);

  useEffect(() => {
    const tick = async () => {
      if (busy.current) return;
      const cfg = loadAutoBackupConfig();
      if (!cfg.enabled) return;

      const lastRun  = cfg.lastRunAt ? new Date(cfg.lastRunAt).getTime() : 0;
      const due      = Date.now() - lastRun >= cfg.intervalMinutes * 60 * 1000;
      if (!due) return;

      busy.current = true;
      try {
        const s    = stateRef.current;
        const u    = userRef.current;
        const snap = buildAutoSnapshot(s, cfg.topics, u?.email ?? undefined);

        if (cfg.cloudEnabled && u?.id) {
          try {
            await saveCloudBackup(
              supabase, u.id,
              `אוטומטי ${new Date().toLocaleDateString("he-IL")}`,
              snap,
            );
          } catch { /* silent */ }
        }

        if (cfg.localEnabled) {
          const dir  = await retrieveFolderHandle();
          if (dir) {
            const perm = await queryFolderPermission(dir);
            if (perm === "granted") {
              try { await writeAutoBackup(dir, snap, cfg.maxLocalBackups); }
              catch { /* silent */ }
            }
          }
        }

        saveAutoBackupConfig({ ...cfg, lastRunAt: new Date().toISOString() });
      } finally {
        busy.current = false;
      }
    };

    // Check immediately, then every minute
    void tick();
    const id = window.setInterval(() => { void tick(); }, 60_000);
    return () => window.clearInterval(id);
  }, []); // stable — reads state/user via refs
}
