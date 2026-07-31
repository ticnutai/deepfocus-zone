// Hebrew tractate name → Sefaria API English name
export const SEFARIA_NAME: Record<string, string> = {
  "ברכות": "Berakhot",
  "שבת": "Shabbat",
  "עירובין": "Eruvin",
  "פסחים": "Pesachim",
  "שקלים": "Shekalim",
  "יומא": "Yoma",
  "סוכה": "Sukkah",
  "ביצה": "Beitzah",
  "ראש השנה": "Rosh Hashanah",
  "תענית": "Taanit",
  "מגילה": "Megillah",
  "מועד קטן": "Moed Katan",
  "חגיגה": "Chagigah",
  "יבמות": "Yevamot",
  "כתובות": "Ketubot",
  "נדרים": "Nedarim",
  "נזיר": "Nazir",
  "סוטה": "Sotah",
  "גיטין": "Gittin",
  "קידושין": "Kiddushin",
  "בבא קמא": "Bava Kamma",
  "בבא מציעא": "Bava Metzia",
  "בבא בתרא": "Bava Batra",
  "סנהדרין": "Sanhedrin",
  "מכות": "Makkot",
  "שבועות": "Shevuot",
  "עבודה זרה": "Avodah Zarah",
  "הוריות": "Horayot",
  "זבחים": "Zevachim",
  "מנחות": "Menachot",
  "חולין": "Chullin",
  "בכורות": "Bekhorot",
  "ערכין": "Arakhin",
  "תמורה": "Temurah",
  "כריתות": "Keritot",
  "מעילה": "Meilah",
  "תמיד": "Tamid",
  "נדה": "Niddah",
};

export type TextMode = "aramaic" | "english" | "both";

export interface SefariaText {
  ref: string;
  heRef: string;
  aramaic: string;
  english: string;
}

function joinSegments(arr: unknown): string {
  if (!arr) return "";
  if (Array.isArray(arr)) {
    return arr
      .map((s) => (typeof s === "string" ? s : joinSegments(s)))
      .filter(Boolean)
      .join(" ");
  }
  return typeof arr === "string" ? arr : "";
}

export async function fetchSefariaText(
  masechetHebrew: string,
  daf: number,
  amud: "a" | "b",
): Promise<SefariaText> {
  const sefariaName = SEFARIA_NAME[masechetHebrew];
  if (!sefariaName) throw new Error(`לא נמצא שם Sefaria למסכת: ${masechetHebrew}`);
  const ref = `${sefariaName}.${daf}${amud}`;

  // 1) מאגר מקומי (offline-first) — עברית מקומית; תרגום אנגלי מושלם אונליין אם זמין
  const { fetchLocalAmud, stripTags } = await import("@/lib/study/localShas");
  const local = await fetchLocalAmud(sefariaName.replace(/\s+/g, "_"), daf, amud);
  if (local && local.gemara.length > 0) {
    let english = "";
    if (typeof navigator === "undefined" || navigator.onLine) {
      try {
        const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?pad=0&commentary=0`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json() as Record<string, unknown>;
          english = joinSegments(data.text);
        }
      } catch {
        /* אין תרגום — נשאר עם עברית מקומית */
      }
    }
    return {
      ref,
      heRef: `${masechetHebrew} ${local.daf} ${local.amud === "א" ? "ע\"א" : "ע\"ב"}`,
      aramaic: local.gemara.map(stripTags).filter(Boolean).join(" "),
      english,
    };
  }

  // 2) גיבוי: Sefaria אונליין
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("הטקסט אינו שמור במכשיר ושירות ספריא דורש חיבור לאינטרנט.");
  }
  const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?pad=0&commentary=0`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`שגיאת Sefaria API: ${res.status} ${res.statusText}`);
  const data = await res.json() as Record<string, unknown>;
  if (data.error) throw new Error(`Sefaria: ${data.error}`);

  return {
    ref: (data.ref as string) ?? ref,
    heRef: (data.heRef as string) ?? ref,
    aramaic: joinSegments(data.he),
    english: joinSegments(data.text),
  };
}

/** Convert number to Hebrew gematria string (for daf category names) */
export function toHebrewNumeral(n: number): string {
  const vals = [400, 300, 200, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const letters = ["ת", "ש", "ר", "ק", "צ", "פ", "ע", "ס", "נ", "מ", "ל", "כ", "י", "ט", "ח", "ז", "ו", "ה", "ד", "ג", "ב", "א"];
  // Special cases to avoid writing parts of divine names
  if (n % 100 === 15) return toHebrewNumeral(n - 15) + "טו";
  if (n % 100 === 16) return toHebrewNumeral(n - 16) + "טז";
  let result = "";
  let remaining = n;
  for (let i = 0; i < vals.length; i++) {
    while (remaining >= vals[i]) {
      result += letters[i];
      remaining -= vals[i];
    }
  }
  return result;
}
