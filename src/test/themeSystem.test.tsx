import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

const permission = { isAdmin: false, viewerIsAdmin: false };
const studio = { start: vi.fn(), publishDefault: vi.fn(), publishing: false, enabled: false, paused: false, rules: [] };
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => permission }));
vi.mock("@/theme/ThemeStudioProvider", () => ({ useThemeStudio: () => studio }));
vi.mock("@/lib/study/colorFavorites", () => ({ useColorFavorites: () => ({ favorites: [], addFavorite: vi.fn(), removeFavorite: vi.fn(), moveFavorite: vi.fn() }) }));

describe("canonical theme switcher", () => {
  beforeEach(() => { localStorage.clear(); permission.isAdmin = false; permission.viewerIsAdmin = false; });

  it("keeps authoring controls hidden for regular users", () => {
    render(<ThemeProvider><ThemeSwitcher /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "בחר ערכת נושא" }));
    expect(screen.queryByText("עריכה חיה")).not.toBeInTheDocument();
    expect(screen.queryByText(/פרסם כברירת מחדל/)).not.toBeInTheDocument();
    expect(screen.queryAllByTitle("ערוך ערכה")).toHaveLength(0);
  });

  it("shows creation, live editing and publication only to a verified admin", () => {
    permission.isAdmin = true; permission.viewerIsAdmin = true;
    render(<ThemeProvider><ThemeSwitcher /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "בחר ערכת נושא" }));
    expect(screen.getByText("ערכה חדשה")).toBeInTheDocument();
    expect(screen.getByText("עריכה חיה")).toBeInTheDocument();
    expect(screen.getByText(/פרסם כברירת מחדל/)).toBeInTheDocument();
    expect(screen.getAllByTitle("ערוך ערכה").length).toBeGreaterThan(0);
  });
});
