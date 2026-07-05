/**
 * ShasExportDialog — דיאלוג יצוא לוח לימוד ש"ס.
 * לא חוסם UI, ניתן לגרירה, ומאפשר לבחור היקף / תוכן / פורמט.
 */
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, FileSpreadsheet, FileJson, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { exportShas, EXPORT_SEDARIM, EXPORT_MASECHTOT, type ExportScope, type ExportContent, type ShasBoardProgress } from "@/lib/study/shasExport";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  progress: ShasBoardProgress;
}

type ScopeKind = "all" | "seder" | "masechta" | "learned" | "unlearned";
type Format = "pdf" | "docx" | "xlsx" | "csv" | "json";

const FORMATS: { id: Format; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "pdf", label: "PDF", desc: "לצפייה והדפסה, RTL מעוצב", icon: Printer },
  { id: "docx", label: "Word", desc: "לעריכה במסמך", icon: FileText },
  { id: "xlsx", label: "Excel", desc: "טבלה עם עמודות", icon: FileSpreadsheet },
  { id: "csv", label: "CSV", desc: "ליבוא לגליון אחר", icon: FileSpreadsheet },
  { id: "json", label: "JSON", desc: "גיבוי / אינטגרציה", icon: FileJson },
];

export function ShasExportDialog({ open, onOpenChange, progress }: Props) {
  const [scopeKind, setScopeKind] = useState<ScopeKind>("all");
  const [seder, setSeder] = useState<string>(EXPORT_SEDARIM[0]);
  const [masechta, setMasechta] = useState<string>(EXPORT_MASECHTOT[0].name);
  const [format, setFormat] = useState<Format>("pdf");
  const [content, setContent] = useState<ExportContent>({
    status: true, lastDate: false, summary: true, emptyRows: false,
  });
  const [busy, setBusy] = useState(false);

  const masechtotForSeder = useMemo(
    () => EXPORT_MASECHTOT.filter((m) => m.seder === seder),
    [seder],
  );

  const scope: ExportScope = useMemo(() => {
    switch (scopeKind) {
      case "seder": return { kind: "seder", seder };
      case "masechta": return { kind: "masechta", masechta };
      case "learned": return { kind: "learned" };
      case "unlearned": return { kind: "unlearned" };
      default: return { kind: "all" };
    }
  }, [scopeKind, seder, masechta]);

  const handleExport = async () => {
    setBusy(true);
    try {
      const { rowCount } = await exportShas({ scope, content, format, progress });
      toast.success(`יוצאו ${rowCount.toLocaleString("he-IL")} רשומות`);
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("שגיאה ביצוא: " + (e instanceof Error ? e.message : "שגיאה לא ידועה"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl gold-frame"
        showOverlay={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-gold" />
            הורדת לוח לימוד ש"ס
          </DialogTitle>
          <DialogDescription>בחר היקף, תוכן ופורמט. הדיאלוג לא חוסם את השימוש בלוח.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Scope */}
          <section className="space-y-2">
            <Label className="text-sm font-semibold">היקף ההורדה</Label>
            <RadioGroup value={scopeKind} onValueChange={(v) => setScopeKind(v as ScopeKind)} className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {([
                ["all", "כל הש\"ס"],
                ["seder", "לפי סדר"],
                ["masechta", "לפי מסכת"],
                ["learned", "רק נלמדו"],
                ["unlearned", "רק לא נלמדו"],
              ] as [ScopeKind, string][]).map(([id, label]) => (
                <label
                  key={id}
                  className={cn(
                    "flex items-center gap-2 border rounded-md p-2 cursor-pointer text-sm hover:bg-secondary/50",
                    scopeKind === id && "border-gold bg-gold/10",
                  )}
                >
                  <RadioGroupItem value={id} />
                  {label}
                </label>
              ))}
            </RadioGroup>
            {scopeKind === "seder" && (
              <Select value={seder} onValueChange={setSeder}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPORT_SEDARIM.map((s) => <SelectItem key={s} value={s}>סדר {s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {scopeKind === "masechta" && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={seder} onValueChange={(v) => { setSeder(v); const first = EXPORT_MASECHTOT.find((m) => m.seder === v); if (first) setMasechta(first.name); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPORT_SEDARIM.map((s) => <SelectItem key={s} value={s}>סדר {s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={masechta} onValueChange={setMasechta}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {masechtotForSeder.map((m) => <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </section>

          {/* Content */}
          <section className="space-y-2">
            <Label className="text-sm font-semibold">תוכן</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                ["summary", "סיכום סטטיסטי בראש"],
                ["status", "סטטוס לימוד + מספר חזרות"],
                ["lastDate", "תאריך לימוד אחרון"],
                ["emptyRows", "כלול עמודים ריקים (לסימון ידני)"],
              ] as [keyof ExportContent, string][]).map(([id, label]) => (
                <label key={id} className="flex items-center gap-2 border rounded-md p-2 cursor-pointer text-sm hover:bg-secondary/50">
                  <Checkbox
                    checked={content[id]}
                    onCheckedChange={(v) => setContent((c) => ({ ...c, [id]: !!v }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </section>

          {/* Format */}
          <section className="space-y-2">
            <Label className="text-sm font-semibold">פורמט קובץ</Label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {FORMATS.map((f) => {
                const Icon = f.icon;
                const active = format === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFormat(f.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 border rounded-md p-2 text-xs hover:bg-secondary/50 transition-colors",
                      active && "border-gold bg-gold/10 ring-1 ring-gold",
                    )}
                    title={f.desc}
                  >
                    <Icon className={cn("h-5 w-5", active && "text-gold")} />
                    <span className="font-semibold">{f.label}</span>
                    <span className="text-[10px] text-muted-foreground text-center leading-tight">{f.desc}</span>
                  </button>
                );
              })}
            </div>
            {format === "pdf" && (
              <p className="text-[11px] text-muted-foreground">
                יפתח חלון הדפסה — בחר "שמור כ-PDF" ביעד ההדפסה.
              </p>
            )}
          </section>
        </div>

        <div className="flex justify-between items-center pt-2 border-t">
          <Badge variant="outline" className="border-gold/40">
            {scopeKind === "all" && "כל הש\"ס"}
            {scopeKind === "seder" && `סדר ${seder}`}
            {scopeKind === "masechta" && `מסכת ${masechta}`}
            {scopeKind === "learned" && "רק נלמדו"}
            {scopeKind === "unlearned" && "רק לא נלמדו"}
          </Badge>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>ביטול</Button>
            <Button onClick={handleExport} disabled={busy} className="gap-2 bg-gradient-navy text-primary-foreground">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              הורד
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
