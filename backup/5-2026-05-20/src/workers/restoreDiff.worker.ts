/**
 * Web Worker: computes the restore diff off the main thread.
 *
 * Receives:  { state: StudyState, snapshot: BackupSnapshot }
 * Responds:  RestoreDiff
 *
 * Imported via Vite's ?worker suffix:
 *   import RestoreDiffWorker from "@/workers/restoreDiff.worker?worker";
 */
import { buildRestoreDiff } from "@/lib/study/restoreDiff";
import type { StudyState } from "@/lib/study/types";
import type { BackupSnapshot } from "@/lib/study/backup";
import type { RestoreDiff } from "@/lib/study/restoreDiff";

self.onmessage = (e: MessageEvent<{ state: StudyState; snapshot: BackupSnapshot }>) => {
  const result: RestoreDiff = buildRestoreDiff(e.data.state, e.data.snapshot);
  self.postMessage(result);
};
