import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type ThemeName = "royal-navy" | "midnight-gold" | "emerald-ivory" | "burgundy-rose";

export const THEMES: { id: ThemeName; label: string; description: string; swatch: string[] }[] = [
  {
    id: "royal-navy",
    label: "Royal Navy",
    description: "לבן · זהב · נייבי",
    swatch: ["hsl(40 33% 98%)", "hsl(42 70% 50%)", "hsl(220 65% 14%)"],
  },
  {
    id: "midnight-gold",
    label: "Midnight Gold",
    description: "נייבי כהה · זהב",
    swatch: ["hsl(220 50% 8%)", "hsl(42 75% 58%)", "hsl(40 40% 95%)"],
  },
  {
    id: "emerald-ivory",
    label: "Emerald Ivory",
    description: "שנהב · ירוק · זהב",
    swatch: ["hsl(45 40% 97%)", "hsl(160 55% 18%)", "hsl(42 70% 50%)"],
  },
  {
    id: "burgundy-rose",
    label: "Burgundy Rose",
    description: "קרם · בורדו · רוז גולד",
    swatch: ["hsl(30 30% 97%)", "hsl(350 55% 25%)", "hsl(25 60% 55%)"],
  },
];

type Ctx = { theme: ThemeName; setTheme: (t: ThemeName) => void };
const ThemeContext = createContext<Ctx>({ theme: "royal-navy", setTheme: () => {} });

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    if (typeof window === "undefined") return "royal-navy";
    return (localStorage.getItem("app-theme") as ThemeName) || "royal-navy";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("app-theme", theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
