// Packs the legacy per-amud Shas JSON files into one gzip file per masechet.
// The JSON payload remains lossless and addressable by daf/amud (for example 2a).
//
// Usage:
//   node scripts/pack-local-shas.mjs
//   node scripts/pack-local-shas.mjs --remove-source

// index.json is intentionally kept uncompressed because it is small and is
// needed before a masechet is selected.

import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const gzipAsync = promisify(gzip);
const root = path.join(process.cwd(), "public", "shas");
const indexPath = path.join(root, "index.json");
const removeSource = process.argv.includes("--remove-source");
const index = JSON.parse(await readFile(indexPath, "utf8"));

let rawBytes = 0;
let packedBytes = 0;
let amudCount = 0;

for (const masechet of index.masechtot) {
  const amudim = {};
  for (const daf of masechet.dafim) {
    for (const amud of daf.amudim) {
      const key = `${daf.n}${amud}`;
      const sourcePath = path.join(root, masechet.slug, `${key}.json`);
      const source = await readFile(sourcePath, "utf8");
      rawBytes += Buffer.byteLength(source);
      amudim[key] = JSON.parse(source);
      amudCount += 1;
    }
  }

  const payload = JSON.stringify({
    schema_version: 3,
    slug: masechet.slug,
    amudim,
  });
  const packed = await gzipAsync(Buffer.from(payload), { level: 9 });
  await writeFile(path.join(root, `${masechet.slug}.json.gz`), packed);
  packedBytes += packed.length;
  console.log(`${masechet.he}: ${(Buffer.byteLength(payload) / 1048576).toFixed(2)}MB -> ${(packed.length / 1048576).toFixed(2)}MB`);

  if (removeSource) {
    // The exact directory comes from the trusted generated index and remains
    // inside public/shas. Never remove the root itself.
    const sourceDir = path.resolve(root, masechet.slug);
    if (sourceDir.startsWith(`${path.resolve(root)}${path.sep}`)) {
      await rm(sourceDir, { recursive: true, force: true });
    }
  }
}

index.schema_version = 3;
index.storage = {
  format: "masechet-map+gzip",
  path_template: "{slug}.json.gz",
  compression: "gzip",
};
await writeFile(indexPath, JSON.stringify(index), "utf8");

const indexBytes = (await stat(indexPath)).size;
console.log("=".repeat(60));
console.log(`Packed ${amudCount} amudim`);
console.log(`Raw: ${(rawBytes / 1048576).toFixed(2)}MB`);
console.log(`Packed: ${(packedBytes / 1048576).toFixed(2)}MB (+ ${(indexBytes / 1048576).toFixed(2)}MB index)`);
console.log(`Saved: ${(100 - (packedBytes / rawBytes) * 100).toFixed(1)}%`);

