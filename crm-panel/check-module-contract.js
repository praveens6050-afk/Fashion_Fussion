'use strict';

// Lightweight, dependency-free guard for the dedicated CRM module.
// Run from repository root: node crm-panel/check-module-contract.js
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = __dirname;
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const exists = (name) => fs.existsSync(path.join(root, name));

const page = read('crm.html');
const login = read('crm-login.html');
const auth = read('crm-auth.js');
const loginJs = read('crm-login.js');

const localRefs = [
  ...[...page.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]),
  ...[...login.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]),
].filter((ref) => !/^(?:[a-z]+:)?\/\//i.test(ref) && !ref.startsWith('#') && !ref.startsWith('data:'))
 .map((ref) => ref.split('?')[0].split('#')[0])
 .filter(Boolean);

const missing = [...new Set(localRefs)].filter((ref) => !exists(ref));
assert.deepEqual(missing, [], 'CRM pages reference missing sibling assets');

for (const module of [
  'crm-unified-inbox.js',
  'crm-team-management.js',
  'crm-sales-workspace.js',
  'crm-support-workspace.js',
]) {
  assert.ok(exists(module), 'Missing dynamically loaded CRM module: ' + module);
  assert.ok(auth.includes(module), 'CRM auth loader no longer references ' + module);
}

assert.ok(exists('admin-crm-whatsapp-inbox.js'), 'WhatsApp inbox client is missing');
assert.ok(exists('supabase-config.js'), 'Supabase browser config is missing');
assert.match(login, /invitation.only|invite.only|no public registration/i, 'Login page must clearly state invitation-only access');
assert.doesNotMatch(login + loginJs, /signUp\s*\(|type=["']signup["']|id=["']signup["']/i, 'Public signup UI/API must not be introduced');
assert.match(auth, /crm_team_members/, 'CRM team authorization check is missing');
assert.match(auth, /showDenied|accessDenied/, 'Fail-closed denied-access state is missing');

console.log('CRM module contract passed: local assets, dynamic modules, invitation-only login and authorization markers.');
