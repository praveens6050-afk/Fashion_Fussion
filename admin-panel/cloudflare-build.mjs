import { rm, mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const excludedDirs = new Set(['dist', 'backend', 'api', 'functions', 'node_modules', '.git', '.github']);
const excludedFiles = new Set(['vercel.json', 'package.json', 'package-lock.json', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc', 'cloudflare-build.mjs', 'README.md']);

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
      '<script defer src="/vendor/supabase.js" data-supabase-sdk="local"></script>\n  $1'
    );
  }
  return html;
}

async function transformHtmlTree(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await transformHtmlTree(full);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      const original = await readFile(full, 'utf8');
      const transformed = localizeSupabase(original);
      if (transformed !== original) await writeFile(full, transformed, 'utf8');
    }
  }
}

await rm(dist, { recursive: true, force: true });
await copyTree(root, dist);
await copySupabaseVendor();
await transformHtmlTree(dist);
console.log('Cloudflare static build ready:', dist);
