import { useStudy } from "@/lib/study/store";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { DeepRefreshFab } from "@/components/dev/DeepRefreshFab";
import { usePermissions } from "@/hooks/usePermissions";

interface Props {
  PerfMonitor: React.ComponentType;
}

export function DevIconsHost({ PerfMonitor }: Props) {
  const { isAdmin } = usePermissions();
  const { state } = useStudy();
  const isDevBuild = !import.meta.env.PROD;
  if (!isDevBuild || !isAdmin) return null;

  const showPerf = !!state.uiPrefs?.devShowPerfMonitor;
  const showSync = !!state.uiPrefs?.devShowSyncIndicator;
  const showDeepRefresh = !!state.uiPrefs?.devShowDeepRefreshFab;
  return (
    <>
      {showPerf && <PerfMonitor />}
      {showSync && <SyncStatusIndicator />}
      {showDeepRefresh && <DeepRefreshFab />}
    </>
  );
}
