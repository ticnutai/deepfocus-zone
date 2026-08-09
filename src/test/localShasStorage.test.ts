import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

type PackedMasechet = {
  schema_version: number;
  slug: string;
  amudim: Record<string, { id: string; gemara: string[] }>;
};

describe("packed local Shas storage", () => {
  const shasRoot = resolve(process.cwd(), "public", "shas");
  const index = JSON.parse(readFileSync(resolve(shasRoot, "index.json"), "utf8"));

  it("uses the versioned gzip-per-masechet format", () => {
    expect(index.schema_version).toBe(3);
    expect(index.storage).toEqual({
      format: "masechet-map+gzip",
      path_template: "{slug}.json.gz",
      compression: "gzip",
    });
    expect(index.masechtot).toHaveLength(37);
  });

  it("contains every indexed amud in a readable packed file", () => {
    let indexedAmudim = 0;
    let packedAmudim = 0;

    for (const masechet of index.masechtot) {
      const packed = JSON.parse(
        gunzipSync(readFileSync(resolve(shasRoot, `${masechet.slug}.json.gz`))).toString("utf8"),
      ) as PackedMasechet;

      expect(packed.schema_version).toBe(3);
      expect(packed.slug).toBe(masechet.slug);

      for (const daf of masechet.dafim) {
        for (const amud of daf.amudim) {
          const key = `${daf.n}${amud}`;
          indexedAmudim += 1;
          expect(packed.amudim[key]?.id).toBeTruthy();
          expect(Array.isArray(packed.amudim[key]?.gemara)).toBe(true);
        }
      }
      packedAmudim += Object.keys(packed.amudim).length;
    }

    expect(indexedAmudim).toBe(5375);
    expect(packedAmudim).toBe(indexedAmudim);
  });
});

