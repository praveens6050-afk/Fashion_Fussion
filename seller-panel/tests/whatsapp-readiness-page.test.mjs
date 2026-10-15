import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const load=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('operator diagnostics page provides only check and clear actions',async()=>{
  const html=await load('whatsapp-readiness.html');
  assert.match(html,/whatsapp-readiness\.js/);
  assert.match(html,/id="readinessForm"/);
  assert.match(html,/id="check"/);
  assert.match(html,/id="clear"/);
  assert.match(html,/id="roles"/);
  assert.match(html,/id="sellerMeta"/);
  assert.match(html,/id="token" type="password"/);
  assert.doesNotMatch(html,/type="submit"[^>]*>Send\b/i);
  assert.doesNotMatch(html,/<script(?![^>]*src)/i);
  assert.doesNotMatch(html,/<form[^>]*action=/i);
});

test('operator diagnostic client uses same-origin GET only; no storage or token in URL',async()=>{
  const js=await load('whatsapp-readiness.js');
  assert.match(js,/method: 'GET'/);
  assert.match(js,/Authorization: 'Bearer '/);
  assert.match(js,/token\.value = ''/);
  assert.match(js,/\/api\/outreach\/whatsapp-health/);
  assert.match(js,/\/api\/outreach\/whatsapp-meta-readiness/);
  assert.match(js,/\/api\/outreach\/whatsapp-roles-readiness/);
  assert.match(js,/\/api\/outreach\/whatsapp-seller-template-readiness/);
  assert.doesNotMatch(js,/method:\s*['"]POST['"]/);
  assert.doesNotMatch(js,/(?:localStorage|sessionStorage|indexedDB|document\.cookie)/);
  assert.doesNotMatch(js,/https:\/\/graph\.facebook\.com/);
  assert.doesNotMatch(js,/searchParams\.set\([^)]*token/i);
});
