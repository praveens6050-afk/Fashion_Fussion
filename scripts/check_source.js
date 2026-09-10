const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const htmlFiles=fs.readdirSync(root).filter(f=>f.endsWith('.html')&&!f.startsWith('google'));
const jsFiles=fs.readdirSync(root).filter(f=>f.endsWith('.js'));
let errors=[];
const localRef=/\b(?:src|href)=["']([^"']+)["']/gi;
for(const file of htmlFiles){
  const full=path.join(root,file),text=fs.readFileSync(full,'utf8');
  if(/Fashion_FUSSION/.test(text))errors.push(`${file}: obsolete brand Fashion_FUSSION`);
  if(/₹599|DELIVERY_THRESHOLD\s*=\s*599|Same-week dispatch/i.test(text))errors.push(`${file}: obsolete delivery/copy value`);
  if(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2(?!\.116\.0)/.test(text))errors.push(`${file}: Supabase browser SDK must be pinned to 2.116.0`);
  if(/localStorage\.(?:setItem|getItem)\(\s*["']customer_(?:name|phone)["']/.test(text))errors.push(`${file}: profile PII must not persist in localStorage`);
  let ref; while((ref=localRef.exec(text))){const value=ref[1];if(/^(?:https?:|mailto:|tel:|#|javascript:|data:|\/\/)/i.test(value))continue;const clean=value.split('#')[0].split('?')[0];if(clean&&!fs.existsSync(path.join(root,clean)))errors.push(`${file}: missing local reference ${value}`)}
  const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m,i=0;
  while((m=re.exec(text))){i++;try{new vm.Script(m[1],{filename:`${file}:inline-script-${i}`})}catch(e){errors.push(e.message)}}
}
for(const file of jsFiles){const full=path.join(root,file),text=fs.readFileSync(full,'utf8');if(/localStorage\.(?:setItem|getItem)\(\s*["']customer_(?:name|phone)["']/.test(text))errors.push(`${file}: profile PII must not persist in localStorage`);try{new vm.Script(text,{filename:file})}catch(e){errors.push(e.message)}}
const lib=fs.readFileSync(path.join(root,'backend/lib.js'),'utf8');
if(/GST_RATES|GST_MAX_SUPPORTED_ID/.test(lib))errors.push('backend/lib.js: hardcoded product GST map detected');
if(/\.select\(["'](?:[^"']*,)?cost(?:,|["'])/.test(fs.readFileSync(path.join(root,'index.html'),'utf8')))errors.push('index.html: product cost must not be public');
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`Source quality checks passed (${htmlFiles.length} HTML, ${jsFiles.length} JS)`);
