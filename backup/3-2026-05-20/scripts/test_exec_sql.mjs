import { createClient } from '@supabase/supabase-js';

const URL = 'https://htsuoqvafayyffyxjhhh.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ';

const sb = createClient(URL, ANON);

const { data, error } = await sb.auth.signInWithPassword({
  email: 'jj1212t@gmail.com',
  password: '543211'
});

if (error) {
  console.log('❌ Login failed:', error.message);
  process.exit(1);
}

console.log('✅ Logged in as:', data.user.email);
const token = data.session.access_token;

// Try exec_sql RPC directly
const res = await fetch(URL + '/rest/v1/rpc/exec_sql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
    'apikey': ANON
  },
  body: JSON.stringify({ query: 'SELECT now();' })
});

console.log('exec_sql status:', res.status);
const body = await res.text();
console.log('Response:', body.slice(0, 300));
