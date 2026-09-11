import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const runner = fs.readFileSync(new URL("./run-migration.mjs", import.meta.url), "utf8");
const value = (name) => runner.match(new RegExp(`const ${name} = (?:process\\.env\\.[A-Z_]+ \\|\\| )?['\"]([^'\"]+)`))?.[1];
const url = value("SUPABASE_URL");
const key = value("SUPABASE_ANON_KEY");
const email = process.env.ADMIN_EMAIL || value("ADMIN_EMAIL");
const password = process.env.ADMIN_PASSWORD || value("ADMIN_PASSWORD");
assert(url && key && email && password, "missing project configuration");

const anon = createClient(url, key, { auth: { persistSession: false } });
const admin = createClient(url, key, { auth: { persistSession: false } });
const login = await admin.auth.signInWithPassword({ email, password });
assert.equal(login.error, null, login.error?.message);

const [rules, sources, adminPolicy, anonPolicy, provenance] = await Promise.all([
  admin.from("role_content_access").select("role_id,include_own,include_site_library,approved_only,source_user_ids"),
  admin.rpc("get_admin_content_sources"),
  admin.rpc("get_effective_content_access"),
  anon.rpc("get_effective_content_access"),
  admin.from("cards").select("id", { count: "exact", head: true }).is("created_by", null),
]);
const anonSnapshot = await anon.rpc("get_content_overlay_snapshot");
const currentChildren = await anon.rpc("get_content_category_children", { p_parent_id: null });
const legacySnapshot = await anon.rpc("get_guest_category_children_for", {
  p_source_user_id: "00000000-0000-0000-0000-000000000001", p_parent_id: null,
});
const concurrentSources = await Promise.all(Array.from({ length: 2 }, () => admin.rpc("get_admin_content_sources")));

for (const [name, result] of Object.entries({ rules, sources, adminPolicy, anonPolicy, anonSnapshot, legacySnapshot, provenance })) {
  assert.equal(result.error, null, `${name}: ${result.error?.message ?? "unknown error"}`);
}
assert((rules.data?.length ?? 0) >= 4, "default access roles were not seeded");
assert(Array.isArray(sources.data), "content sources RPC did not return a list");
assert.equal(adminPolicy.data?.is_admin, true, "admin policy must remain unrestricted");
assert(Array.isArray(anonPolicy.data?.source_user_ids), "anonymous policy missing source ids");
assert.equal(currentChildren.error, null, currentChildren.error?.message);
concurrentSources.forEach((result, index) => assert.equal(result.error, null, `concurrent source ${index}: ${result.error?.message ?? "unknown error"}`));
assert.deepEqual(legacySnapshot.data?.map((row) => row.id), currentChildren.data?.map((row) => row.id), "legacy RPC accepted a caller-supplied source override");
assert.equal(provenance.count, 0, "existing cards were not fully attributed");

const forbidden = await anon.from("role_content_access").select("role_id");
assert(forbidden.error || forbidden.data?.length === 0, "anonymous client can read role policy rows");

console.log(JSON.stringify({
  roleRules: rules.data.length,
  identifiableSources: sources.data.length,
  anonymousSources: anonPolicy.data.source_user_ids.length,
  anonymousCards: anonSnapshot.data.cards_total_count,
  unattributedCards: provenance.count,
  callerOverrideBlocked: true,
}));
