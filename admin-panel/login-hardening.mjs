import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const loginPath = path.join(dist, 'login.html');

function sri(buffer) {
  return `sha384-${createHash('sha384').update(buffer).digest('base64')}`;
}

let html = await readFile(loginPath, 'utf8');

html = html
  .replace('--line:#d9dee8', '--line:#667085')
  .replace(
    '.password-control:focus-within{border-color:var(--focus)}',
    '.password-control:focus-within{border-color:var(--focus)}.password-control:focus-within .password-toggle{border-left-color:var(--focus)}'
  )
  .replace(
    '<div id="banner" class="banner" aria-atomic="true"></div>',
    '<div id="banner" class="banner" role="alert" aria-live="assertive" aria-atomic="true"></div>'
  )
  .replace(
    '<input id="remember" name="remember" type="checkbox" autocomplete="off">Remember me',
    '<input id="remember" name="remember" type="checkbox">Remember me'
  )
  .replace(
    '<div class="brand-logo" aria-label="Fashion Fussion" translate="no" spellcheck="false" data-brand-name="true">Fashion Fussion</div>',
    '<h2 class="brand-logo" aria-label="Fashion Fussion" translate="no" spellcheck="false" data-brand-name="true">Fashion Fussion</h2>'
  );

const vendorPath = path.join(dist, 'vendor', 'supabase.js');
const loginScriptPath = path.join(dist, 'admin-login.20260923f.js');
const [vendorBytes, loginScriptBytes] = await Promise.all([
  readFile(vendorPath),
  readFile(loginScriptPath)
]);
const vendorSri = sri(vendorBytes);
const loginSri = sri(loginScriptBytes);

html = html
  .replace(
    '<script defer src="/vendor/supabase.js" data-supabase-sdk="local"></script>',
    `<script defer src="/vendor/supabase.js" data-supabase-sdk="local" integrity="${vendorSri}"></script>`
  )
  .replace(
    '<script defer src="/admin-login.20260923f.js"></script>',
    `<script defer src="/admin-login.20260923f.js" integrity="${loginSri}"></script>`
  );

const required = [
  '--line:#667085',
  'role="alert" aria-live="assertive"',
  'id="remember" name="remember" type="checkbox">Remember me',
  '.password-control:focus-within .password-toggle{border-left-color:var(--focus)}',
  '<h2 class="brand-logo"',
  'src="/vendor/supabase.js" data-supabase-sdk="local" integrity="sha384-',
  'src="/admin-login.20260923f.js" integrity="sha384-'
];
for (const marker of required) {
  if (!html.includes(marker)) throw new Error(`Admin login hardening marker missing: ${marker}`);
}

await writeFile(loginPath, html, 'utf8');
console.log('Admin login hardening applied with build-derived SRI hashes.');
