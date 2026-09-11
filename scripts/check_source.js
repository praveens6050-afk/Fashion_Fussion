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
const cancelOrder=fs.readFileSync(path.join(root,'backend/api/cancel-order.js'),'utf8');
for(const required of ['cancellation_reason','cancelled_at','refund_id','refund_status','refund_reference','refund_amount','refund_updated_at'])if(!cancelOrder.includes(required))errors.push(`backend/api/cancel-order.js: cancellation/refund audit persistence missing ${required}`);
const refundStatus=fs.readFileSync(path.join(root,'backend/api/refund-status.js'),'utf8');
for(const required of ['refund_id','refund_status','refund_reference','refund_amount','refund_updated_at'])if(!refundStatus.includes(required))errors.push(`backend/api/refund-status.js: refund reconciliation audit persistence missing ${required}`);
const webhook=fs.readFileSync(path.join(root,'backend/api/razorpay-webhook.js'),'utf8');
for(const required of ['refund.created','refund.processed','refund.failed','x-razorpay-signature','expectedRefundAmount(','refund_pending','refund_id','refund_status','refund_reference','refund_amount','refund_updated_at'])if(!webhook.includes(required))errors.push(`backend/api/razorpay-webhook.js: refund lifecycle/audit guard missing ${required}`);
if(!/String\(refund\.status\s*\|\|\s*['"]{2}\)\.toLowerCase\(\)/.test(webhook))errors.push('backend/api/razorpay-webhook.js: refund webhook must validate processor refund status');
if(!/different_refund_reference/.test(webhook))errors.push('backend/api/razorpay-webhook.js: webhook must reject a different refund reference once an order refund is persisted');
if(!/refund_reference:\s*refundReference\(refund\)\s*\|\|\s*order\.refund_reference\s*\|\|\s*null/.test(webhook))errors.push('backend/api/razorpay-webhook.js: webhook must preserve an existing refund reference when later events omit acquirer data');
const checkout=fs.readFileSync(path.join(root,'checkout.html'),'utf8');
for(const required of ['id="addressSection"','id="addressState"','name="deliveryAddress"','customer_addresses','shipping_address:{id:address.id}','order-confirmation.html?id='])if(!checkout.includes(required))errors.push(`checkout.html: inline address/confirmation flow missing ${required}`);
if(/\.eq\(['"]is_default['"],true\)\.limit\(1\)\.maybeSingle\(\)/.test(checkout))errors.push('checkout.html: checkout must load selectable saved addresses, not only the default address');
const orderDetails=fs.readFileSync(path.join(root,'order-details.html'),'utf8');
for(const anchor of ['trackingSection','actionsSection','helpSection'])if(!orderDetails.includes(`id="${anchor}"`))errors.push(`order-details.html: missing ${anchor} hash target`);
for(const required of ['id="refundFeedback"','aria-live="polite"','setRefundFeedback(','/api/refund-status'])if(!orderDetails.includes(required))errors.push(`order-details.html: inline refund feedback missing ${required}`);
if(/\balert\s*\(/.test(orderDetails))errors.push('order-details.html: refund/order status must use inline feedback, not browser alerts');
if(/razorpay_payment_id|razorpay_order_id/.test(orderDetails))errors.push('order-details.html: raw Razorpay identifiers must not be selected or exposed');
const refundTracker=fs.readFileSync(path.join(root,'order-refund-tracker.js'),'utf8');
for(const required of ['cancellation_reason','cancelled_at','refund_id','refund_status','refund_reference','refund_amount','refund_updated_at','Original payment method'])if(!refundTracker.includes(required))errors.push(`order-refund-tracker.js: persisted customer refund tracker missing ${required}`);
if(/razorpay_payment_id|razorpay_order_id/.test(refundTracker))errors.push('order-refund-tracker.js: raw Razorpay identifiers must not be selected or exposed');
const returnExchange=fs.readFileSync(path.join(root,'order-return-exchange.js'),'utf8');
for(const required of ['create_return_request','return_requests','exchange_size','return_refund','report_issue','p_item_index','p_quantity','p_reason','p_requested_size','Requested size is not a stock promise'])if(!returnExchange.includes(required))errors.push(`order-return-exchange.js: customer return/exchange flow missing ${required}`);
if(/razorpay_payment_id|razorpay_order_id/.test(returnExchange))errors.push('order-return-exchange.js: raw Razorpay identifiers must not be selected or exposed');
const confirmation=fs.readFileSync(path.join(root,'order-confirmation.html'),'utf8');
for(const required of ['id="orderRef"','id="items"','id="address"','id="payment"','id="detailsLink"'])if(!confirmation.includes(required))errors.push(`order-confirmation.html: missing ${required}`);
if(/razorpay_payment_id|razorpay_order_id/.test(confirmation))errors.push('order-confirmation.html: raw Razorpay identifiers must not be exposed');
const supabaseConfig=fs.readFileSync(path.join(root,'supabase-config.js'),'utf8');
const legacyInjectors=['account-dashboard.js','customer-addresses.js','order-tracking.js'];
for(const legacy of legacyInjectors){if(supabaseConfig.includes(`add('${legacy}`))errors.push(`supabase-config.js: premium account must not load legacy ${legacy} runtime injector`);if(fs.existsSync(path.join(root,legacy)))errors.push(`${legacy}: obsolete runtime injector must stay removed`)}
for(const required of ["order-refund-tracker.js?v=1','data-order-refund-tracker", "account-refunds.js?v=1','data-account-refunds", "order-return-exchange.js?v=1','data-order-return-exchange", "account-returns.js?v=1','data-account-returns"])if(!supabaseConfig.includes(required))errors.push(`supabase-config.js: customer commerce runtime injector missing ${required}`);
const account=fs.readFileSync(path.join(root,'account.html'),'utf8');
for(const required of ['data-view="addresses"','id="addressesView"','id="addressForm"','customer_addresses','set_default_customer_address'])if(!account.includes(required))errors.push(`account.html: integrated address management missing ${required}`);
const accountRefunds=fs.readFileSync(path.join(root,'account-refunds.js'),'utf8');
for(const required of ['refund_id','refund_status','refund_reference','refund_amount','refund_updated_at','cancellation_reason','Original payment method','order-details.html?id=','hydrateAudit(','mergeAudit('])if(!accountRefunds.includes(required))errors.push(`account-refunds.js: persisted account refund view missing ${required}`);
if(/razorpay_payment_id|razorpay_order_id/.test(accountRefunds))errors.push('account-refunds.js: raw Razorpay identifiers must not be selected or exposed');
const accountReturns=fs.readFileSync(path.join(root,'account-returns.js'),'utf8');
for(const required of ['Returns & Exchanges','return_requests','requested_size','admin_note','order-details.html?id=','#returns','exchange_size','return_refund','report_issue'])if(!accountReturns.includes(required))errors.push(`account-returns.js: account returns/exchanges view missing ${required}`);
if(/razorpay_payment_id|razorpay_order_id/.test(accountReturns))errors.push('account-returns.js: raw Razorpay identifiers must not be selected or exposed');
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`Source quality checks passed (${htmlFiles.length} HTML, ${jsFiles.length} JS)`);
