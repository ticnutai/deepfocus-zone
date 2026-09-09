import { useCallback } from "react";
import { useStudy } from "@/lib/study/store";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { buildSnapshot, saveCloudBackup, exportJson } from "@/lib/study/backup";

export interface PreUpdateBackupResult {
  ok: boolean;
  method: "cloud" | "local" | "error";
}

export interface PreUpdateBackupOptions {
  localCopyOnly?: boolean;
}

/**
 * Backs up everything the user added (cards, decks/tests, categories, goals,
 * ש"ס progress, ...) right before a mandatory app update installs, so a
 * forced update can never lose local work.
 *
 * - Signed-in cloud users: flushes any pending local edits to the cloud
 *   (requestCloudSyncNow) and additionally saves a labeled restore-point
 *   snapshot.
 * - Guest / local-account users have no cloud identity — a full snapshot is
 *   downloaded as a local JSON file instead.
 */
export function usePreUpdateBackup() {
  const { state, requestCloudSyncNow } = useStudy();
  const { user, isGuest } = useAuth();

  return useCallback(async (options: PreUpdateBackupOptions = {}): Promise<PreUpdateBackupResult> => {
    try {
      const snapshot = buildSnapshot(
        state,
        user?.email ?? "גיבוי אוטומטי לפני עדכון",
      );

      if (options.localCopyOnly) {
        exportJson(snapshot);
        return { ok: true, method: "local" };
      }

      if (!isGuest && user?.id) {
        await requestCloudSyncNow("pre-update-backup");
        await saveCloudBackup(
          supabase,
          user.id,
          `גיבוי אוטומטי לפני עדכון — ${new Date().toLocaleString("he-IL")}`,
          snapshot,
          ["system:pre-update"],
        );

        const { error: pruneError } = await supabase.rpc("prune_preupdate_backups", { p_keep: 2 });
        if (pruneError) throw pruneError;

        return { ok: true, method: "cloud" };
      }

      exportJson(snapshot);
      return { ok: true, method: "local" };
    } catch (err) {
      console.error("[pre-update-backup] failed:", err);
      return { ok: false, method: "error" };
    }
  }, [state, requestCloudSyncNow, user, isGuest]);
}
