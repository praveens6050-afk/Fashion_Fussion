import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const skipDirs = new Set(['.git', 'node_modules', 'dist']);
const textExt = new Set(['.js','.mjs','.cjs','.json','.yml','.yaml','.env','.txt','.md','.html','.css']);
const findings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && (skipDirs.has(entry.name) || entry.name.startsWith('.cf-functions'))) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    const ext = path.extname(entry.name).toLowerCase();
    if (!textExt.has(ext) && !entry.name.startsWith('.env')) continue;
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const serviceRoleJwt = /(?:SUPABASE_SERVICE_ROLE_KEY|service_role)[^\n]{0,160}(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/i.exec(line);
      const secretKey = /(sb_secret_[A-Za-z0-9_-]{20,})/.exec(line);
      if (serviceRoleJwt || secretKey) findings.push(`${path.relative(root, full)}:${index + 1}`);
    });
  }
}

walk(root);
if (findings.length) {
  console.error('Possible committed privileged credential detected:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log('PASS: no committed Supabase service-role/secret-key material detected');
