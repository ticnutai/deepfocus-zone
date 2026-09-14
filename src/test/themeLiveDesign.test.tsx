import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { ThemeStudioProvider, useThemeStudio } from "@/theme/ThemeStudioProvider";

const setUiPref = vi.fn();
const authState: { user: { id: string } | null; isGuest: boolean } = { user: { id: "admin-1" }, isGuest: false };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));
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
  return <div><button onClick={studio.start}>התחל עיצוב</button><button data-testid="real-target" onClick={onActivate} className="sample-component">רכיב אמיתי</button><button data-testid="utility-target" className="relative">רכיב פריסה</button></div>;
}

function ThemeControls() {
  const { setTheme } = useTheme();
  return <div data-design-mode-ui><button onClick={() => setTheme("mobile-focus")}>חלופה</button><button onClick={() => setTheme("royal-navy")}>מקור</button></div>;
}

describe("live design mode", () => {
  beforeEach(() => {
    localStorage.clear(); setUiPref.mockClear();
    authState.user = { id: "admin-1" }; authState.isGuest = false;
    class ResizeObserverMock { observe() {} disconnect() {} }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("does not persist a saved theme into the study store while signed out", async () => {
    authState.user = null;
    localStorage.setItem("app-theme", "royal-navy");
    localStorage.setItem("app-theme-updated-at", String(Date.now()));
    render(<ThemeProvider><ThemeStudioProvider><Harness /></ThemeStudioProvider></ThemeProvider>);
    await waitFor(() => expect(screen.getByText("התחל עיצוב")).toBeInTheDocument());
    expect(setUiPref).not.toHaveBeenCalled();
  });

  it("captures a real element, saves a scoped rule, and supports undo", async () => {
    render(<ThemeProvider><ThemeStudioProvider><Harness /></ThemeStudioProvider></ThemeProvider>);
    fireEvent.click(screen.getByText("התחל עיצוב"));
    fireEvent.pointerDown(screen.getByTestId("real-target"));
    expect(await screen.findByText("עריכה חיה")).toBeInTheDocument();
    fireEvent.click(screen.getByText("כל רכיב דומה"));
    fireEvent.click(screen.getByText("שמור עיצוב"));
    await waitFor(() => expect(document.getElementById("design-mode-overrides")?.textContent).toContain("button.sample-component"));
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

  it.each([false, true])("persists theme isolation across switching and remount (all=%s)", async (all) => {
    const app = () => <ThemeProvider><ThemeStudioProvider><Harness /><ThemeControls /></ThemeStudioProvider></ThemeProvider>;
    const first = render(app());
    fireEvent.click(screen.getByText("מקור"));
    fireEvent.click(screen.getByText("התחל עיצוב"));
    fireEvent.pointerDown(screen.getByTestId("real-target"));
    fireEvent.click(screen.getByText("כל רכיב דומה"));
    if (all) fireEvent.click(screen.getByText("כל ערכות הנושא"));
    fireEvent.click(screen.getByText("שמור עיצוב"));
    const css = () => document.getElementById("design-mode-overrides")?.textContent || "";
    await waitFor(() => expect(css()).toContain("button.sample-component"));
    const stored = JSON.parse(localStorage.getItem("app-theme-design-v1") || "{}");
    expect(stored.rules[0].themeId).toBe(all ? undefined : "royal-navy");
    fireEvent.click(screen.getByText("חלופה"));
    await waitFor(() => expect(css().includes("button.sample-component")).toBe(all));
    first.unmount();
    render(app());
    await waitFor(() => expect(css().includes("button.sample-component")).toBe(all));
    fireEvent.click(screen.getByText("מקור"));
    await waitFor(() => expect(css()).toContain("button.sample-component"));
  });

  it("never turns a generic layout utility into a site-wide component selector", async () => {
    render(<ThemeProvider><ThemeStudioProvider><Harness /></ThemeStudioProvider></ThemeProvider>);
    fireEvent.click(screen.getByText("התחל עיצוב"));
    fireEvent.pointerDown(screen.getByTestId("utility-target"));
    expect(await screen.findByText("עריכה חיה")).toBeInTheDocument();
    fireEvent.click(screen.getByText("כל רכיב דומה"));
    fireEvent.click(screen.getByText("שמור עיצוב"));

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("app-theme-design-v1") || "{}");
      expect(saved.rules).toHaveLength(1);
      expect(saved.rules[0].selector).not.toContain(".relative");
      expect(saved.rules[0].selector).toMatch(/^body >/);
    });
  });

  it("quarantines legacy component rules that target generic layout utilities", async () => {
    localStorage.setItem("app-theme-design-v1", JSON.stringify({
      schemaVersion: 1,
      rules: [
        { id: "component:.relative", selector: ".relative", scope: "component", label: "שגוי", styles: { "background-color": "#08072c", "border-radius": "9999px" } },
        { id: "component:.sample-component", selector: ".sample-component", scope: "component", label: "תקין", styles: { color: "#123456" } },
      ],
      geometry: { x: 24, y: 84, width: 560, height: 720 },
      updatedAt: 1,
    }));

    render(<ThemeProvider><ThemeStudioProvider><Harness /></ThemeStudioProvider></ThemeProvider>);

    await waitFor(() => {
      const css = document.getElementById("design-mode-overrides")?.textContent || "";
      expect(css).not.toContain(".relative");
      expect(css).toContain(".sample-component");
    });
    const saved = JSON.parse(localStorage.getItem("app-theme-design-v1") || "{}");
    expect(saved.rules).toHaveLength(1);
    expect(saved.rules[0].selector).toBe(".sample-component");
    const quarantine = JSON.parse(localStorage.getItem("app-theme-design-quarantine-v1") || "{}");
    expect(quarantine.rules).toEqual([expect.objectContaining({ selector: ".relative" })]);
  });
});
