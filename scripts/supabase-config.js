// Supabase client config for Waterloo Quantum Club
//
// These values are safe to commit to a public repo:
//   - SUPABASE_URL is your project's public hostname.
//   - SUPABASE_ANON_KEY is the public anonymous JWT, designed to be exposed
//     in the browser. Row Level Security (set up in the SQL migration) is
//     what actually protects your data, never paste the service_role key.
//
// Replace the two values below with the URL + anon public key from
// Supabase dashboard → Project Settings → Data API.

const SUPABASE_URL      = 'https://bhlmbrgzmeoldfcbznfk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_d8pcsmb0cl9SgQAACAfucQ_xbZUQ7-e';

window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,       // keeps users logged in across visits
        autoRefreshToken: true,
        storage: window.localStorage,
        storageKey: 'qc-supabase-auth',
    },
});
