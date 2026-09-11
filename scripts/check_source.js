const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const htmlFiles=fs.readdirSync(root).filter(f=>f.endsWith('.html')&&!f.startsWith('google'));
const jsFiles=fs.readdirSync(root).filter(f=>f.endsWith('.js'));
const customerCommerceFiles=new Set(['index.html','search.html','product.html','cart.html','checkout.html','order-confirmation.html','wishlist.html','account.html','order-details.html']);
let errors=[];
const localRef=/\b(?:src|href)=["']([^"']+)["']/gi;
for(const file of htmlFiles){
  const full=path.join(root,file),text=fs.readFileSync(full,'utf8');
  if(/Fashion_FUSSION/.test(text))errors.push(`${file}: obsolete brand Fashion_FUSSION`);
  if(/₹599|DELIVERY_THRESHOLD\s*=\s*599|Same-week dispatch/i.test(text))errors.push(`${file}: obsolete delivery/copy value`);
  if(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2(?!\.116\.0)/.test(text))errors.push(`${file}: Supabase browser SDK must be pinned to 2.116.0`);
  if(/localStorage\.(?:setItem|getItem)\(\s*["']customer_(?:name|phone)["']/.test(text))errors.push(`${file}: profile PII must not persist in localStorage`);
  if(customerCommerceFiles.has(file)){
    if(/selling_price/.test(text))errors.push(`${file}: customer storefront must use live products.price, not selling_price`);
    if(/★★★★★|★★★★☆|verified catalogue review/i.test(text))errors.push(`${file}: unsupported/fake review presentation detected`);
    if(/Available to order/i.test(text))errors.push(`${file}: unsupported stock availability claim detected`);
  }
  let ref; while((ref=localRef.exec(text))){const value=ref[1];if(/^(?:https?:|mailto:|tel:|#|javascript:|data:|\/\/)/i.test(value))continue;const clean=value.split('#')[0].split('?')[0];if(clean&&!fs.existsSync(path.join(root,clean)))errors.push(`${file}: missing local reference ${value}`)}
  const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m,i=0;
  while((m=re.exec(text))){i++;try{new vm.Script(m[1],{filename:`${file}:inline-script-${i}`})}catch(e){errors.push(e.message)}}
}
for(const file of jsFiles){const full=path.join(root,file),text=fs.readFileSync(full,'utf8');if(/localStorage\.(?:setItem|getItem)\(\s*["']customer_(?:name|phone)["']/.test(text))errors.push(`${file}: profile PII must not persist in localStorage`);try{new vm.Script(text,{filename:file})}catch(e){errors.push(e.message)}}
const lib=fs.readFileSync(path.join(root,'backend/lib.js'),'utf8');
if(/GST_RATES|GST_MAX_SUPPORTED_ID/.test(lib))errors.push('backend/lib.js: hardcoded product GST map detected');
if(/\.select\(["'](?:[^"']*,)?cost(?:,|["'])/.test(fs.readFileSync(path.join(root,'index.html'),'utf8')))errors.push('index.html: product cost must not be public');
if(!/PAYMENT_HANDLING_FEE\s*=\s*0/.test(lib))errors.push('backend/lib.js: payment handling fee must remain zero');
if(!/PREPAID_DISCOUNT\s*=\s*0/.test(lib))errors.push('backend/lib.js: prepaid discount compatibility field must remain zero');
if(!/cod_fee_non_refundable:\s*false/.test(lib))errors.push('backend/lib.js: COD non-refundable fee flag must remain false');
const orderDetails=fs.readFileSync(path.join(root,'order-details.html'),'utf8');
for(const anchor of ['trackingSection','actionsSection','helpSection'])if(!orderDetails.includes(`id="${anchor}"`))errors.push(`order-details.html: missing ${anchor} hash target`);
if(/Payment ID:\s*["']?\s*\+\s*esc\(o\.razorpay_payment_id\)/.test(orderDetails))errors.push('order-details.html: raw Razorpay payment ID must not be shown to customers');
const confirmation=fs.readFileSync(path.join(root,'order-confirmation.html'),'utf8');
for(const required of ['id="orderRef"','id="items"','id="address"','id="payment"','id="detailsLink"'])if(!confirmation.includes(required))errors.push(`order-confirmation.html: missing ${required}`);
if(/razorpay_payment_id|razorpay_order_id/.test(confirmation))errors.push('order-confirmation.html: raw Razorpay identifiers must not be exposed');
const supabaseConfig=fs.readFileSync(path.join(root,'supabase-config.js'),'utf8');
const legacyInjectors=['account-dashboard.js','customer-addresses.js','order-tracking.js'];
for(const legacy of legacyInjectors){if(supabaseConfig.includes(`add('${legacy}`))errors.push(`supabase-config.js: premium account must not load legacy ${legacy} runtime injector`);if(fs.existsSync(path.join(root,legacy)))errors.push(`${legacy}: obsolete runtime injector must stay removed`)}
const account=fs.readFileSync(path.join(root,'account.html'),'utf8');
for(const required of ['data-view="addresses"','id="addressesView"','id="addressForm"','customer_addresses','set_default_customer_address'])if(!account.includes(required))errors.push(`account.html: integrated address management missing ${required}`);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`Source quality checks passed (${htmlFiles.length} HTML, ${jsFiles.length} JS)`);
