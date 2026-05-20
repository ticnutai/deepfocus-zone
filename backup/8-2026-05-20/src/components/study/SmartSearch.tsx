import { useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { Search, BookOpen, Folder, Hash, Layers, X, Clock, Filter } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useStudy } from "@/lib/study/store";
import { isDue } from "@/lib/study/srs";
import { cn } from "@/lib/utils";

const RECENTS_KEY = "smart-search-recents-v1";
const MAX_RECENTS = 8;

type Kind = "card" | "category" | "deck" | "tag";

type Hit = {
  id: string;
  kind: Kind;
  title: string;
  subtitle?: string;
  badge?: string;
  cardType?: "flashcard" | "multiple" | "boolean" | "combo";
  due?: boolean;
};

interface Props {
  variant?: "page" | "modal";
  onPick?: (hit: Hit) => void;
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) =>
    re.test(part) ? <mark key={i} className="bg-gold/40 text-foreground rounded px-0.5">{part}</mark> : <span key={i}>{part}</span>
  );
}

const KIND_META: Record<Kind, { label: string; icon: typeof BookOpen; color: string }> = {
  card: { label: "שאלה", icon: BookOpen, color: "text-navy" },
  category: { label: "קטגוריה", icon: Folder, color: "text-amber-700" },
  deck: { label: "מערכת", icon: Layers, color: "text-gold" },
  tag: { label: "תגית", icon: Hash, color: "text-muted-foreground" },
};

