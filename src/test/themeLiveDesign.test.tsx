import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { ThemeStudioProvider, useThemeStudio } from "@/theme/ThemeStudioProvider";

const setUiPref = vi.fn();
let cloudPrefs: Record<string, unknown> = {};
const authState: { user: { id: string } | null; isGuest: boolean } = { user: { id: "admin-1" }, isGuest: false };
const permissionState = { isAdmin: true, viewerIsAdmin: true };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => permissionState }));
vi.mock("@/lib/study/store", () => ({ useStudy: () => ({ state: { uiPrefs: cloudPrefs }, setUiPref }) }));
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
  it("toggles off a draft, restores page clicks and keeps saved rules", () => {
    const activated = vi.fn();
    render(<ThemeProvider><ThemeStudioProvider><Harness onActivate={activated} /></ThemeStudioProvider></ThemeProvider>);
    const toggle = screen.getByRole("switch", { name: "עריכה חיה" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.pointerDown(screen.getByTestId("real-target"));
    fireEvent.change(screen.getByLabelText("גודל טקסט", { exact: true }), { target: { value: "22px" } });
    fireEvent.click(screen.getByText("שמור עיצוב"));
    const saved = JSON.parse(localStorage.getItem("app-theme-design-v1")!).rules;
    fireEvent.pointerDown(screen.getByTestId("real-target"));
    fireEvent.change(screen.getByLabelText("גודל טקסט", { exact: true }), { target: { value: "30px" } });
    fireEvent.click(screen.getByTitle("השהה/המשך"));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByTestId("live-design-panel")).not.toBeInTheDocument();
    expect(document.getElementById("design-mode-live-preview")!.textContent).toBe("");
    expect(JSON.parse(localStorage.getItem("app-theme-design-v1")!).rules).toEqual(saved);
    fireEvent.click(screen.getByTestId("real-target"));
    expect(activated).toHaveBeenCalledTimes(1);
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "השהה" })).toBeInTheDocument();
    expect(screen.queryByTestId("live-design-panel")).not.toBeInTheDocument();
  });

  it.each([[false, false], [true, false]])("does not expose toggle without authoring permission (%s/%s)", (isAdmin, viewerIsAdmin) => {
    Object.assign(permissionState, { isAdmin, viewerIsAdmin });
    render(<ThemeProvider><ThemeStudioProvider><Harness /></ThemeStudioProvider></ThemeProvider>);
    expect(screen.queryByRole("switch", { name: "עריכה חיה" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("התחל עיצוב"));
    fireEvent.pointerDown(screen.getByTestId("real-target"));
    expect(screen.queryByTestId("live-design-panel")).not.toBeInTheDocument();
  });
  it("keeps preview while paused and offers unobscured selection markers", () => {
    render(<ThemeProvider><ThemeStudioProvider><Harness /></ThemeStudioProvider></ThemeProvider>);
    fireEvent.click(screen.getByText("התחל עיצוב"));
    fireEvent.pointerDown(screen.getByTestId("real-target"));
    expect(screen.getByTestId("design-highlight")).toHaveStyle({ background: "transparent" });
    fireEvent.change(screen.getByRole("textbox", { name: "צבע טקסט" }), { target: { value: "#123456" } });
    const preview = document.getElementById("design-mode-live-preview")!.textContent;
    fireEvent.click(screen.getByTitle("השהה/המשך"));
    expect(document.getElementById("design-mode-live-preview")!.textContent).toBe(preview);
    expect(screen.getByTestId("live-design-drag-handle")).toBeInTheDocument();
    expect(screen.queryByTestId("design-highlight")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("השהה/המשך"));
    fireEvent.change(screen.getByLabelText("סימון האלמנט"), { target: { value: "none" } });
    expect(screen.queryByTestId("design-highlight")).not.toBeInTheDocument();
  });
  it("hydrates gradient examples from downloaded preferences in a clean local context", async () => {
    cloudPrefs = { themeDesign: { schemaVersion: 1, rules: [], geometry: { x: 24, y: 84, width: 560, height: 720 }, updatedAt: 123, gradientPresets: [{ id: "cloud-example", name: "מהענן", value: "linear-gradient(125deg, #dcefe5, #ecd393)" }] } };
    render(<ThemeProvider><ThemeStudioProvider><Harness /></ThemeStudioProvider></ThemeProvider>);
    fireEvent.click(screen.getByText("התחל עיצוב"));
    fireEvent.pointerDown(screen.getByTestId("real-target"));
    expect(await screen.findByLabelText("החל דוגמה מהענן")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("app-theme-design-v1") || "{}").gradientPresets[0].id).toBe("cloud-example");
  });
  it("saves reusable gradients through the existing cloud preference adapter and retains them when saving rules", async () => {
    render(<ThemeProvider><ThemeStudioProvider><Harness /></ThemeStudioProvider></ThemeProvider>);
    fireEvent.click(screen.getByText("התחל עיצוב"));
    fireEvent.pointerDown(screen.getByTestId("real-target"));
    fireEvent.click(screen.getByText("מנטה ושמנת"));
    fireEvent.change(screen.getByLabelText("שם דוגמת גרדיאנט"), { target: { value: "הדוגמה שלי" } });
    fireEvent.click(screen.getByText("שמור כדוגמה"));
    const read = () => JSON.parse(localStorage.getItem("app-theme-design-v1") || "{}");
    expect(read().gradientPresets).toHaveLength(1);
    expect(read().rules).toHaveLength(0);
    expect(setUiPref).toHaveBeenCalledWith("themeDesign", expect.objectContaining({ gradientPresets: expect.arrayContaining([expect.objectContaining({ name: "הדוגמה שלי" })]) }));
    fireEvent.click(screen.getByText("שמור עיצוב"));
    expect(read().gradientPresets).toHaveLength(1);
    expect(read().rules).toHaveLength(1);
    fireEvent.pointerDown(screen.getByTestId("real-target"));
    fireEvent.click(screen.getByLabelText("מחק דוגמה הדוגמה שלי"));
    expect(read().gradientPresets).toHaveLength(0);
    expect(read().rules).toHaveLength(1);
  });
  beforeEach(() => {
    cloudPrefs = {};
    localStorage.clear(); setUiPref.mockClear();
    authState.user = { id: "admin-1" }; authState.isGuest = false;
    Object.assign(permissionState, { isAdmin: true, viewerIsAdmin: true });
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
    fireEvent.change(screen.getByRole("textbox", { name: "צבע טקסט" }), { target: { value: "#123456" } });
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
    fireEvent.change(screen.getByRole("textbox", { name: "צבע טקסט" }), { target: { value: "#123456" } });
    fireEvent.click(screen.getByText("שמור עיצוב"));
    const css = () => document.getElementById("design-mode-overrides")?.textContent || "";
    await waitFor(() => expect(css()).toContain("button.sample-component"));
    const stored = JSON.parse(localStorage.getItem("app-theme-design-v1") || "{}");
    expect(stored.rules[0].themeId).toBe(all ? undefined : "royal-navy");
    expect(stored.rules[0].styles).toEqual({ color: "#123456" });
    fireEvent.click(screen.getByText("חלופה"));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-design-theme", "mobile-focus"));
    if (!all) expect(css()).toContain('[data-design-theme="royal-navy"]');
    first.unmount();
    render(app());
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-design-theme", "mobile-focus"));
    fireEvent.click(screen.getByText("מקור"));
    await waitFor(() => expect(css()).toContain("button.sample-component"));
  });

  it("never turns a generic layout utility into a site-wide component selector", async () => {
    render(<ThemeProvider><ThemeStudioProvider><Harness /></ThemeStudioProvider></ThemeProvider>);
    fireEvent.click(screen.getByText("התחל עיצוב"));
    fireEvent.pointerDown(screen.getByTestId("utility-target"));
    expect(await screen.findByText("עריכה חיה")).toBeInTheDocument();
    fireEvent.click(screen.getByText("כל רכיב דומה"));
    fireEvent.change(screen.getByRole("textbox", { name: "צבע טקסט" }), { target: { value: "#123456" } });
    fireEvent.click(screen.getByText("שמור עיצוב"));

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("app-theme-design-v1") || "{}");
      expect(saved.rules).toHaveLength(1);
      expect(saved.rules[0].selector).not.toContain(".relative");
      expect(saved.rules[0].selector).toBe('[data-testid="utility-target"]');
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
