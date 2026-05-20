/**
 * migrate_old_cards.mjs
 * מעביר 13,348 כרטיסי רב-ברירה מהפרויקט הישן לפרויקט הנוכחי.
 *
 * פרויקט ישן: htsuoqvafayyffyxjhhh
 * פרויקט חדש: hgjfpwdugvvtrfhycejv
 *
 * הרצה: node scripts/migrate_old_cards.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// ─── פרויקט ישן ────────────────────────────────────────────────────────────
const OLD_URL = 'https://htsuoqvafayyffyxjhhh.supabase.co';
const OLD_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ';

// ─── פרויקט חדש ────────────────────────────────────────────────────────────
const NEW_URL = 'https://hgjfpwdugvvtrfhycejv.supabase.co';
const NEW_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDc0NTYsImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy451NO0N37rz7yjcpXYc';

const EMAIL = 'jj1212t@gmail.com';
const PASSWORD = '543211';

const PAGE_SIZE = 500; // שורות לכל קריאה מהפרויקט הישן
const BATCH_SIZE = 200; // שורות לכל insert לפרויקט החדש

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ─── כניסה לשני הפרויקטים ──────────────────────────────────────────────────
log('🔑 מתחבר לפרויקטים...');
const oldSb = createClient(OLD_URL, OLD_ANON);
const newSb = createClient(NEW_URL, NEW_ANON);

const { data: oldAuth, error: oldErr } = await oldSb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (oldErr) { console.error('❌ כניסה לפרויקט ישן נכשלה:', oldErr.message); process.exit(1); }
log('✅ פרויקט ישן — מחובר כ', oldAuth.user.id);

const { data: newAuth, error: newErr } = await newSb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (newErr) { console.error('❌ כניסה לפרויקט חדש נכשלה:', newErr.message); process.exit(1); }
const NEW_USER_ID = newAuth.user.id;
log('✅ פרויקט חדש — מחובר כ', NEW_USER_ID);

// ─── קריאת כל הכרטיסים מהפרויקט הישן (paginated) ─────────────────────────
log('📥 קורא כרטיסים מהפרויקט הישן...');
let allCards = [];
let page = 0;
while (true) {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, error } = await oldSb.from('cards').select('*').range(from, to).order('created_at');
  if (error) { console.error('❌ שגיאה בקריאת כרטיסים:', error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  allCards = allCards.concat(data);
  log(`  עמוד ${page + 1}: ${data.length} כרטיסים (סה"כ עד כה: ${allCards.length})`);
  if (data.length < PAGE_SIZE) break;
  page++;
}
log(`📊 סה"כ כרטיסים לייבוא: ${allCards.length}`);

// ─── בדיקת כמה כרטיסים כבר קיימים בפרויקט החדש ──────────────────────────
const { count: existingCount } = await newSb.from('cards').select('*', { count: 'exact', head: true });
log(`📊 כרטיסים קיימים בפרויקט חדש: ${existingCount}`);

// בדוק אם יש כרטיסים כפולים (לפי ID)
const existingIds = new Set();
if (existingCount > 0) {
  let p = 0;
  while (true) {
    const { data } = await newSb.from('cards').select('id').range(p * 1000, p * 1000 + 999);
    if (!data || data.length === 0) break;
    data.forEach(r => existingIds.add(r.id));
    if (data.length < 1000) break;
    p++;
  }
  log(`  נטענו ${existingIds.size} IDs קיימים`);
}

const newCards = allCards.filter(c => !existingIds.has(c.id));
log(`📊 כרטיסים חדשים לייבוא (לאחר ניפוי כפולים): ${newCards.length}`);

// Even if no new cards, still ensure card_decks exist
const cardsToLink = newCards.length > 0 ? newCards : allCards;
if (newCards.length === 0) {
  log('ℹ️  אין כרטיסים חדשים — בודק card_decks...');
}

// ─── יצירת deck "שאלות רב-ברירה · ש"ס" ──────────────────────────────────
const DECK_NAME = 'שאלות רב-ברירה · ש"ס';
log(`🗂 מחפש/יוצר deck "${DECK_NAME}"...`);

let deckId;
const { data: existingDecks } = await newSb.from('decks').select('id,name').eq('name', DECK_NAME);
if (existingDecks && existingDecks.length > 0) {
  deckId = existingDecks[0].id;
  log(`  deck קיים: ${deckId}`);
} else {
  deckId = randomUUID();
  const { error: deckErr } = await newSb.from('decks').insert({
    id: deckId,
    user_id: NEW_USER_ID,
    name: DECK_NAME,
    description: 'שאלות רב-ברירה מכל הש"ס — יובאו מפרויקט קודם',
    color: 'blue',
    category_ids: [],
    include_sub_categories: true,
  });
  if (deckErr) { console.error('❌ שגיאה ביצירת deck:', deckErr.message); process.exit(1); }
  log(`  deck נוצר: ${deckId}`);
}

// ─── ייבוא כרטיסים לפרויקט החדש ─────────────────────────────────────────
const now = new Date().toISOString();
if (newCards.length > 0) {
log(`⬆️  מייבא ${newCards.length} כרטיסים ב-chunks של ${BATCH_SIZE}...`);
let imported = 0;
let failed = 0;

// חלוקה ל-chunks
for (let i = 0; i < newCards.length; i += BATCH_SIZE) {
  const chunk = newCards.slice(i, i + BATCH_SIZE);
  const rows = chunk.map(c => ({
    id: c.id,
    user_id: NEW_USER_ID,
    deck_id: null, // ייכנסו ל-deck דרך card_decks
    type: c.type,
    question: c.question,
    answer: c.answer ?? null,
    options: c.options ?? null,
    correct_indices: c.correct_indices ?? null,
    correct_boolean: c.correct_boolean ?? null,
    explanation: c.explanation ?? null,
    tags: c.tags ?? [],
    srs: c.srs ?? null,
    stats: c.stats ?? null,
    masechta: c.masechta ?? null,
    daf: c.daf ?? null,
    amud: c.amud ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at ?? now,
    sort_order: c.sort_order ?? 0,
  }));

  const { error } = await newSb.from('cards').upsert(rows, { onConflict: 'id' });
  if (error) {
    console.error(`❌ שגיאה בייבוא chunk ${i}-${i + chunk.length}:`, error.message);
    failed += chunk.length;
  } else {
    imported += chunk.length;
  }

  if ((i / BATCH_SIZE) % 10 === 0 || i + BATCH_SIZE >= newCards.length) {
    log(`  progress: ${imported + failed} / ${newCards.length} (✅ ${imported}, ❌ ${failed})`);
  }
}
} // end if newCards.length > 0

// ─── יצירת card_decks entries ────────────────────────────────────────────
log(`🔗 יוצר ${cardsToLink.length} קשרי card_decks...`);
let cdImported = 0;
let cdFailed = 0;
const nowIso = now;

for (let i = 0; i < cardsToLink.length; i += BATCH_SIZE) {
  const chunk = cardsToLink.slice(i, i + BATCH_SIZE);
  const rows = chunk.map((c, idx) => ({
    card_id: c.id,
    deck_id: deckId,
    user_id: NEW_USER_ID,
    sort_order: i + idx,
    updated_at: nowIso,
  }));

  const { error } = await newSb.from('card_decks').upsert(rows, { onConflict: 'card_id,deck_id' });
  if (error) {
    console.error(`❌ שגיאה ב-card_decks chunk ${i}:`, error.message);
    cdFailed += chunk.length;
  } else {
    cdImported += chunk.length;
  }
}

log(`🔗 card_decks: ✅ ${cdImported} הצלחות, ❌ ${cdFailed} כשלונות`);

// ─── אימות סופי ──────────────────────────────────────────────────────────
const { count: finalCards } = await newSb.from('cards').select('*', { count: 'exact', head: true });
const { count: finalDecks } = await newSb.from('decks').select('*', { count: 'exact', head: true });
const { count: finalCd } = await newSb.from('card_decks').select('*', { count: 'exact', head: true });

log('');
log('═══════════════════════════════════════');
log('✅ הייבוא הסתיים!');
log(`  כרטיסים: ${finalCards}`);
log(`  decks: ${finalDecks}`);
log(`  card_decks: ${finalCd}`);
log(`  deck ID: ${deckId}`);
log('═══════════════════════════════════════');
log('כעת רענן את האפליקציה — הכרטיסים יסונכרנו אוטומטית.');
