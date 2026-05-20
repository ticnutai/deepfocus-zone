import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htsuoqvafayyffyxjhhh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const { data, error } = await sb.auth.signInWithPassword({
  email: 'jj1212t@gmail.com',
  password: '543211',
});
if (error) { console.error('Login failed:', error.message); process.exit(1); }
console.log('✅ Logged in as:', data.user.email);
const token = data.session.access_token;

// Use PostgREST REST API to fetch cards directly
const res = await fetch(SUPABASE_URL + '/rest/v1/cards?select=id,question,srs', {
  headers: {
    'Authorization': 'Bearer ' + token,
    'apikey': SUPABASE_ANON_KEY,
    'Prefer': 'count=exact',
  },
});
const cards = await res.json();
if (!Array.isArray(cards)) {
  console.error('Error:', JSON.stringify(cards)); process.exit(1);
}

const now = Date.now();
const todayStart = new Date(); todayStart.setHours(0,0,0,0);
const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);

const dueNow = cards.filter(c => (c.srs?.dueAt ?? 0) <= now);
const dueTodayOnly = cards.filter(c => c.srs?.dueAt >= todayStart.getTime() && c.srs?.dueAt <= todayEnd.getTime());
const overdue = cards.filter(c => (c.srs?.dueAt ?? 0) < todayStart.getTime());
const future = cards.filter(c => (c.srs?.dueAt ?? 0) > todayEnd.getTime());

console.log('\n📊 תוצאות:');
console.log(`  סה"כ כרטיסיות ב-DB:        ${cards.length}`);
console.log(`  כרטיסיות לחזרה עכשיו:       ${dueNow.length} (isDue = dueAt <= now)`);
console.log(`  - מהן: בדיוק היום:           ${dueTodayOnly.length}`);
console.log(`  - מהן: פיגור (מימים קודמים): ${overdue.length}`);
console.log(`  כרטיסיות עתידיות:            ${future.length}`);

console.log('\n📋 פירוט כרטיסיות לחזרה (עד 20):');
dueNow.sort((a,b) => a.srs.dueAt - b.srs.dueAt).slice(0, 20).forEach((r, i) => {
  const due = new Date(Number(r.srs.dueAt));
  const front = (r.question ?? '').slice(0, 70);
  const isOverdue = r.srs.dueAt < todayStart.getTime();
  console.log(`  ${i+1}. [${due.toLocaleDateString('he-IL')} ${due.toLocaleTimeString('he-IL', {hour:'2-digit',minute:'2-digit'})}]${isOverdue?' ⚠️ פיגור':''} ${front}`);
});
