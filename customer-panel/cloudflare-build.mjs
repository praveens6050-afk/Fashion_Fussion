import { rm, mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const excludedDirs = new Set(['dist', 'backend', 'api', 'functions', 'node_modules', '.git', '.github']);
const excludedFiles = new Set(['package.json', 'package-lock.json', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc', 'cloudflare-build.mjs', 'README.md']);

async function copyTree(src, dest, relative = '') {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (!relative && entry.isDirectory() && excludedDirs.has(entry.name)) continue;
    if (!relative && entry.isFile() && excludedFiles.has(entry.name)) continue;
    const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, nextRelative);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

async function readSources(files) {
  const chunks = [];
  for (const file of files) chunks.push(`/* ${file} */\n${await readFile(path.join(root, file), 'utf8')}`);
  return chunks;
}

async function buildHomepageBundles() {
  const cssFiles = [
    'csp-index.css',
    'csp-dynamic.css',
    'homepage-footer.css',
    'customer-responsive.css',
    'business-registration-trust.css',
    'support-chat.css',
    'homepage-desktop-premium.css'
  ];
  const css = await readSources(cssFiles);
  css.push(`/* Cloudflare homepage accessibility and layout-stability overrides */
:root{--muted:#475467}
.notice{color:#f8fafc!important}
.business p,.benefit span,.trust-item span{color:#475467!important}
.trust-item span{font-size:10px!important}
#productsGrid{min-height:360px;contain-intrinsic-size:auto 360px}
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.heart .heart-glyph{display:block;line-height:1;font-family:Arial,sans-serif;font-weight:700}
#ffSupportLauncher{right:max(18px,env(safe-area-inset-right))!important;bottom:max(76px,calc(env(safe-area-inset-bottom) + 70px))!important}
#ffSupportPanel{right:max(18px,env(safe-area-inset-right))!important;bottom:max(132px,calc(env(safe-area-inset-bottom) + 126px))!important}
@media(max-width:520px){#ffSupportLauncher{right:max(10px,env(safe-area-inset-right))!important;bottom:max(72px,calc(env(safe-area-inset-bottom) + 66px))!important}#ffSupportPanel{right:max(8px,env(safe-area-inset-right))!important;bottom:max(124px,calc(env(safe-area-inset-bottom) + 118px))!important}}
`);
  await writeFile(path.join(dist, 'homepage.bundle.css'), css.join('\n\n'), 'utf8');

  const jsFiles = [
    'customer-browser-compat.js',
    'variant-commerce.js',
    'catalog-cart-entry.js',
    'business-registration-trust.js',
    'support-chat-core.js',
    'csp-index.js'
  ];
  const js = [];
  for (const file of jsFiles) {
    let source = await readFile(path.join(root, file), 'utf8');
    if (file === 'business-registration-trust.js') {
      source = source.replaceAll('Fashion_Fussion', 'Fashion Fussion');
      source = source.replace(
        "function addCss(){if(document.querySelector('link[data-registration-trust]'))return;",
        "function addCss(){if(document.querySelector('link[data-homepage-bundle],link[data-registration-trust]'))return;"
      );
    }
    if (file === 'support-chat-core.js') {
      source = source.replace(
        "(function(){\n'use strict';\nif(!window.supabaseClient)return;\nconst supa=window.supabaseClient;",
        "(async function(){\n'use strict';\nlet supa=window.supabaseClient;\nif(!supa&&window.ffSupabaseReady){try{supa=await window.ffSupabaseReady}catch{return}}\nif(!supa)return;"
      );
    }
    js.push(`/* ${file} */\n${source}`);
  }
  await writeFile(path.join(dist, 'homepage.runtime.js'), js.join('\n\n'), 'utf8');
}

async function copySupabaseVendor() {
  const source = path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
  const vendorDir = path.join(dist, 'vendor');
  await mkdir(vendorDir, { recursive: true });
  try {
    await copyFile(source, path.join(vendorDir, 'supabase.js'));
  } catch (error) {
    throw new Error(`Local Supabase SDK is missing. Install dependencies before building. ${error.message}`);
  }
}

function localizeSupabase(html) {
  const externalSdk = /<script\b([^>]*?)src=(["'])https:\/\/(?:cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"']+|unpkg\.com\/@supabase\/supabase-js@[^"']+)\2([^>]*)><\/script>/gi;
  html = html.replace(externalSdk, (_match, before, _quote, after) => {
    const attrs = `${before} ${after}`
      .replace(/\s+(?:integrity|crossorigin|referrerpolicy)(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `<script${attrs ? ` ${attrs}` : ''} src="/vendor/supabase.js" data-supabase-sdk="local"></script>`;
  });

  if (/supabase-config\.js/i.test(html) && !/data-supabase-sdk=["']local["']/i.test(html)) {
    html = html.replace(
      /(<script\b[^>]*src=["'][^"']*supabase-config\.js[^"']*["'][^>]*><\/script>)/i,
      '<script src="/vendor/supabase.js" data-supabase-sdk="local"></script>\n  $1'
    );
  }
  return html;
}

function injectCanonicalHostGuard(html) {
  if (/data-canonical-host/i.test(html)) return html;
  return html.replace(/<head(\s[^>]*)?>/i, match => `${match}\n<script src="/canonical-host.js" data-canonical-host></script>`);
}

async function transformHtmlTree(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await transformHtmlTree(full);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      const original = await readFile(full, 'utf8');
      const transformed = localizeSupabase(injectCanonicalHostGuard(original));
      if (transformed !== original) await writeFile(full, transformed, 'utf8');
    }
  }
}

async function writeReleaseMetadata() {
  const gitSha = String(process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
  const branch = String(process.env.CF_PAGES_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
  await writeFile(
    path.join(dist, 'release.json'),
    JSON.stringify({ git_sha: gitSha || null, branch: branch || null, built_at: new Date().toISOString() }, null, 2) + '\n',
    'utf8'
  );
}

await rm(dist, { recursive: true, force: true });
await copyTree(root, dist);
await copySupabaseVendor();
await buildHomepageBundles();
await transformHtmlTree(dist);
await writeReleaseMetadata();
console.log('Cloudflare static build ready:', dist);
