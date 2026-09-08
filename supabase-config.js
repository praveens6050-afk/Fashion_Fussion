const SUPABASE_URL = 'https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(function loadSupportChat(){
  function start(){
    const page = window.location.pathname.split('/').pop() || 'index.html';
    const supportedPages = new Set(['index.html','account.html','admin.html']);
    if (!supportedPages.has(page)) return;
    if (document.querySelector('script[data-support-chat]')) return;
    const script = document.createElement('script');
    script.src = 'support-chat.js?v=3';
    script.defer = false;
    script.dataset.supportChat = 'true';
    document.head.appendChild(script);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