export function SmartSearch({ variant = "page", onPick }: Props) {
  const { state } = useStudy();
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]"); } catch { return []; }
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Filters
  const [kindFilter, setKindFilter] = useState<Set<Kind>>(new Set(["card", "category", "deck", "tag"]));
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set(["flashcard", "multiple", "boolean", "combo"]));
  const [statusFilter, setStatusFilter] = useState<"all" | "due" | "new" | "failed">("all");

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Build searchable items
  const items = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    // Cards
    state.cards.forEach((c) => {
      const deck = state.decks.find((d) => d.id === c.deckId);
      let answerText = "";
      if (c.type === "flashcard" || c.type === "combo") answerText = c.answer ?? "";
      else if (c.type === "multiple") answerText = c.options?.join(" | ") ?? "";
      else if (c.type === "boolean") answerText = c.correct ? "נכון" : "לא נכון";
      out.push({
        id: `card:${c.id}`,
        kind: "card",
        title: c.question,
        subtitle: [deck?.name, answerText, (c as { explanation?: string }).explanation, c.tags?.join(" ")].filter(Boolean).join(" · "),
        badge: deck?.name,
        cardType: c.type,
        due: isDue(c),
      });
    });
    // Categories
    (state.categories ?? []).forEach((cat) => {
      const cardCount = state.cards.filter((c) => c.tags?.includes(cat.name)).length;
      out.push({ id: `cat:${cat.id}`, kind: "category", title: cat.name, subtitle: `${cardCount} שאלות` });
    });
    // Decks
    state.decks.forEach((d) => {
      const cards = state.cards.filter((c) => c.deckId === d.id);
      const due = cards.filter(isDue).length;
      out.push({ id: `deck:${d.id}`, kind: "deck", title: d.name, subtitle: `${cards.length} כרטיסים · ${due} לחזרה` });
    });
    // Tags (unique)
    const tags = new Set<string>();
    state.cards.forEach((c) => c.tags?.forEach((t) => tags.add(t)));
    Array.from(tags).forEach((t) => {
      const count = state.cards.filter((c) => c.tags?.includes(t)).length;
      out.push({ id: `tag:${t}`, kind: "tag", title: t, subtitle: `${count} שאלות` });
    });
    return out;
  }, [state.cards, state.categories, state.decks]);

  const fuse = useMemo(() => new Fuse(items, {
    keys: ["title", "subtitle", "badge"],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 1,
    includeScore: true,
  }), [items]);

  const results = useMemo(() => {
    let base: Hit[];
    if (!query.trim()) {
      base = items.slice(0, 80);
    } else {
      base = fuse.search(query).map((r) => r.item);
    }
    base = base.filter((h) => kindFilter.has(h.kind));
    if (statusFilter === "due") base = base.filter((h) => h.kind !== "card" || h.due);
    if (statusFilter === "new") base = base.filter((h) => {
      if (h.kind !== "card") return true;
      const c = state.cards.find((x) => `card:${x.id}` === h.id);
      return c?.stats.totalReviews === 0;
    });
    if (statusFilter === "failed") base = base.filter((h) => {
      if (h.kind !== "card") return true;
      const c = state.cards.find((x) => `card:${x.id}` === h.id);
      return (c?.stats.incorrect ?? 0) > (c?.stats.correct ?? 0);
    });
    base = base.filter((h) => h.kind !== "card" || (h.cardType && typeFilter.has(h.cardType)));
    return base.slice(0, 200);
  }, [query, fuse, kindFilter, typeFilter, statusFilter, items, state.cards]);

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { card: 0, category: 0, deck: 0, tag: 0 };
    results.forEach((r) => { c[r.kind]++; });
    return c;
  }, [results]);

  const commitSearch = () => {
    if (!query.trim()) return;
    const next = [query.trim(), ...recents.filter((r) => r !== query.trim())].slice(0, MAX_RECENTS);
    setRecents(next);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* noop */ }
  };

  const toggle = <T,>(set: Set<T>, value: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  return (
    <Card className={cn("gold-frame p-4 space-y-3", variant === "modal" && "shadow-2xl")} dir="rtl">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={commitSearch}
            placeholder="חפש שאלות, תשובות, קטגוריות, מערכות, תגיות..."
            className="h-10 pr-9 text-right border-2 border-gold/40"
            dir="rtl"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-10 border-gold/50 gap-1">
              <Filter className="h-4 w-4 text-gold" /> סוגים
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>סוג תוצאה</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(Object.keys(KIND_META) as Kind[]).map((k) => (
              <DropdownMenuCheckboxItem
                key={k}
                checked={kindFilter.has(k)}
                onCheckedChange={() => toggle(kindFilter, k, setKindFilter)}
              >
                {KIND_META[k].label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>סוג כרטיס</DropdownMenuLabel>
            {[
              { id: "flashcard", l: "פתוחה" },
              { id: "multiple", l: "אמריקאית" },
              { id: "boolean", l: "נכון/לא נכון" },
              { id: "combo", l: "משולבת" },
            ].map((t) => (
              <DropdownMenuCheckboxItem
                key={t.id}
                checked={typeFilter.has(t.id)}
                onCheckedChange={() => toggle(typeFilter, t.id, setTypeFilter)}
              >
                {t.l}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>סטטוס</DropdownMenuLabel>
            {(["all", "due", "new", "failed"] as const).map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={statusFilter === s}
                onCheckedChange={() => setStatusFilter(s)}
              >
                {s === "all" ? "הכל" : s === "due" ? "לחזרה היום" : s === "new" ? "חדש (לא נלמד)" : "נכשלו יותר מנכון"}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Counts */}
      <div className="flex flex-wrap gap-1 text-xs">
        {(Object.keys(KIND_META) as Kind[]).map((k) => {
          const M = KIND_META[k];
          return (
            <Badge
              key={k}
              variant={kindFilter.has(k) ? "default" : "outline"}
              className={cn("cursor-pointer gap-1", kindFilter.has(k) ? "bg-gradient-navy text-primary-foreground" : "")}
              onClick={() => toggle(kindFilter, k, setKindFilter)}
            >
              <M.icon className="h-3 w-3" /> {M.label}: {counts[k]}
            </Badge>
          );
        })}
      </div>

      {/* Recents */}
      {!query && recents.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" /> חיפושים אחרונים
          </div>
          <div className="flex flex-wrap gap-1">
            {recents.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setQuery(r)}
                className="text-xs px-2 py-1 rounded-lg border border-gold/30 hover:bg-secondary"
              >
                {r}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setRecents([]); try { localStorage.removeItem(RECENTS_KEY); } catch { /* noop */ } }}
              className="text-xs px-2 py-1 text-destructive hover:underline"
            >
              נקה
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      <ScrollArea className={cn(variant === "modal" ? "h-[60vh]" : "h-[60vh]")}>
        <div className="space-y-1.5">
          {results.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">אין תוצאות</p>
          )}
          {results.map((hit) => {
            const M = KIND_META[hit.kind];
            return (
              <button
                key={hit.id}
                type="button"
                onClick={() => onPick?.(hit)}
                className="w-full text-right rounded-lg border border-gold/30 bg-card hover:bg-secondary transition-colors p-3 flex items-start gap-3"
              >
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary", M.color)}>
                  <M.icon className="h-4 w-4" />
                </span>
                <div className="flex-1 min-w-0 text-right">
                  <div className="font-medium text-sm leading-snug break-words">
                    {highlight(hit.title.replace(/\{\{c\d+::([^}]+)\}\}/g, "$1"), query)}
                  </div>
                  {hit.subtitle && (
                    <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5 break-words">
                      {highlight(hit.subtitle, query)}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant="outline" className="text-[10px] border-gold/30">{M.label}</Badge>
                  {hit.due && hit.kind === "card" && (
                    <Badge className="text-[10px] bg-destructive/15 text-destructive border-destructive/30 border">לחזרה</Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}
