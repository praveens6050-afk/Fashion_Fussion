const SUPABASE_URL = 'https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
