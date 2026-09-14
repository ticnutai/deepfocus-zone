// Real cloud test; secrets are generated in memory and never logged.
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const env = loadEnv('development', process.cwd(), 'VITE_');
assert.equal(new URL(env.VITE_SUPABASE_URL).hostname, 'elfxevuxhffxskooppca.supabase.co');
const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const a = client(), b = client(), anonymous = client();
const username = `qa.recovery.${Date.now()}`;
const password = randomBytes(18).toString('hex') + 'T7';
const nextPassword = randomBytes(18).toString('hex') + 'R8';
const code = randomBytes(24).toString('hex');
const nextCode = randomBytes(24).toString('hex');
const hash = (v) => createHash('sha256').update(v).digest('hex');
let id;
try {
  const registered = await a.rpc('register_username_account', { p_username: username, p_password: password, p_display_name: 'QA temporary', p_recovery_hash: hash(code) });
  assert.equal(registered.error, null, registered.error?.message);
  const login = await a.auth.signInWithPassword({ email: registered.data, password });
  assert.equal(login.error, null, login.error?.message);
  id = login.data.user.id;
  const access = await a.rpc('get_effective_content_access');
  assert.equal(access.error, null);
  assert.equal(access.data.is_admin, false);
  const second = await b.auth.signInWithPassword({ email: registered.data, password });
  assert.equal(second.error, null);
  const inserted = await a.from('cards').insert({ user_id: id, type: 'flashcard', question: 'QA cross-client', answer: 'temporary' }).select('id').single();
  assert.equal(inserted.error, null, inserted.error?.message);
  const read = await b.from('cards').select('question').eq('id', inserted.data.id).single();
  assert.equal(read.data?.question, 'QA cross-client');
  const cardId = inserted.data.id;
  const ownHide = await a.rpc('set_card_visibility', { p_card: cardId, p_hidden: true });
  assert.equal(ownHide.error, null);
  const rules = await b.from('card_visibility').select('card_id').eq('card_id', cardId);
  assert.equal(rules.data?.length, 1);
  assert.ok((await a.rpc('set_card_visibility', { p_card: cardId, p_hidden: false, p_scope: 'admin' })).error);
  const admin = (hidden, target) => {
    const sql = `SELECT public.set_card_visibility('${cardId}'::text,${hidden},'admin',${target ? `'${target}'::uuid` : 'NULL'});`;
    const run = spawnSync(process.execPath, ['scripts/run-migration.mjs','sql',sql,'qa-exact-card-visibility'], { encoding: 'utf8' });
    assert.equal(run.status, 0, 'Admin visibility operation failed: ' + run.stdout + run.stderr);
  };
  for (const target of [id, null]) {
    admin(true, target);
    assert.equal((await b.from('cards').select('id').eq('id',cardId)).data?.length, 0);
    await a.rpc('set_card_visibility', { p_card: cardId, p_hidden: false });
    assert.equal((await b.from('cards').select('id').eq('id',cardId)).data?.length, 0);
    admin(false, target);
    assert.equal((await b.from('cards').select('id').eq('id',cardId)).data?.length, 1);
  }
  const hiddenKeys = await b.from('account_recovery_keys').select('*');
  assert.ok(hiddenKeys.error || hiddenKeys.data.length === 0);
  const wrong = await anonymous.rpc('recover_username_account', { p_username: username, p_code: '0'.repeat(48), p_password: nextPassword, p_next_hash: hash(nextCode) });
  assert.equal(wrong.data, false);
  const recovered = await anonymous.rpc('recover_username_account', { p_username: username, p_code: code, p_password: nextPassword, p_next_hash: hash(nextCode) });
  assert.equal(recovered.error, null, recovered.error?.message);
  assert.equal(recovered.data, true);
  const stale = await anonymous.rpc('recover_username_account', { p_username: username, p_code: code, p_password: password, p_next_hash: hash(nextCode) });
  assert.equal(stale.data, false);
  assert.ok((await anonymous.auth.signInWithPassword({ email: registered.data, password })).error);
  assert.equal((await anonymous.auth.signInWithPassword({ email: registered.data, password: nextPassword })).error, null);
  console.log('PASS: username signup, two independent clients, cloud data, recovery privacy, wrong code, rotation, old/new passwords');
} finally {
  // Only the exact uniquely created fixture may be removed, never a name pattern.
  const condition = id ? `id='${id}'::uuid AND ` : '';
  const sql = `DO $$ BEGIN DELETE FROM auth.users WHERE ${condition}raw_user_meta_data->>'username'='${username}'; IF EXISTS(SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'username'='${username}') THEN RAISE EXCEPTION 'Fixture cleanup incomplete'; END IF; END $$;`;
  const cleanup = spawnSync(process.execPath, ['scripts/run-migration.mjs', 'sql', sql, 'cleanup-exact-qa-account'], { encoding: 'utf8' });
  if (cleanup.status !== 0) throw new Error('Temporary test-account cleanup failed');
  console.log('Temporary account cleanup completed');
}
