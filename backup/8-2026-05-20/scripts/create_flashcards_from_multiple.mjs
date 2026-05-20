/**
 * create_flashcards_from_multiple.mjs
 *
 * Creates flashcard versions from each multiple-choice card:
 *   - question stays the same
 *   - answer = options[correct_indices[0]]  (the correct option text)
 *   - type = "flashcard", options = null, correct_indices = null
 *
 * Run: node scripts/create_flashcards_from_multiple.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const NEW_URL  = 'https://hgjfpwdugvvtrfhycejv.supabase.co';
const NEW_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnamZwd2R1Z3Z2dHJmaHljZWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMDc0NTYsImV4cCI6MjA5NDY4MzQ1Nn0.FQndqo2DC3GcTdYtQVUI_DHy451NO0N37rz7yjcpXYc';
const NEW_USER_ID = '3e108a41-8da6-4f36-98cd-2b38916708b8';
const FLASHCARD_DECK_ID = 'b5e2f1a3-7c9d-4e8f-a012-3b4c5d6e7f8a'; // fixed ID so re-runs are idempotent
const FLASHCARD_DECK_NAME = 'שאלות כרטיסיה · ש"ס';

const sb = createClient(NEW_URL, NEW_ANON);

async function main() {
  // 1. Sign in
  const { error: authErr } = await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });
  if (authErr) { console.error('Auth failed:', authErr.message); process.exit(1); }
  console.log('✅ Authenticated');

  // 2. Create the flashcard deck (upsert so re-runs are safe)
  const { error: deckErr } = await sb.from('decks').upsert(
    { id: FLASHCARD_DECK_ID, user_id: NEW_USER_ID, name: FLASHCARD_DECK_NAME, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'id' }
  );
  if (deckErr) { console.error('Deck upsert failed:', deckErr.message); process.exit(1); }
  console.log(`✅ Deck "${FLASHCARD_DECK_NAME}" ready (id: ${FLASHCARD_DECK_ID})`);

  // 3. Read all multiple-choice cards (paginated)
  const PAGE = 500;
  let offset = 0;
  const allMultiple = [];
  while (true) {
    const { data, error } = await sb.from('cards')
      .select('id,question,options,correct_indices,tags,srs,stats,masechta,daf,amud,created_at')
      .eq('type', 'multiple')
      .eq('user_id', NEW_USER_ID)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error('Read error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    allMultiple.push(...data);
    offset += PAGE;
    if (data.length < PAGE) break;
  }
  console.log(`📖 Read ${allMultiple.length} multiple-choice cards`);

  // 4. Check how many flashcards already exist (to skip if re-run)
  const { count: existingFlash } = await sb.from('cards')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'flashcard')
    .eq('user_id', NEW_USER_ID);
  console.log(`ℹ️  Existing flashcards in DB: ${existingFlash}`);

  if (existingFlash >= allMultiple.length) {
    console.log('✅ Flashcards already exist — skipping card creation');
  } else {
    // 5. Build flashcard rows
    const now = new Date().toISOString();
    const freshSrs = { due: now, interval: 1, easeFactor: 2.5, repetitions: 0, lastReviewedAt: null };
    const freshStats = { correct: 0, incorrect: 0, totalReviews: 0 };

    const flashcards = allMultiple.map(card => {
      const correctIdx = Array.isArray(card.correct_indices) ? card.correct_indices[0] : 0;
      const correctAnswer = Array.isArray(card.options) ? (card.options[correctIdx] ?? '') : '';
      return {
        id: randomUUID(),
        user_id: NEW_USER_ID,
        deck_id: FLASHCARD_DECK_ID,  // assigned to deck so question uniqueness doesn't conflict with multiple-choice (deck_id=null)
        type: 'flashcard',
        question: card.question,
        answer: correctAnswer,
        options: null,
        correct_indices: null,
        correct_boolean: null,
        explanation: null,
        tags: card.tags,
        srs: freshSrs,
        stats: freshStats,
        masechta: card.masechta,
        daf: card.daf,
        amud: card.amud,
        created_at: now,
        updated_at: now,
        sort_order: 0,
      };
    });

    // 6. Insert in batches of 500
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < flashcards.length; i += BATCH) {
      const batch = flashcards.slice(i, i + BATCH);
      const { error: insErr } = await sb.from('cards').insert(batch);
      if (insErr) { console.error(`Insert error at offset ${i}:`, insErr.message); process.exit(1); }
      inserted += batch.length;
      process.stdout.write(`\r  inserted ${inserted}/${flashcards.length}...`);
    }
    console.log(`\n✅ Inserted ${inserted} flashcards`);
  }

  // 7. Create card_decks entries linking flashcards to the flashcard deck
  // Read the flashcard card IDs
  const flashIds = [];
  let fOffset = 0;
  while (true) {
    const { data, error } = await sb.from('cards')
      .select('id')
      .eq('type', 'flashcard')
      .eq('user_id', NEW_USER_ID)
      .range(fOffset, fOffset + PAGE - 1);
    if (error) { console.error('Read flashcard IDs error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    flashIds.push(...data.map(c => c.id));
    fOffset += PAGE;
    if (data.length < PAGE) break;
  }
  console.log(`📖 Read ${flashIds.length} flashcard IDs`);

  // Check existing card_decks for this deck
  const { count: existingCd } = await sb.from('card_decks')
    .select('*', { count: 'exact', head: true })
    .eq('deck_id', FLASHCARD_DECK_ID)
    .eq('user_id', NEW_USER_ID);
  console.log(`ℹ️  Existing card_decks for flashcard deck: ${existingCd}`);

  if (existingCd >= flashIds.length) {
    console.log('✅ card_decks already set up — skipping');
  } else {
    const now2 = new Date().toISOString();
    const cdRows = flashIds.map(id => ({
      id: randomUUID(),
      card_id: id,
      deck_id: FLASHCARD_DECK_ID,
      user_id: NEW_USER_ID,
      sort_order: 0,
      created_at: now2,
      updated_at: now2,
    }));
    let cdInserted = 0;
    const BATCH = 500;
    for (let i = 0; i < cdRows.length; i += BATCH) {
      const batch = cdRows.slice(i, i + BATCH);
      const { error: cdErr } = await sb.from('card_decks').insert(batch);
      if (cdErr) { console.error(`card_decks insert error at offset ${i}:`, cdErr.message); process.exit(1); }
      cdInserted += batch.length;
      process.stdout.write(`\r  card_decks: ${cdInserted}/${cdRows.length}...`);
    }
    console.log(`\n✅ Created ${cdInserted} card_decks entries`);
  }

  // 8. Final count
  const { count: finalFlash } = await sb.from('cards').select('*', { count: 'exact', head: true }).eq('type', 'flashcard').eq('user_id', NEW_USER_ID);
  const { count: finalMulti } = await sb.from('cards').select('*', { count: 'exact', head: true }).eq('type', 'multiple').eq('user_id', NEW_USER_ID);
  console.log(`\n📊 Final DB state:`);
  console.log(`   multiple:  ${finalMulti}`);
  console.log(`   flashcard: ${finalFlash}`);
  console.log(`   total:     ${(finalMulti ?? 0) + (finalFlash ?? 0)}`);
  console.log('\n✅ Done! Force a full sync in the app to see both sets.');
}

main().catch(e => { console.error(e); process.exit(1); });
