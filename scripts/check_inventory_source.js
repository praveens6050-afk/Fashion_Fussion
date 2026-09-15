const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const errors=[];
function requireMarkers(file,markers,label=file){const text=read(file);for(const marker of markers)if(!text.includes(marker))errors.push(`${label}: missing ${marker}`);return text}
const config=requireMarkers('supabase-config.js',[
  "catalog-variant-guard.js?v=1','data-catalog-variant-guard",
  "variant-commerce.js?v=2','data-variant-commerce",
  "product-variants.js?v=2','data-product-variants",
  "variant-cart-ui.js?v=1','data-variant-cart-ui",
  "admin-inventory.js?v=1','data-admin-inventory",
  "admin-catalog-safety.js?v=1','data-admin-catalog-safety"
]);
if(!config.includes("['index.html','search.html'].includes(page)"))errors.push('supabase-config.js: catalogue variant guard must be limited to listing pages');
if(!config.includes("page==='admin.html'"))errors.push('supabase-config.js: admin inventory runtime must be admin-page scoped');
const catalogGuard=requireMarkers('catalog-variant-guard.js',['has_variants','CHOOSE OPTIONS','event.stopImmediatePropagation()','product.html?id=','sessionStorage.removeItem(CHECKOUT_KEY)']);
if(!catalogGuard.includes("if(known===false)return"))errors.push('catalog-variant-guard.js: non-variant catalogue products must preserve direct add-to-cart');
const variantCommerce=requireMarkers('variant-commerce.js',['fashion_fussion_cart_lines_v2','variant_id','readLines','writeLines','addLine','updateLine','removeLine','/api/quote-order','/api/create-order','resolveSingleSellableVariants','get_variant_availability','sellable.length!==1']);
if(!variantCommerce.includes('await resolveSingleSellableVariants(parsed)'))errors.push('variant-commerce.js: checkout requests must repair exactly-one sellable variant before submit');
const productVariants=requireMarkers('product-variants.js',['product_variants','get_variant_availability','FashionVariantCart','currently unavailable','sellable.length===1','price_override??product.price']);
if(!productVariants.includes('else if(sellable.length===1)select(sellable[0])'))errors.push('product-variants.js: only exactly one sellable variant may auto-select');
if(productVariants.includes('price_override||product.price'))errors.push('product-variants.js: variant price override must use nullish fallback, not truthy fallback');
const variantCart=requireMarkers('variant-cart-ui.js',['product_variants','price_override','Size ','Color ','data-variant-line','updateLine','removeLine','itemsBox','repairLines','resolveSingleSellableVariants']);
if(!variantCart.includes('await repairLines()'))errors.push('variant-cart-ui.js: legacy cart lines must be repaired before render');
requireMarkers('admin-inventory.js',['product_variants','inventory_levels','admin_set_variant_inventory','reserved','reorder_level','has_variants']);
requireMarkers('admin-catalog-safety.js',['Safe publish workflow','status.value=\'false\'','positive available stock','Launch guard']);
const productGrantMigration=requireMarkers('supabase/migrations/20260915171000_restore_product_feature_column_select.sql',['bulk_enabled','bulk_min_qty','has_variants','to anon, authenticated']);
if(/grant\s+select\s*\([^)]*\bcost\b/i.test(productGrantMigration)||/grant\s+select\s+on\s+table\s+public\.products/i.test(productGrantMigration))errors.push('product feature grant migration must not expose products.cost');
const activationMigration=requireMarkers('supabase/migrations/20260915173500_guard_product_activation_inventory.sql',['alter column is_active set default false','products_activation_readiness_guard','Add at least one SKU/variant before activating this product','Set available stock above zero on an active SKU before activating this product','i.on_hand - i.reserved']);
if(!/before insert or update of is_active/i.test(activationMigration))errors.push('catalog activation guard must run before activation writes');
requireMarkers('backend/lib.js',['has_variants','getVariantsByIds','getInventoryByVariantIds','Selected variant does not have enough stock','variant_id']);
const createOrder=requireMarkers('backend/api/create-order.js',['reserve_order_inventory','release_order_inventory','reserveCheckout','failCheckout','finalize_cod_order_inventory','finalize_zero_value_order_inventory','finalizeCod','finalizeZeroValue']);
if(createOrder.includes("await rpc('finalize_checkout_order',{p_order_id:saved.id")&&createOrder.includes("await rpc('commit_order_inventory',{p_order_id:saved.id"))errors.push('backend/api/create-order.js: new COD/zero-value checkout must not finalize order and inventory in separate RPC calls');
requireMarkers('backend/api/verify-payment.js',['commit_order_inventory','commitInventory','Inventory finalization is being reconciled']);
requireMarkers('backend/api/razorpay-webhook.js',['commit_order_inventory','commitOrderInventory','inventory_reconciled','inventory_committed']);
requireMarkers('backend/api/reconcile-payment.js',['commit_order_inventory','commitInventory','inventory_reconciled','Inventory finalization is being reconciled','Do not pay again']);
requireMarkers('backend/api/cancel-order.js',['release_order_inventory','restock_cancelled_order_inventory']);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('Focused variant/inventory/catalog-readiness source guards passed');
