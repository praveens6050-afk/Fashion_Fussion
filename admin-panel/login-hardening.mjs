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
    /<script\s+defer\s+src="\/vendor\/supabase\.js"\s+data-supabase-sdk="local"(?:\s+integrity="[^"]+")?><\/script>/,
    `<script defer src="/vendor/supabase.js" data-supabase-sdk="local" integrity="${vendorSri}"></script>`
  )
  .replace(
    /<script\s+defer\s+src="\/admin-login\.20260923f\.js"(?:\s+integrity="[^"]+")?><\/script>/,
    `<script defer src="/admin-login.20260923f.js" integrity="${loginSri}"></script>`
  );

const required = [
  '--line:#667085',
  'role="status" aria-live="polite" aria-atomic="true"',
  '<label class="remember"><input id="remember" name="remember" type="checkbox">Remember me</label>',
  '.password-control:focus-within{border-color:var(--focus);outline:3px solid var(--focus);outline-offset:2px}',
  '.password-control:focus-within .password-toggle{border-left-color:var(--focus)}',
  '<a class="brand-logo" href="https://fashionfussion.in/"',
  '.brand .brand-logo{display:none}',
  'class="external-mark" aria-hidden="true"><svg',
  'src="/vendor/supabase.js" data-supabase-sdk="local" integrity="sha384-',
  'src="/admin-login.20260923f.js" integrity="sha384-'
];
for (const marker of required) {
  if (!html.includes(marker)) throw new Error(`Admin login hardening marker missing: ${marker}`);
}

const forbidden = [
  '<h2 class="brand-logo"',
  'font-weight:650',
  'font-weight:750',
  'font-weight:850',
  '>↗</span>',
  'autocomplete="off">Remember me'
];
for (const marker of forbidden) {
  if (html.includes(marker)) throw new Error(`Admin login regression detected: ${marker}`);
}

await writeFile(loginPath, html, 'utf8');
console.log('Admin login hardening verified; only build-derived SRI hashes were injected.');
