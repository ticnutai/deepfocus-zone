import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fetchSefariaDaf, sefariaUrl, isSefariaSupported, masechtaSlug } from "@/lib/study/sefaria";
import { toGematria } from "@/lib/study/shasGen";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Source = "pdf" | "text";

interface Props {
  masechta: string;
  daf: number;
  amud: 1 | 2;
  className?: string;
  isActive?: boolean;
}

export function GemaraViewer({ masechta, daf, amud, className, isActive = true }: Props) {
  const [source, setSource] = useState<Source>("pdf");
  const [pdfExists, setPdfExists] = useState<boolean | null>(null);
  const [text, setText] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pdfPath = `${masechtaSlug(masechta)}/${daf}_${amud}.pdf`;
  const pdfUrl = useMemo(
    () => supabase.storage.from("gemara-pages").getPublicUrl(pdfPath).data.publicUrl,
    [pdfPath],
  );

  // בדוק קיום PDF
  useEffect(() => {
    if (!isActive) return;
    let cancel = false;
    setPdfExists(null);
    fetch(pdfUrl, { method: "HEAD" })
      .then((r) => { if (!cancel) setPdfExists(r.ok); })
      .catch(() => { if (!cancel) setPdfExists(false); });
    return () => { cancel = true; };
  }, [pdfUrl, isActive]);

  // אם PDF לא קיים — עבור אוטומטית לטקסט
  useEffect(() => {
    if (pdfExists === false && source === "pdf") setSource("text");
  }, [pdfExists, source]);

  // טען טקסט מ-Sefaria
  useEffect(() => {
    if (!isActive) return;
    if (source !== "text") return;
    if (!isSefariaSupported(masechta)) {
      setError("המסכת לא נתמכת ב-Sefaria");
      return;
    }
    let cancel = false;
    setLoading(true);
    setError(null);
    fetchSefariaDaf(masechta, daf, amud)
      .then((t) => { if (!cancel) setText(t); })
      .catch((e: Error) => { if (!cancel) setError(e.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [source, masechta, daf, amud, isActive]);

  const amudLabel = amud === 1 ? 'ע"א' : 'ע"ב';
  const dafLabel = `${toGematria(daf)}'`;

  return (
    <div className={cn("flex flex-col h-full bg-card border-2 border-gold/30 rounded-xl overflow-hidden", className)} dir="rtl">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gold/30 bg-gold/5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BookOpen className="h-4 w-4 text-gold" />
          {masechta} · דף {dafLabel} · {amudLabel}
        </div>
        <div className="flex items-center gap-1">
          <ToggleGroup type="single" value={source} onValueChange={(v) => v && setSource(v as Source)} size="sm">
            <ToggleGroupItem value="pdf" disabled={pdfExists === false} className="h-7 px-2 text-xs">
              PDF{pdfExists === false ? " (אין)" : ""}
            </ToggleGroupItem>
            <ToggleGroupItem value="text" className="h-7 px-2 text-xs">
              <FileText className="h-3 w-3" /> טקסט
            </ToggleGroupItem>
          </ToggleGroup>
          <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="פתח ב-Sefaria">
            <a href={sefariaUrl(masechta, daf, amud)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {!isActive ? null : (
          <>
        {source === "pdf" && pdfExists !== false && (
          <iframe
            src={pdfUrl}
            className="w-full h-full border-0"
            title={`גמרא ${masechta} ${dafLabel}${amudLabel}`}
          />
        )}
        {source === "text" && (
          <div className="h-full overflow-y-auto p-4">
            {loading && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> טוען מ-Sefaria…
              </div>
            )}
            {error && <div className="text-sm text-destructive py-4 text-center">{error}</div>}
            {!loading && !error && text && (
              <div className="space-y-3 text-foreground leading-loose" style={{ fontFamily: '"Frank Ruhl Libre", "Times New Roman", serif', fontSize: 18 }}>
                {text.length === 0 && <div className="text-sm text-muted-foreground">אין טקסט זמין</div>}
                {text.map((p, i) => (
                  <p key={i} className="text-justify">{p}</p>
                ))}
              </div>
            )}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}