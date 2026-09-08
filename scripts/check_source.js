const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const htmlFiles=['index.html','login.html','signup.html','reset-password.html','cart.html','checkout.html','wishlist.html','notifications.html','order-details.html','admin.html','security-policy.html'];
const jsFiles=['supabase-config.js','support-chat.js','admin-notifications.js','admin-orders.js','admin-promotions.js','account-dashboard.js','account-role-guard.js','customer-addresses.js','order-tracking.js'];
let errors=[];
for(const file of htmlFiles){
  const full=path.join(root,file);
  const text=fs.readFileSync(full,'utf8');
  if(/Fashion_FUSSION/.test(text))errors.push(`${file}: obsolete brand Fashion_FUSSION`);
  if(/₹599|DELIVERY_THRESHOLD\s*=\s*599|Same-week dispatch/i.test(text))errors.push(`${file}: obsolete delivery/copy value`);
  const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m,i=0;
  while((m=re.exec(text))){
    i++;
    try{new vm.Script(m[1],{filename:`${file}:inline-script-${i}`})}catch(e){errors.push(e.message)}
  }
}
for(const file of jsFiles){
  const full=path.join(root,file);
  if(!fs.existsSync(full))continue;
  try{new vm.Script(fs.readFileSync(full,'utf8'),{filename:file})}catch(e){errors.push(e.message)}
}
const lib=fs.readFileSync(path.join(root,'backend/lib.js'),'utf8');
if(/GST_RATES|GST_MAX_SUPPORTED_ID/.test(lib))errors.push('backend/lib.js: hardcoded product GST map detected');
if(/\.select\(["'](?:[^"']*,)?cost(?:,|["'])/.test(fs.readFileSync(path.join(root,'index.html'),'utf8')))errors.push('index.html: product cost must not be public');
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('Source quality checks passed');
