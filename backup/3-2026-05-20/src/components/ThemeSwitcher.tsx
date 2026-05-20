import { Palette, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { THEMES, useTheme } from "@/theme/ThemeProvider";
import { cn } from "@/lib/utils";

export const ThemeSwitcher = () => {
  const { theme, setTheme } = useTheme();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="rounded-full border-2 border-gold bg-card text-navy hover:bg-secondary shadow-elegant"
          aria-label="בחר ערכת נושא"
        >
          <Palette className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 border-2 border-gold rounded-2xl shadow-elegant">
        <div className="space-y-1">
          <p className="font-display text-base font-semibold text-foreground">ערכות נושא</p>
          <p className="text-xs text-muted-foreground mb-3">בחר את הסגנון המועדף עליך</p>
          <div className="space-y-2">
            {THEMES.map((t) => {
              const active = t.id === theme;
              return (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={cn(
                    "w-full flex items-center gap-3 p-2.5 rounded-xl border-2 transition-all text-right",
                    active
                      ? "border-gold bg-secondary shadow-gold"
                      : "border-transparent hover:border-gold/40 hover:bg-secondary/60",
                  )}
                >
                  <div className="flex -space-x-1 rtl:space-x-reverse">
                    {t.swatch.map((c, i) => (
                      <span
                        key={i}
                        className="h-6 w-6 rounded-full border-2 border-card"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-foreground">{t.label}</div>
                    <div className="text-xs text-muted-foreground">{t.description}</div>
                  </div>
                  {active && <Check className="h-4 w-4 text-gold" />}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
