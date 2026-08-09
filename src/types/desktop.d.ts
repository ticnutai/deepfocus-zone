export {};

type DesktopUpdateStatus =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version?: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "development"; version: string }
  | { type: "error"; message: string };

declare global {
  interface Window {
    desktop?: {
      isElectron: boolean;
      platform: string;
      versions: Record<string, string>;
      installation?: {
        getPendingEvents: () => Promise<Array<{ id: string; eventType: "install" | "update"; fromVersion: string | null; toVersion: string; installId: string; occurredAt: string }>>;
        acknowledge: (eventId: string) => Promise<unknown>;
      };
      updates?: {
        getVersion: () => Promise<string>;
        check: () => Promise<unknown>;
        download: () => Promise<unknown>;
        install: () => Promise<unknown>;
        onStatus: (callback: (status: DesktopUpdateStatus) => void) => () => void;
      };
    };
  }
}
