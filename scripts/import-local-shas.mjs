// Import the locally-downloaded Shas (Sefaria JSON) into public/shas
// Source: gemaraca/שס_ספריא (seder/masechet/daf/amud structure, Hebrew paths)
// Target: public/shas/{Slug}.json.gz (one lossless compressed file per masechet)
//         public/shas/index.json     (compact navigation index)
//
// Usage: node scripts/import-local-shas.mjs [--source <path>]
// Re-run whenever the source data is updated.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
const srcFlag = argv.indexOf("--source");
const DEFAULT_SOURCE =
  "C:\\Users\\jj121\\Desktop\\סדר מסמכים 270526 (OneDrive-full)\\gemaraca\\שס_ספריא";
const SOURCE = srcFlag >= 0 ? argv[srcFlag + 1] : DEFAULT_SOURCE;
const TARGET = path.join(process.cwd(), "public", "shas");
const gzipAsync = promisify(gzip);

if (!existsSync(SOURCE)) {
  console.error(`Source not found: ${SOURCE}`);
  console.error("Pass --source <path to שס_ספריא>");
  process.exit(1);
}

const srcIndex = JSON.parse(await readFile(path.join(SOURCE, "index.json"), "utf8"));

// slug = masechet_en with spaces → underscores (matches masechtaSlug() in src/lib/study/sefaria.ts)
const slugOf = (en) => en.replace(/\s+/g, "_");

let files = 0;
let bytes = 0;
const outMasechtot = [];

for (const seder of srcIndex.sedarim) {
  for (const mas of seder.masechtot) {
    const slug = slugOf(mas.name_en);
    const packedAmudim = {};
    const dafim = [];
    for (const daf of mas.dafim) {
      const amudim = [];
      for (const amud of daf.amudim) {
        const srcFile = path.join(SOURCE, amud.file);
        const obj = JSON.parse(await readFile(srcFile, "utf8"));
        const minified = JSON.stringify(obj); // minify
        packedAmudim[`${daf.daf_number}${amud.amud_en}`] = obj;
        files++;
        bytes += Buffer.byteLength(minified);
        amudim.push(amud.amud_en);
      }
      dafim.push({ n: daf.daf_number, he: daf.daf, amudim });
    }
    outMasechtot.push({
      key: mas.key,
      he: mas.name,
      en: mas.name_en,
      slug,
      seder_he: seder.seder,
      daf_count: mas.daf_count,
      amud_count: mas.amud_count,
      commentaries: mas.commentaries, // [{key,he,en}]
      dafim,
    });
    const packed = await gzipAsync(Buffer.from(JSON.stringify({
      schema_version: 3,
      slug,
      amudim: packedAmudim,
    })), { level: 9 });
    await writeFile(path.join(TARGET, `${slug}.json.gz`), packed);
    console.log(`OK ${mas.name} -> shas/${slug}.json.gz (${mas.amud_count} amudim)`);
  }
}

const index = {
  schema_version: 3,
  generated: new Date().toISOString(),
  source: "Sefaria — Talmud Bavli (Vilna), local snapshot",
  totals: srcIndex.totals,
  storage: {
    format: "masechet-map+gzip",
    path_template: "{slug}.json.gz",
    compression: "gzip",
  },
  masechtot: outMasechtot,
};
await writeFile(path.join(TARGET, "index.json"), JSON.stringify(index), "utf8");
console.log("=".repeat(50));
console.log(`Done: ${files} amudim, ${(bytes / 1024 / 1024).toFixed(1)} MB raw -> public/shas/`);
