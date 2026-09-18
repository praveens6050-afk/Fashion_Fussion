const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const errors=[];
function requireMarkers(file,markers){const text=read(file);for(const marker of markers)if(!text.includes(marker))errors.push(`${file}: missing ${marker}`);return text}
const health=requireMarkers('backend/api/checkout-health.js',[
  'requireAdminUser','active_products','orders_count','delivery_address_ready','checkout_rpcs',
  'razorpay','webhook_secret_configured','cod_test_ready','prepaid_test_ready','blockers',
  'https://api.razorpay.com/v1/orders?count=1&skip=0','method:\'GET\''
]);
for(const rpc of ['reserve_order_promotions','reserve_order_inventory','release_order_inventory','release_order_promotions','finalize_cod_order_inventory','finalize_zero_value_order_inventory','commit_order_inventory','finalize_checkout_order','claim_prepaid_order_cancellation','restore_cancelled_order_promotions','restock_cancelled_order_inventory','record_payment_exception'])if(!health.includes(rpc))errors.push(`backend/api/checkout-health.js: missing RPC readiness check ${rpc}`);
if(/\/refund|method:\s*['"]POST['"].*api\.razorpay\.com/s.test(health))errors.push('backend/api/checkout-health.js: readiness check must never create/refund Razorpay resources');
const dispatcher=requireMarkers('api/admin-order-action.js',['checkout-health.js',"action==='checkout_health'"]);
const loader=requireMarkers('supabase-config.js',["admin-checkout-health.js?v=1','data-admin-checkout-health","admin-launch-readiness.js?v=1','data-admin-launch-readiness',`window.FF_API_ORIGIN=location.hostname.endsWith('github.io')?'https://fashion-fussion-olive.vercel.app':'';`]);
requireMarkers('admin-checkout-health.js',['Checkout Readiness','checkout_health','COD real test','Prepaid real test','never creates an order, payment, refund, shipment or inventory movement']);
const launch=requireMarkers('admin-launch-readiness.js',['First Live Order Readiness','checkout_health','connection_test','admin_list','product_variants','inventory_levels','packed_eligible','sellable_skus','AWB assigned','Pickup requested','Read-only preflight']);
for(const action of ['create_shipment','check_serviceability','assign_awb','request_pickup','sync_tracking','collect_cod','cancel_cod','update_fulfillment'])if(launch.includes("api(s.access_token,'"+action+"'"))errors.push(`admin-launch-readiness.js: read-only ladder must not invoke ${action}`);
if(/\.from\([^)]*\)\.(insert|update|delete|upsert)\s*\(/.test(launch)||/\.rpc\s*\(/.test(launch))errors.push('admin-launch-readiness.js: read-only ladder must not mutate Supabase data');
if(!dispatcher.includes('return checkoutHealth(req,res)'))errors.push('api/admin-order-action.js: checkout health must reuse the shared admin serverless route');
if(!loader.includes("page==='admin.html'"))errors.push('supabase-config.js: checkout/launch readiness UI must remain admin-only');
for(const file of ['checkout.js','quote-checkout.js']){
  const text=requireMarkers(file,["const BACKEND_URL=window.FF_API_ORIGIN||'';"]);
  if(text.includes('https://fashion-fussion-olive.vercel.app'))errors.push(`${file}: production backend origin must stay centralized in supabase-config.js`);
}
const quoteApi=requireMarkers('backend/api/quote-order.js',['consume_api_rate_limit',"p_scope: 'quote_order'",'p_limit: 30','p_window_seconds: 60','error.status = 429']);
if(!quoteApi.includes('await enforceQuoteRateLimit(user.id)'))errors.push('backend/api/quote-order.js: authenticated quote rate limit must run before pricing work');
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('Checkout and first-order readiness source guards passed');
require('./check_public_launch_contract.js');
