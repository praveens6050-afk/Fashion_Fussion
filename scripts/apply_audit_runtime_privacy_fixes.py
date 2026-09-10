from pathlib import Path

root=Path('.')

p=root/'checkout.html'
t=p.read_text(encoding='utf-8')
old="async function api(path,body){const r=await fetch(BACKEND_URL+path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||'Request failed');e.data=d;e.status=r.status;throw e}return d}"
new="async function api(path,body){const{data:{session:fresh},error:sessionError}=await window.supabaseClient.auth.getSession();if(sessionError||!fresh?.access_token)throw new Error('Your login session has expired. Please log in again.');session=fresh;const r=await fetch(BACKEND_URL+path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+fresh.access_token},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||'Request failed');e.data=d;e.status=r.status;throw e}return d}"
if old not in t: raise SystemExit('checkout api pattern not found')
p.write_text(t.replace(old,new,1),encoding='utf-8')

p=root/'admin.html'
t=p.read_text(encoding='utf-8')
old="async function loadCosts(){const r=await fetch(BACKEND_URL+'/api/admin-product-costs',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+currentSession.access_token},body:'{}'}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not load private product costs');costMap=new Map((d.products||[]).map(x=>[Number(x.id),Number(x.cost||0)]))}"
new="async function loadCosts(){const{data:{session:fresh},error:sessionError}=await window.supabaseClient.auth.getSession();if(sessionError||!fresh?.access_token)throw new Error('Admin session expired');currentSession=fresh;const r=await fetch(BACKEND_URL+'/api/admin-product-costs',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+fresh.access_token},body:'{}'}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not load private product costs');costMap=new Map((d.products||[]).map(x=>[Number(x.id),Number(x.cost||0)]))}"
if old not in t: raise SystemExit('admin loadCosts pattern not found')
p.write_text(t.replace(old,new,1),encoding='utf-8')

p=root/'account.html'
t=p.read_text(encoding='utf-8')
old='''        const savedName =
          String(
            profile?.full_name ||
            localStorage.getItem(
              "customer_name"
            ) ||
            ""
          ).trim();


        const savedPhone =
          String(
            profile?.phone ||
            localStorage.getItem(
              "customer_phone"
            ) ||
            ""
          ).trim();'''
new='''        /* Remove legacy browser-stored PII before rendering the signed-in profile. */
        localStorage.removeItem("customer_name");
        localStorage.removeItem("customer_phone");

        const savedName =
          String(
            profile?.full_name ||
            ""
          ).trim();


        const savedPhone =
          String(
            profile?.phone ||
            ""
          ).trim();'''
if old not in t: raise SystemExit('account load profile pattern not found')
t=t.replace(old,new,1)
old='''        /* -----------------------------------------------
           Keep localStorage synchronized
           ----------------------------------------------- */

        if (savedName) {

          localStorage.setItem(
            "customer_name",
            savedName
          );

        }


        if (savedPhone) {

          localStorage.setItem(
            "customer_phone",
            savedPhone
          );

        }


'''
if old not in t: raise SystemExit('account local sync pattern not found')
t=t.replace(old,'',1)
old='''        /*
         * Even if Supabase profile
         * cannot be loaded, use localStorage.
         */

        $("fullName").value =
          localStorage.getItem(
            "customer_name"
          ) || "";


        $("phone").value =
          localStorage.getItem(
            "customer_phone"
          ) || "";'''
new='''        /* Never fall back to another browser user's locally stored profile data. */
        localStorage.removeItem("customer_name");
        localStorage.removeItem("customer_phone");

        $("fullName").value =
          "";


        $("phone").value =
          "";'''
if old not in t: raise SystemExit('account fallback pattern not found')
t=t.replace(old,new,1)
old='''        /* -----------------------------------------------
           Save localStorage
           ----------------------------------------------- */

        localStorage.setItem(
          "customer_name",
          fullName
        );


        localStorage.setItem(
          "customer_phone",
          phone
        );


'''
if old not in t: raise SystemExit('account save local pattern not found')
t=t.replace(old,'',1)
old='''      } finally {


        /*
         * Always return to homepage.
         */'''
new='''      } finally {


        /* Clear legacy browser-stored profile PII on sign-out. */
        localStorage.removeItem("customer_name");
        localStorage.removeItem("customer_phone");

        /*
         * Always return to homepage.
         */'''
if old not in t: raise SystemExit('account logout pattern not found')
p.write_text(t.replace(old,new,1),encoding='utf-8')

Path('scripts/check_source.js').write_text('''const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const htmlFiles=fs.readdirSync(root).filter(f=>f.endsWith('.html')&&!f.startsWith('google'));
const jsFiles=fs.readdirSync(root).filter(f=>f.endsWith('.js'));
let errors=[];
const localRef=/\\b(?:src|href)=["']([^"']+)["']/gi;
for(const file of htmlFiles){
  const full=path.join(root,file),text=fs.readFileSync(full,'utf8');
  if(/Fashion_FUSSION/.test(text))errors.push(`${file}: obsolete brand Fashion_FUSSION`);
  if(/₹599|DELIVERY_THRESHOLD\\s*=\\s*599|Same-week dispatch/i.test(text))errors.push(`${file}: obsolete delivery/copy value`);
  if(/cdn\\.jsdelivr\\.net\\/npm\\/@supabase\\/supabase-js@2(?!\\.116\\.0)/.test(text))errors.push(`${file}: Supabase browser SDK must be pinned to 2.116.0`);
  if(/localStorage\\.(?:setItem|getItem)\\(\\s*["']customer_(?:name|phone)["']/.test(text))errors.push(`${file}: profile PII must not persist in localStorage`);
  let ref; while((ref=localRef.exec(text))){const value=ref[1];if(/^(?:https?:|mailto:|tel:|#|javascript:|data:|\\/\\/)/i.test(value))continue;const clean=value.split('#')[0].split('?')[0];if(clean&&!fs.existsSync(path.join(root,clean)))errors.push(`${file}: missing local reference ${value}`)}
  const re=/<script(?![^>]*\\bsrc=)[^>]*>([\\s\\S]*?)<\\/script>/gi; let m,i=0;
  while((m=re.exec(text))){i++;try{new vm.Script(m[1],{filename:`${file}:inline-script-${i}`})}catch(e){errors.push(e.message)}}
}
for(const file of jsFiles){const full=path.join(root,file),text=fs.readFileSync(full,'utf8');if(/localStorage\\.(?:setItem|getItem)\\(\\s*["']customer_(?:name|phone)["']/.test(text))errors.push(`${file}: profile PII must not persist in localStorage`);try{new vm.Script(text,{filename:file})}catch(e){errors.push(e.message)}}
const lib=fs.readFileSync(path.join(root,'backend/lib.js'),'utf8');
if(/GST_RATES|GST_MAX_SUPPORTED_ID/.test(lib))errors.push('backend/lib.js: hardcoded product GST map detected');
if(/\\.select\\(["'](?:[^"']*,)?cost(?:,|["'])/.test(fs.readFileSync(path.join(root,'index.html'),'utf8')))errors.push('index.html: product cost must not be public');
if(errors.length){console.error(errors.join('\\n'));process.exit(1)}
console.log(`Source quality checks passed (${htmlFiles.length} HTML, ${jsFiles.length} JS)`);
''',encoding='utf-8')
