import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { ThemeStudioProvider, useThemeStudio } from "@/theme/ThemeStudioProvider";

const setUiPref = vi.fn();
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" }, isGuest: false }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isAdmin: true, viewerIsAdmin: true }) }));
vi.mock("@/lib/study/store", () => ({ useStudy: () => ({ state: { uiPrefs: {} }, setUiPref }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      upsert: () => Promise.resolve({ error: null }),
    }),
  },
}));

function Harness({ onActivate }: { onActivate?: () => void }) {
  const studio = useThemeStudio();
  return <div><button onClick={studio.start}>התחל עיצוב</button><button data-testid="real-target" onClick={onActivate} className="sample-component">רכיב אמיתי</button></div>;
}

describe("live design mode", () => {
  beforeEach(() => {
    localStorage.clear(); setUiPref.mockClear();
    class ResizeObserverMock { observe() {} disconnect() {} }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("captures a real element, saves a scoped rule, and supports undo", async () => {
    render(<ThemeProvider><ThemeStudioProvider><Harness /></ThemeStudioProvider></ThemeProvider>);
    fireEvent.click(screen.getByText("התחל עיצוב"));
    fireEvent.pointerDown(screen.getByTestId("real-target"));
    expect(await screen.findByText("עריכה חיה")).toBeInTheDocument();
    fireEvent.click(screen.getByText("כל רכיב דומה"));
    fireEvent.click(screen.getByText("שמור עיצוב"));
    await waitFor(() => expect(document.getElementById("design-mode-overrides")?.textContent).toContain(".sample-component"));
    expect(JSON.parse(localStorage.getItem("app-theme-design-v1") || "{}").rules).toHaveLength(1);
    fireEvent.click(screen.getByTitle("בטל"));
    await waitFor(() => expect(document.getElementById("design-mode-overrides")?.textContent).toBe(""));
  });

  it("replays Alt-click exactly once without selecting the element", async () => {
    const activated = vi.fn();
    render(<ThemeProvider><ThemeStudioProvider><Harness onActivate={activated} /></ThemeStudioProvider></ThemeProvider>);
    fireEvent.click(screen.getByText("התחל עיצוב"));
    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "altKey", { value: true });
    screen.getByTestId("real-target").dispatchEvent(event);
    expect(activated).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("עריכה חיה")).not.toBeInTheDocument();
  });
});
