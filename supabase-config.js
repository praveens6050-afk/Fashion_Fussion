const SUPABASE_URL = 'https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

(function loadCustomerFeatures(){
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const customerPages = new Set(['index.html','login.html','signup.html','account.html']);
  if (!customerPages.has(page)) return;
  if (document.querySelector('script[data-customer-features]')) return;
  const script = document.createElement('script');
  script.src = 'customer-features.js';
  script.defer = true;
  script.dataset.customerFeatures = 'true';
  document.head.appendChild(script);
})();
