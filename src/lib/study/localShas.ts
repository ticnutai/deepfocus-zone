// שכבת ש"ס מקומי — ברירת המחדל של האפליקציה.
// הנתונים: public/shas/{Slug}/{daf}{a|b}.json (נוצר ע"י scripts/import-local-shas.mjs)
// כל עמוד: { gemara: string[], commentaries: [{key,he,en,segments[]}], ... }
//
// סדר נסיונות טעינה:
//   1. fetch יחסי (BASE_URL) — עובד ב-dev, באתר (web), וב-PWA.
//   2. פרוטוקול shas://local/ — עובד באלקטרון (file://), מוגש מה-main process.
//   3. null — הקורא יחליט אם ליפול ל-Sefaria אונליין.

export interface LocalCommentary {
  key: string; // rashi | tosafot | rashbam | ran | ri_migash | rabbeinu_gershom | ramban | rashba | ritva | yad_ramah
  he: string;
  en: string;
  segments: string[];
}

export interface LocalAmud {
  id: string;
  seder: string;
  seder_full: string;
  masechet: string;
  masechet_en: string;
  daf: string;
  daf_number: number;
  amud: string; // א | ב
  amud_en: "a" | "b";
  sefaria_ref: string;
  gemara: string[];
  commentaries: LocalCommentary[];
  available_commentaries: string[];
  segment_counts: Record<string, number>;
  source: string;
}

export interface LocalShasIndex {
  schema_version: number;
  totals: { amudim: number };
  masechtot: Array<{
    key: number;
    he: string;
    en: string;
    slug: string;
    seder_he: string;
    daf_count: number;
    amud_count: number;
    commentaries: Array<{ key: string; he: string; en: string }>;
    dafim: Array<{ n: number; he: string; amudim: string[] }>;
  }>;
}

const isElectron =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

const amudCache = new Map<string, LocalAmud | null>();
let indexCache: LocalShasIndex | null | undefined;

async function tryFetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** נתיב יחסי לקובץ בתוך shas/ לפי סביבת הריצה. */
function candidates(rel: string): string[] {
  const base = (import.meta.env.BASE_URL ?? "/") as string;
  const normalBase = base.endsWith("/") ? base : base + "/";
  const list: string[] = [];
  if (isElectron) list.push(`shas://local/${rel}`);
  list.push(`${normalBase}shas/${rel}`);
  return list;
}

/**
 * טוען עמוד מהמאגר המקומי. מחזיר null אם לא קיים מקומית.
 * slug: כפי שמחזיר masechtaSlug() — למשל "Bava_Kamma".
 */
export async function fetchLocalAmud(
  slug: string,
  daf: number,
  amud: "a" | "b",
): Promise<LocalAmud | null> {
  const rel = `${slug}/${daf}${amud}.json`;
  if (amudCache.has(rel)) return amudCache.get(rel)!;
  let result: LocalAmud | null = null;
  for (const url of candidates(rel)) {
    result = await tryFetchJson<LocalAmud>(url);
    if (result) break;
  }
  amudCache.set(rel, result);
  return result;
}

/** אינדקס הניווט המקומי (או null אם המאגר לא מותקן). */
export async function fetchLocalShasIndex(): Promise<LocalShasIndex | null> {
  if (indexCache !== undefined) return indexCache;
  let result: LocalShasIndex | null = null;
  for (const url of candidates("index.json")) {
    result = await tryFetchJson<LocalShasIndex>(url);
    if (result) break;
  }
  indexCache = result;
  return result;
}

/** ניקוי תגיות HTML מקטע טקסט. */
export function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

/** האם ref של ספריא הוא עמוד גמרא בבלי, למשל "Berakhot.2a" או "Bava Kamma 15b". */
export function parseBavliRef(
  ref: string,
): { slug: string; daf: number; amud: "a" | "b" } | null {
  const m = ref.trim().match(/^([A-Za-z_ ']+?)[ .](\d{1,3})([ab])$/);
  if (!m) return null;
  return { slug: m[1].trim().replace(/\s+/g, "_"), daf: Number(m[2]), amud: m[3] as "a" | "b" };
}
