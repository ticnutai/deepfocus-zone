import { createClient } from '@supabase/supabase-js';

const OLD_URL = 'https://htsuoqvafayyffyxjhhh.supabase.co';
const OLD_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ';
const old = createClient(OLD_URL, OLD_ANON);
await old.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });

// Check if the IDB flashcard question also appears in old project
const testQuestion = 'חטאת ששחטה בדרום האם לוקה על זה או לא? (לו:)';
const { data: match } = await old.from('cards').select('id,type,question').ilike('question', `%חטאת ששחטה%`).limit(3);
console.log('question match in old project:', JSON.stringify(match));

// Sample first 3 questions from old project
const { data: sample } = await old.from('cards').select('question').limit(3);
console.log('old project sample questions:', JSON.stringify(sample?.map(c => c.question)));

