import { rm, mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const excludedDirs = new Set(['dist', 'backend', 'api', 'functions', 'node_modules', '.git', '.github']);
const excludedFiles = new Set(['package.json', 'package-lock.json', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc', 'cloudflare-build.mjs', 'README.md']);
const RELEASE_TAG = '20260925-profile-action-fix-v1';

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

async function hardenSellerDashboardBootstrap() {
  const indexPath = path.join(dist, 'index.html');
  let html = await readFile(indexPath, 'utf8');

  // Never block first paint on a third-party SDK request. supabase-config.js loads pinned fallbacks with timeouts.
  html = html.replace(/\s*<script\b[^>]*src=["']https:\/\/unpkg\.com\/@supabase\/supabase-js@2\.116\.0\/dist\/umd\/supabase\.js["'][^>]*><\/script>/i, '');

  // Keep the lightweight storage guard before the async auth bootstrap.
  if (!/seller-auth-guard\.js/i.test(html)) {
    html = html.replace(
      /(<script\b[^>]*src=["']supabase-config\.js[^"']*["'][^>]*><\/script>)/i,
      `<script src="seller-auth-guard.js?v=${RELEASE_TAG}"></script>\n  $1`
    );
  }

  // Force current startup and UI assets even when the source template carries an older query string.
  html = html.replace(/src=["']supabase-config\.js(?:\?[^"']*)?["']/i, `src="supabase-config.js?v=${RELEASE_TAG}"`);
  html = html.replace(/src=["']portal\.js(?:\?[^"']*)?["']/i, `src="portal.js?v=${RELEASE_TAG}"`);
  html = html.replace(/src=["']navigation-fix\.js(?:\?[^"']*)?["']/i, `src="navigation-fix.js?v=${RELEASE_TAG}"`);

  // supabase-config.js owns live-integration boot. Remove the legacy duplicate static loader from the page.
  html = html.replace(/\s*<script\b[^>]*src=["']seller-live-integration\.js(?:\?[^"']*)?["'][^>]*><\/script>/ig, '');

  // Load the shell fail-safe directly from HTML so a module failure can never leave a sidebar-only blank workspace.
  if (!/seller-shell-recovery\.css/i.test(html)) {
    html = html.replace(
      /(<link\b[^>]*href=["']portal\.css(?:\?[^"']*)?["'][^>]*>)/i,
      `$1\n  <link rel="stylesheet" href="seller-shell-recovery.css?v=${RELEASE_TAG}">`
    );
  }

  // Keep provider-unavailable verification actions responsive instead of leaving dead-looking disabled controls.
  if (!/seller-profile-actions-hotfix\.js/i.test(html)) {
    html = html.replace(
      /<\/body>/i,
      `  <script src="seller-profile-actions-hotfix.js?v=${RELEASE_TAG}"></script>\n</body>`
    );
  }

  await writeFile(indexPath, html, 'utf8');
}

async function hardenRuntimeAssetVersions() {
  const configPath = path.join(dist, 'supabase-config.js');
  let source = await readFile(configPath, 'utf8');
  source = source.replace(/seller-payout-provider\.js\?v=[^'"\s]+/g, `seller-payout-provider.js?v=${RELEASE_TAG}`);
  await writeFile(configPath, source, 'utf8');

  const portalPath = path.join(dist, 'portal.js');
  let portalSource = await readFile(portalPath, 'utf8');
  portalSource = portalSource.replace(/seller-finance-compliance-live\.js\?v=[^'"\s]+/g, `seller-finance-compliance-live.js?v=${RELEASE_TAG}`);
  await writeFile(portalPath, portalSource, 'utf8');
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
await hardenSellerDashboardBootstrap();
await hardenRuntimeAssetVersions();
await writeReleaseMetadata();
console.log('Cloudflare static build ready:', dist);
