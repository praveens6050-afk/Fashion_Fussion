from pathlib import Path
import re

INDEX_PATH = Path("index.html")
CONFIG_PATH = Path("supabase-config.js")

index = INDEX_PATH.read_text(encoding="utf-8")
original_index = index

# 1) Make the approved storefront copy canonical in source.
logo_pattern = re.compile(
    r'(<a\s+href="#top"\s+class="logo"\s*>\s*)Fashion\s*<small>\s*_FUSSION\s*</small>\s*(</a>)',
    re.S,
)
index, logo_count = logo_pattern.subn(r"\1Fashion_Fussion\n      \2", index, count=1)
if logo_count not in (0, 1):
    raise RuntimeError(f"Unexpected storefront logo matches: {logo_count}")

index = index.replace("Fashion_FUSSION", "Fashion_Fussion")
index = index.replace("_FUSSION", "_Fussion")
index = index.replace("₹599", "₹299")
index = index.replace("9am–7pm", "24×7")
index = index.replace("9am-7pm", "24×7")
index = index.replace("Same-week dispatch", "Dispatch within 3 days")

old_threshold = """    const DELIVERY_THRESHOLD =\n      599;"""
new_threshold = """    const DELIVERY_THRESHOLD =\n      299;"""
if old_threshold in index:
    index = index.replace(old_threshold, new_threshold, 1)

# 2) Give the hero a source-level fallback so it is never a zero-height empty box.
stall_img_css = """    .stall-grid img{\n      border-radius:4px;\n      aspect-ratio:1/1;\n      object-fit:cover;\n      border:1px solid var(--line);\n      background:#eee;\n    }\n"""
placeholder_css = """

    .stall-placeholder{
      border-radius:4px;
      aspect-ratio:1/1;
      border:1px solid var(--line);
      background:var(--paper-dim);
      color:var(--ink-soft);
      display:grid;
      place-items:center;
      text-align:center;
      padding:12px;
      font-size:12px;
      line-height:1.35;
    }

    .stall-placeholder strong{
      font-family:var(--serif);
      color:var(--indigo);
      font-size:14px;
    }
"""
if ".stall-placeholder{" not in index:
    if stall_img_css not in index:
        raise RuntimeError("Could not locate .stall-grid img CSS block")
    index = index.replace(stall_img_css, stall_img_css + placeholder_css, 1)

empty_hero = """          <div\n            class="stall-grid"\n            id="heroThumbs"\n          ></div>"""
source_fallback = """          <div
            class="stall-grid"
            id="heroThumbs"
          >
            <div class="stall-placeholder" aria-hidden="true"><strong>Fashion_Fussion</strong></div>
            <div class="stall-placeholder" aria-hidden="true"><strong>Fashion_Fussion</strong></div>
            <div class="stall-placeholder" aria-hidden="true"><strong>Fashion_Fussion</strong></div>
            <div class="stall-placeholder" aria-hidden="true"><strong>Fashion_Fussion</strong></div>
          </div>"""
if empty_hero in index:
    index = index.replace(empty_hero, source_fallback, 1)

# 3) Always render four hero slots; fill missing product images with the local SVG placeholder.
hero_function = """    function renderHeroProducts(){

      const container =
        document.getElementById(
          "heroThumbs"
        );


      if(!container){

        return;

      }


      const picks =
        PRODUCTS
          .filter(
            product =>
              String(
                product?.image_url ||
                ""
              ).trim()
          )
          .slice(
            0,
            4
          );


      const slots =
        picks.map(
          product => `

            <img
              src="${escapeHtml(
                product.image_url
              )}"
              alt="${escapeHtml(
                product.name ||
                "Fashion_Fussion product"
              )}"
              decoding="async"
              onerror="
                this.onerror=null;
                this.src='${placeholderImage()}'
              "
            >

          `
        );


      while(
        slots.length < 4
      ){

        slots.push(`

          <img
            src="${placeholderImage()}"
            alt="Fashion_Fussion"
            decoding="async"
          >

        `);

      }


      container.innerHTML =
        slots.join("");

    }
"""
hero_pattern = re.compile(
    r"    function renderHeroProducts\(\)\{.*?\n    \}\n\n\n    /\* =========================================================\n       CATEGORIES",
    re.S,
)
if "slots.length < 4" not in index:
    index, hero_count = hero_pattern.subn(
        hero_function + "\n\n    /* =========================================================\n       CATEGORIES",
        index,
        count=1,
    )
    if hero_count != 1:
        raise RuntimeError(f"Could not safely replace renderHeroProducts (matches={hero_count})")

# 4) Start product loading immediately instead of blocking it behind auth/session work.
initialize_function = """    async function initializeStore(){

      loadCart();

      setupTicker();

      renderReviews();

      /* Paint a stable hero immediately, before any network request finishes. */
      renderHeroProducts();

      updateCartUI();


      /*
        Product loading and account/session lookup are independent.
        Run them concurrently so a slow auth lookup can never hold the
        storefront product/hero render hostage.
      */
      const productLoad =
        loadProducts();

      const accountLoad =
        updateAccountLink();

      await Promise.allSettled([
        productLoad,
        accountLoad
      ]);


      /* Resume checkout after login without auto-opening payment. */
      const checkoutResume =
        new URLSearchParams(window.location.search).get("checkout") === "1";

      if(
        checkoutResume &&
        Object.keys(cart).length
      ){

        setTimeout(
          function(){

            openCart();

            window.history.replaceState(
              {},
              document.title,
              "index.html"
            );

          },
          300
        );

      }

    }
"""
initialize_pattern = re.compile(
    r"    async function initializeStore\(\)\{.*?\n    \}\n\n\n    /\* =========================================================\n       AUTH STATE CHANGE",
    re.S,
)
if "Product loading and account/session lookup are independent." not in index:
    index, initialize_count = initialize_pattern.subn(
        initialize_function + "\n\n    /* =========================================================\n       AUTH STATE CHANGE",
        index,
        count=1,
    )
    if initialize_count != 1:
        raise RuntimeError(f"Could not safely replace initializeStore (matches={initialize_count})")

