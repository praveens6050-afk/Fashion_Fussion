'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const excluded = new Set(['dist', 'node_modules', '.git', 'functions']);

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

function copyDirectory(source, destination) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (source === root && excluded.has(entry.name)) continue;
    if (entry.name === '.DS_Store') continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyDirectory(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

copyDirectory(root, output);

for (const required of ['index.html', 'login.html', 'supabase-config.js']) {
  if (!fs.existsSync(path.join(output, required))) {
    throw new Error('Required CRM preview asset missing from build output: ' + required);
  }
}

console.log('CRM preview Pages build passed: static assets copied to dist; server-side Functions excluded from public assets.');
