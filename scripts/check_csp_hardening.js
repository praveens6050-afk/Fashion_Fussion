'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];
const fail = message => failures.push(message);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));

const STYLE_BLOCK_RE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/i;
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/i;
const STYLE_ATTR_RE = /\sstyle\s*=\s*(["']).*?\1/is;
const EVENT_ATTR_RE = /\son[a-z0-9_-]+\s*=\s*(["']).*?\1/is;
const JAVASCRIPT_URL_RE = /(?:href|src)\s*=\s*(["'])\s*javascript:/i;
const CSS_TEXT_RE = /\.style\.cssText\s*=/;
const STYLE_API_RE = /\.style\./;
const SET_STYLE_ATTR_RE = /(?:setAttribute|setAttributeNS)\s*\(\s*["']style["']/i;
const DYNAMIC_STYLE_ELEMENT_RE = /createElement\s*\(\s*["']style["']\s*\)/i;
const PROD_BACKEND_ORIGIN = 'https://fashion-fussion-olive.vercel.app';

const htmlFiles = fs.readdirSync(root)
  .filter(name => name.endsWith('.html'))
  .filter(name => /<head\b/i.test(read(name)) && /<\/head>/i.test(read(name)))
  .sort();

if (!htmlFiles.length) fail('No HTML documents found for CSP checks.');

for (const file of htmlFiles) {
  const text = read(file);
  if (STYLE_BLOCK_RE.test(text)) fail(`${file}: inline <style> block is forbidden`);
  if (INLINE_SCRIPT_RE.test(text)) fail(`${file}: inline <script> block is forbidden`);
  if (STYLE_ATTR_RE.test(text)) fail(`${file}: style= attribute is forbidden`);
  if (EVENT_ATTR_RE.test(text)) fail(`${file}: inline on*= event handler is forbidden`);
  if (JAVASCRIPT_URL_RE.test(text)) fail(`${file}: javascript: URL is forbidden`);
  if (!text.includes('csp-dynamic.css?v=1')) fail(`${file}: csp-dynamic.css compatibility stylesheet is missing`);

  for (const match of text.matchAll(/(?:src|href)=["'](csp-[^"'?]+\.(?:js|css))(?:\?[^"']*)?["']/gi)) {
    if (!exists(match[1])) fail(`${file}: referenced CSP asset does not exist: ${match[1]}`);
  }
}

const rootJsFiles = fs.readdirSync(root)
  .filter(name => name.endsWith('.js'))
  .sort();

for (const file of rootJsFiles) {
  const text = read(file);
  if (STYLE_ATTR_RE.test(text)) fail(`${file}: generated style= attribute is forbidden`);
  if (EVENT_ATTR_RE.test(text)) fail(`${file}: generated on*= event handler is forbidden`);
  if (JAVASCRIPT_URL_RE.test(text)) fail(`${file}: generated javascript: URL is forbidden`);
  if (CSS_TEXT_RE.test(text)) fail(`${file}: style.cssText assignment is forbidden`);
  if (STYLE_API_RE.test(text)) fail(`${file}: runtime element.style access is forbidden; use hidden, classes or data-state`);
  if (SET_STYLE_ATTR_RE.test(text)) fail(`${file}: setAttribute('style', ...) is forbidden`);
  if (DYNAMIC_STYLE_ELEMENT_RE.test(text)) fail(`${file}: runtime <style> creation is forbidden; use a same-origin stylesheet`);
  if (file !== 'supabase-config.js' && text.includes(PROD_BACKEND_ORIGIN)) fail(`${file}: production backend origin must only be defined by the central Pages fallback`);
  if (file === 'supabase-config.js' && !text.includes("window.FF_API_ORIGIN=location.hostname.endsWith('github.io')?'https://fashion-fussion-olive.vercel.app':'';")) fail('supabase-config.js: canonical GitHub Pages API fallback is missing');
  if (/fetch\(\s*['"]\/api\//.test(text)) fail(`${file}: direct same-origin API fetch breaks GitHub Pages; use FF_API_ORIGIN or a BACKEND_URL derived from it`);
  if (/\bBACKEND_URL\s*=\s*['"]{2}/.test(text)) fail(`${file}: empty BACKEND_URL breaks GitHub Pages; derive it from window.FF_API_ORIGIN`);
}

if (!exists('csp-dynamic.css')) fail('csp-dynamic.css is missing.');
if (!exists('support-chat.css')) fail('support-chat.css is missing.');

let config;
try {
  config = JSON.parse(read('vercel.json'));
} catch (error) {
  fail(`vercel.json is not valid JSON: ${error.message}`);
}

if (config) {
  const globalRule = (config.headers || []).find(rule => rule.source === '/(.*)');
  const cspHeader = globalRule?.headers?.find(header => String(header.key).toLowerCase() === 'content-security-policy');
  const csp = String(cspHeader?.value || '');
  if (!csp) {
    fail('Global Content-Security-Policy header is missing.');
  } else {
    const required = [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net https://checkout.razorpay.com",
      "script-src-attr 'none'",
      "style-src 'self'",
      "style-src-attr 'none'",
      'https://gmdevprqtvoshbbytsxf.supabase.co',
      'wss://gmdevprqtvoshbbytsxf.supabase.co',
      'https://*.razorpay.com',
      'frame-src https://*.razorpay.com',
      "object-src 'none'",
      "frame-ancestors 'none'",
    ];
    const directives = Object.fromEntries(csp.split(';').map(part=>part.trim()).filter(Boolean).map(part=>{const i=part.indexOf(' ');return i<0?[part,'']:[part.slice(0,i),part.slice(i+1)]}));
    if ((directives['script-src']||'').includes("'unsafe-inline'")) fail("script-src must not allow 'unsafe-inline'.");
    if ((directives['style-src']||'').includes("'unsafe-inline'")) fail("style-src must not allow inline <style> blocks.");
    if ((directives['style-src-attr']||'').includes("'unsafe-inline'") || (directives['style-src-attr']||'') !== "'none'") fail("style-src-attr must be 'none'.");
    for (const token of required) {
      if (!csp.includes(token)) fail(`Global CSP is missing required directive/source: ${token}`);
    }
  }
}

if (failures.length) {
  console.error('Strict CSP hardening checks failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log(`Strict CSP hardening source guards passed (${htmlFiles.length} HTML documents, ${rootJsFiles.length} browser JS files).`);
