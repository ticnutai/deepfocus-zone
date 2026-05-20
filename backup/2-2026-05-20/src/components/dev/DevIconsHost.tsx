import { useStudy } from "@/lib/study/store";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";

interface Props {
  PerfMonitor: React.ComponentType;
}

export function DevIconsHost({ PerfMonitor }: Props) {
  const { state } = useStudy();
  const showPerf = !!state.uiPrefs?.devShowPerfMonitor;
  const showSync = !!state.uiPrefs?.devShowSyncIndicator;
  return (
    <>
      {showPerf && <PerfMonitor />}
      {showSync && <SyncStatusIndicator />}
    </>
  );
}
