import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const loginPath = path.join(dist, 'login.html');
const canonicalLoginScript = path.join(dist, 'admin-login.js');
const canonicalSupabaseScript = path.join(dist, 'vendor', 'supabase.js');
const assetsDir = path.join(dist, 'assets');

function digest(algorithm, buffer, encoding = 'base64') {
  return createHash(algorithm).update(buffer).digest(encoding);
}

function fingerprintedAsset(prefix, bytes) {
  const fingerprint = digest('sha256', bytes, 'hex').slice(0, 16);
  return {
    name: `${prefix}.${fingerprint}.js`,
    sri: `sha384-${digest('sha384', bytes)}`
  };
}

let html = await readFile(loginPath, 'utf8');
const [loginScriptBytes, supabaseScriptBytes] = await Promise.all([
  readFile(canonicalLoginScript),
  readFile(canonicalSupabaseScript)
]);
const loginAsset = fingerprintedAsset('admin-login', loginScriptBytes);
const supabaseAsset = fingerprintedAsset('supabase', supabaseScriptBytes);
const loginUrl = `/assets/${loginAsset.name}`;
const supabaseUrl = `/assets/${supabaseAsset.name}`;

await mkdir(assetsDir, { recursive: true });
await Promise.all([
  copyFile(canonicalLoginScript, path.join(assetsDir, loginAsset.name)),
  copyFile(canonicalSupabaseScript, path.join(assetsDir, supabaseAsset.name))
]);

html = html
  .replace(
    /<script\b[^>]*src=(['"])\/vendor\/supabase\.js\1[^>]*><\/script>/i,
    `<script defer src="${supabaseUrl}" data-supabase-sdk="local" integrity="${supabaseAsset.sri}" crossorigin="anonymous"></script>`
  )
  .replace(
    /<script\b[^>]*src=(['"])\/admin-login(?:\.[^"']+)?\.js\1[^>]*><\/script>/i,
    `<script defer src="${loginUrl}" integrity="${loginAsset.sri}" crossorigin="anonymous"></script>`
  );

const required = [
  `src="${supabaseUrl}"`,
  `integrity="${supabaseAsset.sri}"`,
  `src="${loginUrl}"`,
  `integrity="${loginAsset.sri}"`
];
for (const marker of required) {
  if (!html.includes(marker)) throw new Error(`Admin login hardening marker missing: ${marker}`);
}
const supabaseIndex = html.indexOf(`src="${supabaseUrl}"`);
const loginIndex = html.indexOf(`src="${loginUrl}"`);
if (supabaseIndex < 0 || loginIndex < 0 || supabaseIndex > loginIndex) {
  throw new Error('Supabase SDK must be deferred before the admin application script.');
}

await writeFile(loginPath, html, 'utf8');
console.log(`Admin login hardened with ordered fingerprinted assets: ${supabaseUrl} -> ${loginUrl}`);
