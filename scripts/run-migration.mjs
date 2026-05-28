// Migration Runner for deepfocus-zone (elfxevuxhffxskooppca)
// Uses exec_sql RPC — logs in as jj1212t@gmail.com and runs SQL directly

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = 'https://elfxevuxhffxskooppca.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVsZnhldnV4aGZmeHNrb29wcGNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MDY4NjgsImV4cCI6MjA5NTM4Mjg2OH0.5Rc6aZWpWeuvbO49paAXR1qNXdQk_H3stxb60Fce6TM';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jj1212t@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '543211';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function login() {
  const { data, error } = await sb.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (error) {
    console.error('❌ Login failed:', error.message);
    process.exit(1);
  }
  console.log('✅ Logged in as:', data.user.email);
  return data.session.access_token;
}

async function runSql(token, sql, name = 'migration') {
  const start = Date.now();
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ query: sql }),
  });

  const elapsed = Date.now() - start;
  const body = await res.json();

  if (res.ok) {
    if (body && typeof body === 'object' && body.success === false) {
      console.error('❌ exec_sql returned failure:', body.error);
      return false;
    }
    console.log('✅ Migration completed successfully!');
    if (body && body.rows_affected !== undefined) {
      console.log(`   Rows affected: ${body.rows_affected}`);
    }
    console.log(`   Time: ${elapsed}ms`);
    return true;
  } else {
    console.error('❌ Migration failed (HTTP', res.status + ')');
    console.error('  ', JSON.stringify(body).slice(0, 500));
    return false;
  }
}

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('   🔧 Migration Runner — deepfocus-zone');
  console.log('══════════════════════════════════════════════════');

  const token = await login();
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help') {
    console.log('\nUsage:');
    console.log('  node scripts/run-migration.mjs file <path-to-sql>');
    console.log('  node scripts/run-migration.mjs sql "SELECT now();" [name]');
    return;
  }

  if (command === 'sql') {
    const sql = args[1];
    const name = args[2] || 'inline_sql';
    if (!sql) { console.error('❌ SQL string required'); process.exit(1); }
    console.log(`\n🚀 Running SQL: ${name}`);
    console.log('──────────────────────────────────────────────────');
    const ok = await runSql(token, sql, name);
    if (!ok) process.exit(1);
  } else if (command === 'file') {
    const filePath = args[1];
    if (!filePath) { console.error('❌ File path required'); process.exit(1); }
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(absPath)) { console.error('❌ File not found:', absPath); process.exit(1); }
    const sql = fs.readFileSync(absPath, 'utf8');
    const name = path.basename(absPath, '.sql');
    console.log(`\n🚀 Running migration: ${name}`);
    console.log(`   📏 SQL size: ${sql.length} chars`);
    console.log('──────────────────────────────────────────────────');
    const ok = await runSql(token, sql, name);
    if (!ok) process.exit(1);
  } else {
    console.error('❌ Unknown command:', command);
    process.exit(1);
  }

  console.log('\n🏁 Done!');
}

main();
