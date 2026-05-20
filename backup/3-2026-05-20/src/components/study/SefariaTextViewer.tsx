import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SefariaTextViewerProps {
  /** Sefaria ref, למשל: "Mishnah_Berakhot.1.1" או "Genesis.1" */
  sefariaRef: string;
  /** קישור גלוי למשתמש (לפתיחה בלשונית חדשה) */
  externalUrl: string;
  title: string;
  className?: string;
}

const API = "https://www.sefaria.org/api/v3/texts";
const cache = new Map<string, string[]>();

async function fetchSefariaText(ref: string): Promise<string[]> {
  if (cache.has(ref)) return cache.get(ref)!;
  const url = `${API}/${encodeURIComponent(ref)}?version=hebrew&return_format=text_only`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sefaria fetch failed: ${res.status}`);
  const data = await res.json();
  const versions = (data?.versions ?? []) as Array<{ text: unknown }>;
  const raw: unknown = versions[0]?.text ?? data?.text ?? [];
  const flat: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") flat.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
  };
  walk(raw);
  const cleaned = flat.map((s) => s.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
  cache.set(ref, cleaned);
  return cleaned;
}

/** מציג טקסט מ-Sefaria דרך ה-API שלהם — עם כפתור פתיחה בדף המלא. */
export function SefariaTextViewer({ sefariaRef, externalUrl, title, className }: SefariaTextViewerProps) {
  const [text, setText] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setText(null);
    fetchSefariaText(sefariaRef)
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setError(e?.message || "שגיאה בטעינה"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sefariaRef]);

  return (
    <Card className={cn("gold-frame p-0 flex flex-col overflow-hidden", className)} dir="rtl">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gold/30 bg-card shrink-0">
        <span className="text-sm font-semibold text-foreground truncate">{title}</span>
        <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="פתח ב-Sefaria">
          <a href={externalUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 text-gold" />
          </a>
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 leading-loose text-lg">
        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> טוען מ-Sefaria…
          </div>
        )}
        {error && (
          <div className="text-center py-12 text-destructive text-sm">
            {error}
            <div className="mt-2">
              <Button asChild variant="outline" size="sm">
                <a href={externalUrl} target="_blank" rel="noopener noreferrer">פתח ב-Sefaria</a>
              </Button>
            </div>
          </div>
        )}
        {text && !loading && (
          <div className="space-y-3 text-foreground" style={{ fontFamily: "var(--font-hebrew, inherit)" }}>
            {text.length === 0 ? (
              <p className="text-center text-muted-foreground">אין טקסט זמין</p>
            ) : (
              text.map((p, i) => (
                <p key={i} className="text-justify">{p}</p>
              ))
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
