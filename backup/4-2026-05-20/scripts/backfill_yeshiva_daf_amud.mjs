import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://htsuoqvafayyffyxjhhh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "jj1212t@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "543211";

const SHAS_MASECHTOT = new Set([
  "ברכות", "שבת", "עירובין", "פסחים", "שקלים", "יומא", "סוכה", "ביצה", "ראש השנה", "תענית", "מגילה", "מועד קטן", "חגיגה",
  "יבמות", "כתובות", "נדרים", "נזיר", "סוטה", "גיטין", "קידושין", "בבא קמא", "בבא מציעא", "בבא בתרא", "סנהדרין", "מכות",
  "שבועות", "עבודה זרה", "הוריות", "זבחים", "מנחות", "חולין", "בכורות", "ערכין", "תמורה", "כריתות", "מעילה", "תמיד", "נידה",
]);

const HEB_VAL = {
  "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
  "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50,
  "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90, "ק": 100, "ר": 200, "ש": 300, "ת": 400,
};

function hebToInt(raw) {
  if (!raw) return null;
  const s = raw.replace(/["'׳״]/g, "");
  if (!s) return null;
  if (s === "טו") return 15;
  if (s === "טז") return 16;
  let total = 0;
  for (const ch of s) {
    const v = HEB_VAL[ch];
    if (!v) return null;
    total += v;
  }
  return total > 0 ? total : null;
}

function intToHeb(n) {
  const hundreds = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  if (n <= 0) return String(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  let out = hundreds[h] ?? "";
  if (r === 15) return out + "טו";
  if (r === 16) return out + "טז";
  out += tens[Math.floor(r / 10)] + ones[r % 10];
  return out;
}

function parseDafAmud(question) {
  if (!question) return { daf: null, amud: null };
  // Parse the LAST relevant parenthetical block, supporting formats like:
  // (ב.), (כג:), (דף יט ע"א), (מב. ד"ה ...), (מו)
  const parenRe = /\(([^)]{1,140})\)/g;
  let m = null;
  let result = { daf: null, amud: null };

  while ((m = parenRe.exec(question)) !== null) {
    const seg = m[1].trim();
    if (!seg) continue;

    // Pattern 1: explicit amud marker, e.g. דף יט ע"א / יט ע"ב
    const explicitAmud = seg.match(/(?:^|\s)(?:דף\s*)?([א-ת"'׳״ךםןףץ]{1,6})\s*ע\s*["'׳״]?\s*([אב])/);
    if (explicitAmud) {
      const daf = hebToInt(explicitAmud[1]);
      const amud = explicitAmud[2] === "א" ? 1 : 2;
      if (daf) {
        result = { daf, amud };
        continue;
      }
    }

    // Pattern 2: numeral + dot/colon anywhere in the segment, e.g. מב. / כג:
    const punctuated = seg.match(/(?:^|\s)(?:דף\s*)?([א-ת"'׳״ךםןףץ]{1,6})\s*([.:׃])/);
    if (punctuated) {
      const daf = hebToInt(punctuated[1]);
      if (daf) {
        result = { daf, amud: punctuated[2] === "." ? 1 : 2 };
        continue;
      }
    }

    // Pattern 3: plain daf without amud marker, e.g. (מו)
    const plain = seg.match(/^(?:דף\s*)?([א-ת"'׳״ךםןףץ]{1,6})$/);
    if (plain) {
      const daf = hebToInt(plain[1]);
      if (daf) {
        result = { daf, amud: null };
      }
    }
  }

  return result;
}

function detectDafFromTags(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  for (const t of arr) {
    if (typeof t !== "string") continue;
    if (!t.startsWith("cat:דף ")) continue;
    const raw = t.slice("cat:דף ".length).trim();
    const daf = hebToInt(raw);
    if (daf) return daf;
  }
  for (const t of arr) {
    if (typeof t !== "string") continue;
    if (!t.startsWith("cat:")) continue;
    const raw = t.slice(4).replace(/[.:]/g, "").trim();
    const daf = hebToInt(raw);
    if (daf) return daf;
  }
  return null;
}

function detectAmudFromTags(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  if (arr.includes('cat:ע"א')) return 1;
  if (arr.includes('cat:ע"ב')) return 2;
  return null;
}

function detectMasechta(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  for (const t of arr) {
    if (typeof t !== "string") continue;
    if (t.startsWith("cat:")) {
      const name = t.slice(4);
      if (SHAS_MASECHTOT.has(name)) return name;
    }
    if (t.startsWith("מסכת:")) {
      const name = t.slice("מסכת:".length);
      if (SHAS_MASECHTOT.has(name)) return name;
    }
  }
  return null;
}

function ensureTags(tags, masechta, daf, amud) {
  const base = Array.isArray(tags) ? tags.filter((t) => typeof t === "string") : [];
  // Remove generated structural tags first, then re-add the normalized set.
  const out = new Set(base.filter((t) => {
    if (t === 'cat:ע"א' || t === 'cat:ע"ב') return false;
    if (t.startsWith("cat:דף ")) return false;
    if (t.startsWith("cat:") && /^(cat:)[א-ת"'׳״ךםןףץ]{1,6}\.$/.test(t)) return false;
    if (t.startsWith("cat:") && t.includes(" · ")) return false;
    if (masechta && t === `cat:${masechta}`) return false;
    return true;
  }));

  // Stage 1 requested behavior: classify by daf first.
  // Keep masechta as structured fields and scoped daf tags, avoid global amud tags for now.
  if (daf) {
    const h = intToHeb(daf);
    out.add(`cat:דף ${h}`);
    out.add(`cat:${h}.`);
    if (masechta) {
      out.add(`cat:${masechta} · ${h}.`);
      out.add(`cat:${masechta} · ${h}`);
    }
  }
  return Array.from(out);
}

async function fetchAllYeshivaCards(sb) {
  const all = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const to = from + page - 1;
    const { data, error } = await sb
      .from("cards")
      .select("id,question,tags,masechta,daf,amud")
      .range(from, to);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows.filter((r) => Array.isArray(r.tags) && r.tags.includes("source:yeshiva")));
    if (rows.length < page) break;
    from += page;
  }
  return all;
}

async function updateBatch(sb, rows) {
  for (const r of rows) {
    const { error } = await sb
      .from("cards")
      .update({
        masechta: r.masechta,
        daf: r.daf,
        amud: r.amud,
        tags: r.tags,
      })
      .eq("id", r.id);
    if (error) throw error;
  }
}

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  console.log("🔐 Logging in...");
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (authErr) throw authErr;

  console.log("📥 Loading source:yeshiva cards...");
  const cards = await fetchAllYeshivaCards(sb);
  console.log(`Found ${cards.length} yeshiva cards`);

  const updates = [];
  let withParsedDaf = 0;
  let withMasechta = 0;

  for (const c of cards) {
    const masechta = c.masechta || detectMasechta(c.tags);
    const parsed = parseDafAmud(c.question || "");
    const tagDaf = detectDafFromTags(c.tags);
    const tagAmud = detectAmudFromTags(c.tags);
    const daf = c.daf || parsed.daf || tagDaf;
    const amud = c.amud || parsed.amud || tagAmud || (daf ? 1 : null);
    const tags = ensureTags(c.tags, masechta, daf, amud);

    const changed =
      masechta !== c.masechta ||
      daf !== c.daf ||
      amud !== c.amud ||
      JSON.stringify(tags) !== JSON.stringify(c.tags || []);

    if (!changed) continue;
    if (parsed.daf) withParsedDaf += 1;
    if (masechta) withMasechta += 1;
    updates.push({ id: c.id, masechta: masechta ?? null, daf: daf ?? null, amud: amud ?? null, tags });
  }

  console.log(`🛠️ Will update ${updates.length} cards (parsed daf for ${withParsedDaf}, masechta for ${withMasechta})`);

  const BATCH = 100;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await updateBatch(sb, batch);
    console.log(`✅ Updated ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }

  console.log("🎉 Backfill completed");
}

main().catch((err) => {
  console.error("❌ Backfill failed:", err?.message || err);
  process.exit(1);
});
