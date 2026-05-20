import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hgjfpwdugvvtrfhycejv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDc0NTYsImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy451NO0N37rz7yjcpXYc';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });
const { data: session } = await sb.auth.getSession();
const token = session.session.access_token;

const sql = process.argv[2];
if (!sql) { console.error('Usage: node scripts/_query-rows.mjs "SELECT ..."'); process.exit(1); }

// Use PostgREST RPC with a wrapper that returns rows
const wrappedSql = `SELECT json_agg(t) FROM (${sql}) t`;
const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/exec_sql_rows', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
    'apikey': SUPABASE_ANON_KEY,
  },
  body: JSON.stringify({ query: sql }),
});
const body = await res.json();
// fallback: query via PostgREST table API
const tableRes = await fetch(
  SUPABASE_URL + '/rest/v1/categories?name=eq.יומא&select=id,name,parent_id,deleted_at,user_id',
  { headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY } }
);
const rows = await tableRes.json();
console.log('\n=== יומא categories in DB ===');
console.table(rows);
