import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SefariaIframeViewerProps {
  url: string;
  title: string;
  className?: string;
}

/** מציג טקסט מ-Sefaria בתוך iframe — עם כפתור פתיחה בלשונית חדשה. */
export function SefariaIframeViewer({ url, title, className }: SefariaIframeViewerProps) {
  // Sefaria תומך ב-embed נקי דרך פרמטר `with=all` או דרך הקישור הרגיל.
  const embedUrl = url.includes("?") ? `${url}&with=all` : `${url}?with=all`;

  return (
    <Card className={cn("gold-frame p-0 flex flex-col overflow-hidden", className)} dir="rtl">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gold/30 bg-card shrink-0">
        <span className="text-sm font-semibold text-foreground truncate">{title}</span>
        <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="פתח ב-Sefaria">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 text-gold" />
          </a>
        </Button>
      </div>
      <iframe
        src={embedUrl}
        title={title}
        className="flex-1 w-full bg-background"
        style={{ minHeight: 400 }}
      />
    </Card>
  );
}
