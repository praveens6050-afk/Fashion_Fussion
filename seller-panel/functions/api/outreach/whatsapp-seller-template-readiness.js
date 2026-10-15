// Operator-only, no-send Seller onboarding template check.
// Does not send marketing messages, register consent, touch orders or modify Meta.
const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,
  headers:{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function digest(input){
  return new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(String(input||''))));
}
async function authorized(request,env) {
  if(!env.OUTREACH_API_TOKEN)return false;
  const h=request.headers.get('authorization')||'';
  const submitted=h.startsWith('Bearer ')?h.slice(7):'';
  if(!submitted)return false;
  const [a,b]=await Promise.all([digest(submitted),digest(env.OUTREACH_API_TOKEN)]);
  let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];
  return mismatch===0;
}
function countBodyParameters(t) {
  const components=Array.isArray(t?.components)?t.components:[];
  const body=components.filter(c=>String(c?.type||'').toUpperCase()==='BODY');
  if(body.length!==1 || typeof body[0].text!=='string')return null;
  const matches=Array.from(body[0].text.matchAll(/{{\s*(\d+)\s*}}/g),
    x=>Number(x[1]));
  const unique=new Set(matches);
  // Do not approve parameter mapping merely on counts; always require
  // human review of actual seller marketing copy and lawful consent.
  return Number.isInteger(Math.max(...unique,0))?unique.size:null;
}
export async function onRequestGet({request,env}) {
  if(!(await authorized(request,env)))return respond({error:'Unauthorized'},401);
  const version=String(env.WHATSAPP_GRAPH_VERSION||'').trim();
  const waba=String(env.WHATSAPP_BUSINESS_ACCOUNT_ID||'').trim();
  const phone=String(env.WHATSAPP_PHONE_NUMBER_ID||'').trim();
  const token=String(env.WHATSAPP_ACCESS_TOKEN||'');
  const name=String(env.WHATSAPP_SELLER_ONBOARDING_TEMPLATE||'').trim();
  const allowed=new Set(String(env.WHATSAPP_ALLOWED_TEMPLATES||'')
    .split(',').map(x=>x.trim()).filter(Boolean));
  const missing=[];
  if(!/^v\d{1,2}\.\d{1,2}$/.test(version))missing.push('WHATSAPP_GRAPH_VERSION');
  if(!/^[0-9]{10,25}$/.test(waba))missing.push('WHATSAPP_BUSINESS_ACCOUNT_ID');
  if(!/^[0-9]{13,25}$/.test(phone))missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if(token.length<20)missing.push('WHATSAPP_ACCESS_TOKEN');
  if(!/^[a-z][a-z0-9_]{0,511}$/.test(name))missing.push('WHATSAPP_SELLER_ONBOARDING_TEMPLATE');
  if(!allowed.has(name))missing.push('WHATSAPP_ALLOWED_TEMPLATES_SELLER_ONBOARDING');
  if(missing.length)return respond({dryRun:true,messagesSent:0,ready:false,
    issue:'CONFIGURATION_INCOMPLETE',missing});
  try {
    const q=new URLSearchParams({name,fields:'name,status,language,category,components',limit:'100'});
    const p=new URLSearchParams({fields:'id',limit:'100'});
    const urls=[
      'https://graph.facebook.com/'+version+'/'+waba+'/message_templates?'+q,
      'https://graph.facebook.com/'+version+'/'+waba+'/phone_numbers?'+p
    ];
    const data=await Promise.all(urls.map(async url=>{
      const r=await fetch(url,{method:'GET',redirect:'error',cache:'no-store',
        headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      if(!r.ok)throw Error('META_READ_FAILED');
      const body=await r.json();
      if(!Array.isArray(body?.data))throw Error('INVALID_META_RESULT');
      return body;
    }));
    const selected=data[0].data.filter(t=>t?.name===name && t.language==='en');
    const t=selected.length===1?selected[0]:null;
    const phoneInWaba=data[1].data.some(n=>String(n?.id||'')===phone);
    const complete=!data[0].paging?.next&&!data[1].paging?.next;
    const approved=t?.status==='APPROVED'
      && String(t?.category||'').toUpperCase()==='MARKETING';
    const bodyParameterCount=countBodyParameters(t);
    const checks={
      nameAndEnglishMatch:selected.length===1,
      metaApproved:t?.status==='APPROVED',
      marketingCategory:String(t?.category||'').toUpperCase()==='MARKETING',
      phoneNumberInBusiness:phoneInWaba,
      paginationComplete:complete,
      bodyParametersInspectible:bodyParameterCount!==null
    };
    const configurationValid=approved&&phoneInWaba&&complete
      &&checks.nameAndEnglishMatch&&checks.bodyParametersInspectible;
    return respond({
      dryRun:true,messagesSent:0,templateName:name,
      metaConfigurationValid:configurationValid,
      readyForSending:false,manualCopyReviewRequired:true,
      recipientMarketingConsentRequired:true,
      bodyParameterCount,
      checks,
      note:'Meta configuration only. A template approval is NOT recipient consent or authority to send.'
    });
  }catch{
    return respond({dryRun:true,messagesSent:0,readyForSending:false,
      error:'META_READ_UNAVAILABLE'},503);
  }
}
export function onRequestPost(){return respond({error:'Read-only GET required'},405)}
