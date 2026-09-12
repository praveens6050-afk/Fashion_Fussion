const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const errors=[];
function requireMarkers(file,markers,label=file){const text=read(file);for(const marker of markers)if(!text.includes(marker))errors.push(`${label}: missing ${marker}`);return text}
const config=requireMarkers('supabase-config.js',[
  "variant-commerce.js?v=2','data-variant-commerce",
  "product-variants.js?v=2','data-product-variants",
  "variant-cart-ui.js?v=1','data-variant-cart-ui",
  "admin-inventory.js?v=1','data-admin-inventory"
]);
if(!config.includes("page==='admin.html'"))errors.push('supabase-config.js: admin inventory runtime must be admin-page scoped');
requireMarkers('variant-commerce.js',['fashion_fussion_cart_lines_v2','variant_id','readLines','writeLines','addLine','updateLine','removeLine','/api/quote-order','/api/create-order']);
requireMarkers('product-variants.js',['product_variants','get_variant_availability','FashionVariantCart','currently unavailable']);
requireMarkers('variant-cart-ui.js',['product_variants','price_override','Size ','Color ','data-variant-line','updateLine','removeLine','itemsBox']);
requireMarkers('admin-inventory.js',['product_variants','inventory_levels','admin_set_variant_inventory','reserved','reorder_level','has_variants']);
requireMarkers('backend/lib.js',['has_variants','getVariantsByIds','getInventoryByVariantIds','Selected variant does not have enough stock','variant_id']);
requireMarkers('backend/api/create-order.js',['reserve_order_inventory','commit_order_inventory','release_order_inventory','reserveCheckout','failCheckout']);
requireMarkers('backend/api/verify-payment.js',['commit_order_inventory','commitInventory','Inventory finalization is being reconciled']);
requireMarkers('backend/api/razorpay-webhook.js',['commit_order_inventory','commitOrderInventory','inventory_reconciled','inventory_committed']);
requireMarkers('backend/api/reconcile-payment.js',['commit_order_inventory','commitInventory','inventory_reconciled','Inventory finalization is being reconciled','Do not pay again']);
requireMarkers('backend/api/cancel-order.js',['release_order_inventory','restock_cancelled_order_inventory']);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('Focused variant/inventory source guards passed');
