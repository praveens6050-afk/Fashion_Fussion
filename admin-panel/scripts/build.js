'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const excluded = new Set(['dist', 'node_modules', '.git', 'functions']);
const requiredFunctions = [
  path.join(root, 'functions', 'api', 'admin-order-action.js'),
  path.join(root, 'functions', 'api', 'admin-crm-notifications.js'),
  path.join(root, 'functions', 'api', 'admin-crm-whatsapp-inbox.js')
];
for (const required of requiredFunctions) {
  if (!fs.existsSync(required)) {
    throw new Error('Required Cloudflare Pages Function is missing: ' + path.relative(root, required));
  }
}

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

for (const required of ['index.html', 'crm.html', 'crm-login.html', 'supabase-config.js']) {
  if (!fs.existsSync(path.join(output, required))) {
    throw new Error('Required Admin/CRM asset missing from build output: ' + required);
  }
}
if (fs.existsSync(path.join(output, 'functions'))) {
  throw new Error('Functions must remain at Pages project root, not inside the static output.');
}
console.log('Cloudflare Pages static build passed: Admin and CRM entry assets copied to dist; required Functions remain at Pages project root.');
