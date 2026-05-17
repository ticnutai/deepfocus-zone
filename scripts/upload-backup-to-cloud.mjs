/**
 * Upload a pashash backup (.json.gz) directly to Supabase.
 * Usage:
 *   $env:ADMIN_PASSWORD = "..."
 *   node scripts/upload-backup-to-cloud.mjs <path-to-backup.json.gz>
 */
import { createClient } from '@supabase/supabase-js';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { Writable } from 'stream';
import { existsSync } from 'fs';

const SUPABASE_URL  = 'https://nkqlojxjyjxoiuxiflrg.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rcWxvanhqeWp4b2l1eGlmbHJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2ODMwMDcsImV4cCI6MjA5NDI1OTAwN30.9MsRdzbEEC92TtaSx3HOZ6HxfqtCV4obMUOALlDelrE';
const EMAIL        = process.env.ADMIN_EMAIL    || 'ticnutai@gmail.com';
const PASS         = process.env.ADMIN_PASSWORD;
const BATCH        = 500;

const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node upload-backup-to-cloud.mjs <path-to-backup.json.gz>'); process.exit(1); }
if (!existsSync(filePath)) { console.error('File not found:', filePath); process.exit(1); }
if (!PASS) { console.error('Set ADMIN_PASSWORD env var'); process.exit(1); }

// ── helpers ───────────────────────────────────────────────────────────────────
const chunk = (arr, size) => { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; };
const iso = (ms) => new Date(ms ?? Date.now()).toISOString();