# 5) Make startup idempotent and safe even if the script executes after DOMContentLoaded.
old_start_pattern = re.compile(
    r"    /\* =========================================================\n       START\n       ========================================================= \*/\n\n    document\.addEventListener\(\n      \"DOMContentLoaded\",\n      function\(\)\{\n\n        initializeStore\(\);\n\n      \}\n    \);",
    re.S,
)
new_start = """    /* =========================================================
       START
       ========================================================= */

    let storeInitializationStarted =
      false;


    function startStore(){

      if(storeInitializationStarted){

        return;

      }


      storeInitializationStarted =
        true;


      initializeStore().catch(
        function(error){

          console.error(
            "Store initialization error:",
            error
          );

          /* Keep the hero visually complete even on an unexpected init error. */
          renderHeroProducts();

        }
      );

    }


    if(
      document.readyState ===
      "loading"
    ){

      document.addEventListener(
        "DOMContentLoaded",
        startStore,
        {
          once:true
        }
      );

    }else{

      startStore();

    }"""
if "storeInitializationStarted" not in index:
    index, start_count = old_start_pattern.subn(new_start, index, count=1)
    if start_count != 1:
        raise RuntimeError(f"Could not safely replace storefront START block (matches={start_count})")

# 6) Remove DOM text-patching from Supabase bootstrap; retain only functional page modules.
canonical_config = """const SUPABASE_URL = 'https://gmdevprqtvoshbbytsxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(function loadPageScripts(){
  'use strict';

  function add(src, marker){
    if(document.querySelector('script[' + marker + ']')) return;

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.setAttribute(marker, 'true');
    document.head.appendChild(script);
  }

  function start(){
    const page = location.pathname.split('/').pop() || 'index.html';

    if(page === 'account.html'){
      add('account-role-guard.js?v=1', 'data-account-role-guard');
      add('support-chat.js?v=7', 'data-support-chat');
      add('customer-addresses.js?v=2', 'data-customer-addresses');
      add('account-dashboard.js?v=5', 'data-account-dashboard');
      add('order-tracking.js?v=3', 'data-order-tracking');
    }

    if(page === 'index.html'){
      /* Storefront copy/pricing are canonical in index.html; no DOM text patching. */
      add('support-chat.js?v=7', 'data-support-chat');
      add('checkout-address.js?v=3', 'data-checkout-address');
      add('customer-account-menu.js?v=6', 'data-customer-account-menu');
      add('wishlist-storefront.js?v=1', 'data-wishlist-storefront');
      add('cart-navigation.js?v=1', 'data-cart-navigation');
    }

    if(page === 'admin.html'){
      add('admin-branding.js?v=1', 'data-admin-branding');
      add('admin-store-link.js?v=2', 'data-admin-store-link');
      add('admin-notifications.js?v=1', 'data-admin-notifications');
      add('support-chat.js?v=7', 'data-support-chat');
      add('admin-orders.js?v=1', 'data-admin-orders');
      add('admin-promotions.js?v=1', 'data-admin-promotions');
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start, { once:true });
  }else{
    start();
  }
})();
"""

# Guard against unexpectedly editing a different Supabase project bootstrap.
current_config = CONFIG_PATH.read_text(encoding="utf-8")
if "gmdevprqtvoshbbytsxf.supabase.co" not in current_config:
    raise RuntimeError("Unexpected Supabase project in supabase-config.js; refusing to rewrite")

# Final source invariants.
for forbidden in ("₹599", "_FUSSION", "9am–7pm", "9am-7pm", "Same-week dispatch"):
    if forbidden in index:
        raise RuntimeError(f"Old storefront source value remains: {forbidden}")

required = (
    "Fashion_Fussion",
    "₹299",
    "24×7",
    "Dispatch within 3 days",
    "slots.length < 4",
    "Promise.allSettled",
    "storeInitializationStarted",
    "const DELIVERY_THRESHOLD =\n      299;",
)
for item in required:
    if item not in index:
        raise RuntimeError(f"Required storefront invariant missing: {item}")

if index.count('class="stall-placeholder"') < 4:
    raise RuntimeError("Source-level hero fallback does not contain four placeholder slots")

for forbidden in (
    "forceStorefrontCopy",
    "MutationObserver",
    "storefront-branding.js",
    "storefront-consistency.js",
):
    if forbidden in canonical_config:
        raise RuntimeError(f"Runtime patch dependency remains in canonical config: {forbidden}")

if index != original_index:
    INDEX_PATH.write_text(index, encoding="utf-8")

if current_config != canonical_config:
    CONFIG_PATH.write_text(canonical_config, encoding="utf-8")

print("Storefront stability fix applied and invariants verified.")
