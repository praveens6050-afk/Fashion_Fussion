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

async function makeSellerDashboardSdkNonBlocking() {
  const indexPath = path.join(dist, 'index.html');
  let html = await readFile(indexPath, 'utf8');
  html = html.replace(/\s*<script\b[^>]*src=["']https:\/\/unpkg\.com\/@supabase\/supabase-js@2\.116\.0\/dist\/umd\/supabase\.js["'][^>]*><\/script>/i, '');
  await writeFile(indexPath, html, 'utf8');
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
await makeSellerDashboardSdkNonBlocking();
await writeReleaseMetadata();
console.log('Cloudflare static build ready:', dist);