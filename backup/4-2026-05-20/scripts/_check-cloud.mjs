import { createClient } from '@supabase/supabase-js';

const URL = 'https://nkqlojxjyjxoiuxiflrg.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rcWxvanhqeWp4b2l1eGlmbHJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2ODMwMDcsImV4cCI6MjA5NDI1OTAwN30.9MsRdzbEEC92TtaSx3HOZ6HxfqtCV4obMUOALlDelrE';
const EMAIL = process.env.ADMIN_EMAIL || 'ticnutai@gmail.com';
const PASS  = process.env.ADMIN_PASSWORD;

if (!PASS) { console.error('Set ADMIN_PASSWORD env var'); process.exit(1); }

const sb = createClient(URL, KEY);
const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
if (error) { console.error('Login failed:', error.message); process.exit(1); }

const { count: total }    = await sb.from('categories').select('*', { count: 'exact', head: true });
const { count: roots }    = await sb.from('categories').select('*', { count: 'exact', head: true }).is('parent_id', null).is('deleted_at', null);
const { count: children } = await sb.from('categories').select('*', { count: 'exact', head: true }).not('parent_id', 'is', null).is('deleted_at', null);
const { count: deleted }  = await sb.from('categories').select('*', { count: 'exact', head: true }).not('deleted_at', 'is', null);
const { count: cards }    = await sb.from('cards').select('*', { count: 'exact', head: true });
const { count: orphans }  = await sb.from('cards').select('*', { count: 'exact', head: true }).not('category_id', 'is', null);

console.log('══════════════════════════════');
console.log(' בדיקת נתוני Supabase');
console.log('══════════════════════════════');
console.log('קטגוריות סה"כ (כולל מחוקות):', total);
console.log('קטגוריות שורש (פעילות):      ', roots);
console.log('קטגוריות ילד (פעילות):        ', children);
console.log('קטגוריות שנמחקו (soft):        ', deleted);
console.log('כרטיסות סה"כ:                 ', cards);
console.log('כרטיסות עם category_id:       ', orphans);
