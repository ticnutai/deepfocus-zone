/**
 * RestoreContext — global provider for the long-running backup-restore engine.
 *
 * The actual engine (with its async loop, checkpointing, throttling, etc.)
 * lives inside `RestoreDiffDialog`. By mounting that dialog once at app root
 * (via `GlobalRestoreHost`) and driving its inputs from this context, the
 * restore work survives navigation between sidebar pages — and the floating
 * "stop / resume" widget stays visible from anywhere in the app.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  RestoreBackgroundCommand,
  RestoreRuntimeStatus,
} from "@/components/study/RestoreDiffDialog";
import type { BackupSnapshot } from "@/lib/study/backup";

const INITIAL_RUNTIME: RestoreRuntimeStatus = {
  running: false,
  resumeAvailable: false,
  phase: "",
  percent: 0,
  processed: 0,
  total: 0,
};

interface RestoreContextValue {
  snapshot: BackupSnapshot | null;
  dialogOpen: boolean;
  runtime: RestoreRuntimeStatus;
  command: RestoreBackgroundCommand;
  widgetExpanded: boolean;

  openRestore: (snap: BackupSnapshot) => void;
  setDialogOpen: (open: boolean) => void;
  setRuntime: (status: RestoreRuntimeStatus) => void;
  sendCommand: (type: "stop" | "resume") => void;
  setWidgetExpanded: (next: boolean | ((prev: boolean) => boolean)) => void;
}

const RestoreContext = createContext<RestoreContextValue | null>(null);

export function RestoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<BackupSnapshot | null>(null);
  const [dialogOpen, setDialogOpenRaw] = useState(false);
  const [runtime, setRuntime] = useState<RestoreRuntimeStatus>(INITIAL_RUNTIME);
  const [command, setCommand] = useState<RestoreBackgroundCommand>({ type: "none", nonce: 0 });
  const [widgetExpanded, setWidgetExpanded] = useState(false);

  const openRestore = useCallback((snap: BackupSnapshot) => {
    setSnapshot(snap);
    setDialogOpenRaw(true);
    setWidgetExpanded(false);
  }, []);

  const setDialogOpen = useCallback((open: boolean) => {
    setDialogOpenRaw(open);
  }, []);

  const sendCommand = useCallback((type: "stop" | "resume") => {
    setCommand((prev) => ({ type, nonce: prev.nonce + 1 }));
  }, []);

  const value = useMemo<RestoreContextValue>(() => ({
    snapshot,
    dialogOpen,
    runtime,
    command,
    widgetExpanded,
    openRestore,
    setDialogOpen,
    setRuntime,
    sendCommand,
    setWidgetExpanded,
  }), [snapshot, dialogOpen, runtime, command, widgetExpanded, openRestore, setDialogOpen, sendCommand]);

  return <RestoreContext.Provider value={value}>{children}</RestoreContext.Provider>;
}

export function useRestoreContext(): RestoreContextValue {
  const ctx = useContext(RestoreContext);
  if (!ctx) {
    throw new Error("useRestoreContext must be used inside <RestoreProvider>");
  }
  return ctx;
}