async function readGzip(path) {
  const chunks = [];
  await pipeline(
    createReadStream(path),
    createGunzip(),
    new Writable({ write(c, _, cb) { chunks.push(c); cb(); } }),
  );
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function upsertBatches(sb, table, rows, conflict) {
  if (!rows.length) return;
  let done = 0;
  for (const batch of chunk(rows, BATCH)) {
    const opts = conflict ? { onConflict: conflict } : {};
    const { error } = await sb.from(table).upsert(batch, opts);
    if (error) throw new Error(`${table}.upsert: ${error.message}`);
    done += batch.length;
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
  }
  console.log();
}

// ── main ──────────────────────────────────────────────────────────────────────
console.log('📂 Reading backup file...');
const backup = await readGzip(filePath);
console.log(`   version=${backup.version}  exportedAt=${backup.exportedAt}  userId=${backup.userId}`);
const { state, userId: backupUserId } = backup;

// Login
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
const { data: authData, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
if (authErr) { console.error('Login failed:', authErr.message); process.exit(1); }
const userId = authData.user.id;
console.log(`✅ Logged in as: ${authData.user.email}  (uid=${userId})`);

if (backupUserId && backupUserId !== userId) {
  console.warn(`⚠️  Backup userId (${backupUserId}) ≠ logged-in userId (${userId}). Continuing with logged-in user.`);
}

// ── Step 1: Hard-delete everything (including soft-delete tombstones) ──────────
console.log('\n🗑  Clearing all existing user data...');
const tables = ['review_logs','learning_sessions','shas_reviews','card_decks','cards','decks','goals','day_notes'];
for (const t of tables) {
  const { error } = await sb.from(t).delete().eq('user_id', userId);
  if (error) console.warn(`  ⚠️  ${t}.delete: ${error.message}`);
  else console.log(`  ✓ cleared ${t}`);
}
// Hard-delete categories (including tombstones)
const { error: catDelErr } = await sb.from('categories').delete().eq('user_id', userId);
if (catDelErr) console.warn(`  ⚠️  categories.delete: ${catDelErr.message}`);
else console.log('  ✓ cleared categories (including tombstones)');

// ── Step 2: Build rows ────────────────────────────────────────────────────────
console.log('\n📤 Uploading data...');

// Categories — insert level-by-level so FK (parent_id → id) is never violated.
// Each upsert call only sends rows whose parent is already committed to DB.
const allCatRows = (state.categories ?? []).map(c => ({
  id: c.id, user_id: userId, name: c.name,
  parent_id: c.parentId ?? null,
  color: c.color ?? null,
  sort_order: c.sortOrder ?? 0,
  created_at: iso(c.createdAt),
  updated_at: iso(c.updatedAt ?? c.createdAt),
  deleted_at: null,
}));
{
  const inDb = new Set();
  let remaining = [...allCatRows];
  let totalDone = 0;
  while (remaining.length > 0) {
    const thisLevel = remaining.filter(r => r.parent_id == null || inDb.has(r.parent_id));
    if (thisLevel.length === 0) {
      // Orphans / cycles — set parent_id = null so FK is satisfied
      console.warn(`  ⚠️  ${remaining.length} categories have missing parents — setting parent_id=null`);
      for (const r of remaining) r.parent_id = null;
      for (const b of chunk(remaining, BATCH)) {
        const { error } = await sb.from('categories').upsert(b, { onConflict: 'id' });
        if (error) throw new Error(`categories.upsert (orphan): ${error.message}`);
      }
      totalDone += remaining.length;
      break;
    }
    for (const b of chunk(thisLevel, BATCH)) {
      const { error } = await sb.from('categories').upsert(b, { onConflict: 'id' });
      if (error) throw new Error(`categories.upsert: ${error.message}`);
    }
    for (const r of thisLevel) inDb.add(r.id);
    totalDone += thisLevel.length;
    remaining = remaining.filter(r => !inDb.has(r.id));
    process.stdout.write(`\r  categories: ${totalDone}/${allCatRows.length} (${remaining.length} remaining)`);
  }
  console.log();
}

// Decks
const decksRows = (state.decks ?? []).map(d => ({
  id: d.id, user_id: userId, name: d.name,
  description: d.description ?? null,
  color: d.color,
  category_ids: d.categoryIds ?? [],
  include_sub_categories: d.includeSubCategories !== false,
  created_at: iso(d.createdAt),
  updated_at: iso(d.updatedAt ?? d.createdAt),
}));
await upsertBatches(sb, 'decks', decksRows, 'id');

// Cards
const cardsRows = (state.cards ?? []).map(c => ({
  id: c.id, user_id: userId,
  deck_id: c.deckId ?? null,
  type: c.type,
  question: c.question,
  answer: c.answer ?? null,
  options: c.options ?? null,
  correct_indices: c.correctIndices ?? null,
  correct_boolean: c.type === 'boolean' ? c.correct : null,
  explanation: c.explanation ?? null,
  tags: c.tags ?? [],
  srs: c.srs ?? null,
  stats: c.stats ?? null,
  masechta: c.masechta ?? null,
  daf: c.daf ?? null,
  amud: c.amud ?? null,
  updated_at: iso(c.updatedAt),
}));
await upsertBatches(sb, 'cards', cardsRows, 'id');

// Goals
const goalsRows = (state.goals ?? []).map(g => ({
  id: g.id, user_id: userId, type: g.type, title: g.title, target: g.target,
  window_days: g.windowDays ?? null, deck_id: g.deckId ?? null, active: g.active,
  manual_done_dates: g.manualDoneDates ?? [],
  created_at: iso(g.createdAt), updated_at: iso(g.updatedAt ?? g.createdAt),
}));
await upsertBatches(sb, 'goals', goalsRows, 'id');

// Learning sessions
const sessionsRows = (state.learningSessions ?? []).map(s => ({
  id: s.id, user_id: userId, date: s.date, subject: s.subject,
  session_type: s.sessionType, quality: s.quality,
  duration_minutes: s.durationMinutes ?? null, note: s.note ?? null,
  next_review_date: s.nextReviewDate ?? null, review_number: s.reviewNumber,
  created_at: iso(s.createdAt), updated_at: iso(s.updatedAt ?? s.createdAt),
}));
await upsertBatches(sb, 'learning_sessions', sessionsRows, 'id');

// Review logs
const logsRows = (state.logs ?? []).map(l => ({
  id: l.id, user_id: userId, card_id: l.cardId, deck_id: l.deckId ?? null,
  at: iso(l.at), quality: l.quality, correct: l.correct, duration_ms: l.durationMs,
  updated_at: iso(l.updatedAt ?? l.at),
}));
await upsertBatches(sb, 'review_logs', logsRows, 'id');

// Shas reviews
const shasRows = (state.shasReviews ?? []).map(r => ({
  id: r.id, user_id: userId, masechta: r.masechta, daf: r.daf,
  amud: r.amud ?? 1, half: r.half ?? null, unit: r.unit ?? 'daf',
  review_index: r.reviewIndex ?? 1, due_date: r.dueDate, done_at: r.doneAt ?? null,
  is_initial: !!r.isInitial, note: r.note ?? null,
  updated_at: iso(r.updatedAt),
}));
await upsertBatches(sb, 'shas_reviews', shasRows, 'id');

// Day notes
const notesRows = (state.dayNotes ?? []).map(n => ({
  user_id: userId, date: n.date, text: n.text, updated_at: iso(n.updatedAt),
}));
await upsertBatches(sb, 'day_notes', notesRows, 'user_id,date');

// Card-deck links
const cardDecksRows = (state.cardDecks ?? []).map(x => ({
  user_id: userId, card_id: x.cardId, deck_id: x.deckId,
  sort_order: x.sortOrder ?? 0, updated_at: iso(x.updatedAt),
}));
await upsertBatches(sb, 'card_decks', cardDecksRows, 'card_id,deck_id');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log('✅ Upload complete!');
console.log(`   קטגוריות:   ${allCatRows.length}`);
console.log(`   כרטיסות:     ${cardsRows.length}`);
console.log(`   מערכות:      ${decksRows.length}`);
console.log(`   לוגים:        ${logsRows.length}`);
console.log(`   יעדים:        ${goalsRows.length}`);
console.log(`   חזרות ש"ס:   ${shasRows.length}`);
console.log('══════════════════════════════════════');
console.log('\n➡  עכשיו: פתח את האפליקציה → הפעל סנכרון → רענן');
