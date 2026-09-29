// Local UI regression fixtures. Run: node .github/ui-regression-server.mjs
// Open /cart.html, /search.html, /account.html at 360, 390, 900, 1024, 1440px.
// Uses production templates, renderers and styles with synthetic read-only data.
// No requests or writes are made to the live service.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.UI_SOURCE_ROOT || path.join(here, '../customer-panel'));
const mime = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml' };
const pages = new Set(['cart', 'search', 'account']);
const port = Number(process.env.UI_PORT || 4173);
const readSource = file => fs.readFileSync(file);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let name = decodeURIComponent(url.pathname).slice(1) || 'cart.html';
  if (name === 'ui-fixture.js' || name === 'ui-checks.js') {
    res.setHeader('Content-Type','text/javascript; charset=utf-8');
    res.end(fs.readFileSync(path.join(here, name))); return;
  }
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type',(mime[path.extname(file)] || 'text/plain') + '; charset=utf-8');
  const page = path.basename(name,'.html');
  if (pages.has(page) && name.endsWith('.html')) {
    let html = readSource(file).toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
    html = html.replace('</head>', '<link rel="stylesheet" href="customer-responsive.css"></head>');
    const scripts = ['ui-fixture.js','customer-browser-compat.js'];
    if (page === 'account') scripts.push('desktop-account-loader.js');
    if (page === 'cart') scripts.push('desktop-checkout-loader.js');
    scripts.push(`csp-${page}.js`);
    if (page === 'cart') scripts.push('cart-mobile-structural-reflow.js','cart-login-return.js');
    if (page === 'account') {
      // Deliberately replay the scripts to exercise the duplicate-execution guard.
      scripts.push('account-returns.js','account-business.js','account-returns.js?replay','account-business.js?replay');
    }
    scripts.push('ui-checks.js');
    res.end(html.replace('</body>',scripts.map(s=>`<script src="${s}"></script>`).join('')+'</body>'));
  } else res.end(readSource(file));
}).listen(port, '127.0.0.1', () => console.log(`UI regression fixtures: http://127.0.0.1:${port}/cart.html`));
