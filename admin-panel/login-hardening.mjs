import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const loginPath = path.join(dist, 'login.html');
const canonicalLoginScript = path.join(dist, 'admin-login.js');
const assetsDir = path.join(dist, 'assets');

function digest(algorithm, buffer, encoding = 'base64') {
  return createHash(algorithm).update(buffer).digest(encoding);
}

let html = await readFile(loginPath, 'utf8');
const loginScriptBytes = await readFile(canonicalLoginScript);
const fingerprint = digest('sha256', loginScriptBytes, 'hex').slice(0, 16);
const loginSri = `sha384-${digest('sha384', loginScriptBytes)}`;
const fingerprintedName = `admin-login.${fingerprint}.js`;
const fingerprintedPath = path.join(assetsDir, fingerprintedName);
const fingerprintedUrl = `/assets/${fingerprintedName}`;

await mkdir(assetsDir, { recursive: true });
await copyFile(canonicalLoginScript, fingerprintedPath);

html = html
  .replace(/\s*<script\b[^>]*src=(['"])\/vendor\/supabase\.js\1[^>]*><\/script>\s*/gi, '\n  ')
  .replace(
    /<script\b[^>]*src=(['"])\/admin-login(?:\.[^"']+)?\.js\1[^>]*><\/script>/i,
    `<script defer src="${fingerprintedUrl}" integrity="${loginSri}"></script>`
  );

if (!html.includes(`src="${fingerprintedUrl}"`)) {
  throw new Error('Admin login fingerprinted asset was not injected.');
}
if (!html.includes(`integrity="${loginSri}"`)) {
  throw new Error('Admin login SRI was not derived from the fingerprinted asset.');
}
if (/src=(['"])\/vendor\/supabase\.js\1/i.test(html)) {
  throw new Error('Supabase must be loaded by the login runtime so load failures can be handled.');
}

await writeFile(loginPath, html, 'utf8');
console.log(`Admin login hardened with immutable fingerprinted asset: ${fingerprintedUrl}`);
