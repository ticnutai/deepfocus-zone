import { createClient } from "@supabase/supabase-js";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const MASECHTA_EN = {
  "ברכות":"Berakhot","שבת":"Shabbat","עירובין":"Eruvin","פסחים":"Pesachim","שקלים":"Shekalim",
  "יומא":"Yoma","סוכה":"Sukkah","ביצה":"Beitzah","ראש השנה":"Rosh_Hashanah","תענית":"Taanit",
  "מגילה":"Megillah","מועד קטן":"Moed_Katan","חגיגה":"Chagigah",
};
const slug = (m) => (MASECHTA_EN[m] || m).replace(/\s+/g, "_");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ROOT = "/dev-server/סדר מועד";

// Hebrew daf letters → numbers (gematria for 2..157)
const HEBREW_NUM = {
  א:1,ב:2,ג:3,ד:4,ה:5,ו:6,ז:7,ח:8,ט:9,י:10,
  כ:20,ך:20,ל:30,מ:40,ם:40,נ:50,ן:50,ס:60,ע:70,פ:80,ף:80,צ:90,ץ:90,ק:100,ר:200,ש:300,ת:400,
};
function gematria(s) {
  // Strip geresh/gershayim
  s = s.replace(/[״"׳']/g, "");
  let sum = 0;
  for (const ch of s) sum += HEBREW_NUM[ch] || 0;
  return sum;
}

// filename pattern: דף_<letters>_עמוד_<א|ב>.pdf
const re = /^דף_(.+?)_עמוד_([אב])\.pdf$/;

async function listExisting(masechta) {
  const out = new Set();
  let offset = 0;
  while (true) {
    const { data, error } = await sb.storage.from("gemara-pages").list(masechta, { limit: 1000, offset });
    if (error) throw error;
    for (const f of data) out.add(f.name);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

const masechtot = await readdir(ROOT);
let totalUploaded = 0, totalSkipped = 0, totalFailed = 0;

for (const masechta of masechtot) {
  const dir = join(ROOT, masechta);
  if (!(await stat(dir)).isDirectory()) continue;
  const files = await readdir(dir);
  const existing = await listExisting(masechta);
  const folder = slug(masechta);
  console.log(`\n=== ${masechta} (${folder}): ${files.length} files ===`);

  const tasks = [];
  const existingSlug = await listExisting(folder);
  for (const f of files) {
    const m = f.match(re);
    if (!m) { console.warn("  skip (no match):", f); continue; }
    const daf = gematria(m[1]);
    const amud = m[2] === "א" ? 1 : 2;
    if (!daf) { console.warn("  skip (bad daf):", f); continue; }
    const dest = `${daf}_${amud}.pdf`;
    if (existingSlug.has(dest)) { totalSkipped++; continue; }
    tasks.push({ src: join(dir, f), folder, dest });
  }

  // Upload in parallel batches of 8
  const BATCH = 8;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const slice = tasks.slice(i, i + BATCH);
    await Promise.all(slice.map(async (t) => {
      const buf = await readFile(t.src);
      const { error } = await sb.storage.from("gemara-pages")
        .upload(`${t.folder}/${t.dest}`, buf, { contentType: "application/pdf", upsert: true });
      if (error) { totalFailed++; console.error("  FAIL", t.dest, error.message); }
      else { totalUploaded++; }
    }));
    if (i % (BATCH * 5) === 0) process.stdout.write(`  ${i + slice.length}/${tasks.length}\r`);
  }
  console.log(`  ✓ uploaded ${tasks.length} new files`);
}

console.log(`\nDone: uploaded=${totalUploaded}, skipped=${totalSkipped}, failed=${totalFailed}`);
