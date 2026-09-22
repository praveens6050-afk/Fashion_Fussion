import { rm, mkdir, readdir, copyFile } from 'node:fs/promises';
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

await rm(dist, { recursive: true, force: true });
await copyTree(root, dist);
console.log('Cloudflare static build ready:', dist);
