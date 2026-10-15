// Private order-confirmed WhatsApp dispatcher. DEFAULT: NO SEND.
// Strict explicit launch gates, verified order+consent at DB claim time,
// rate capped, at most one Meta provider submission per order/event.
// Operator bearer grants read-only dry run, not sending authority.
const respond=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff'
}});
const MAX_PER_TICK=2;
function digest(v){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v||''))).then(x=>new Uint8Array(x));}
async function matchBearer(request,expected,minLength){
 if(typeof expected!=='string'||expected.length<minLength)return false;
 const header=request.headers.get('authorization')||'';
 const supplied=header.startsWith('Bearer ')?header.slice(7):'';
 if(supplied.length<minLength)return false;
 const [a,b]=await Promise.all([digest(supplied),digest(expected)]);
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 return diff===0;
}
function cutoff(raw){
 const s=String(raw||'').trim();
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s))return null;
 const n=Date.parse(s);
 if(!Number.isFinite(n)||n>Date.now()||n<Date.parse('2026-10-01T00:00:00Z'))return null;
 const canon=new Date(n).toISOString();
 return (s.length===20?canon.replace('.000Z','Z'):canon)===s?s:null;
}
function graphVersion(env){return String(env.WHATSAPP_GRAPH_VERSION||env.WHATSAPP_API_VERSION||'');}
function ready(env){
 const allowlist=new Set(String(env.WHATSAPP_ALLOWED_TEMPLATES||'').split(',').map(x=>x.trim()));
 return env.WHATSAPP_ORDER_CONFIRMATION_SENDING_ENABLED==='true' &&
   env.WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED==='true' &&
   env.WHATSAPP_ORDER_GLOBAL_LAUNCH_ACK==='verified_opt_in_orders_v1' &&
   /^[0-9]{13,25}$/.test(String(env.WHATSAPP_PHONE_NUMBER_ID||'')) &&
   /^[0-9]{13,25}$/.test(String(env.WHATSAPP_BUSINESS_ACCOUNT_ID||'')) &&
   /^v\d+\.\d+$/.test(graphVersion(env)) &&
   String(env.WHATSAPP_ACCESS_TOKEN||'').length>=20 &&
   allowlist.has('order_status_update') &&
   cutoff(env.WHATSAPP_ORDER_CONFIRMATION_NOT_BEFORE)!==null;
}
async function approvedOrderTemplate(env){
 // Validate actual Meta approval and signature BEFORE the first DB claim.
 // A merely allowlisted template name is not proof of Meta approval.
 const version=graphVersion(env), waba=String(env.WHATSAPP_BUSINESS_ACCOUNT_ID||'');
 if(!/^v\d+\.\d+$/.test(version)||!/^[0-9]{13,25}$/.test(waba)||
   String(env.WHATSAPP_ACCESS_TOKEN||'').length<20)return false;
 const u=new URL('https://graph.facebook.com/'+version+'/'+waba+'/message_templates');
 u.searchParams.set('name','order_status_update');
 u.searchParams.set('fields','name,status,language,category,components');
 u.searchParams.set('limit','50');
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),8000);
 try{
   const response=await fetch(u.toString(),{
     method:'GET',redirect:'error',signal:controller.signal,cache:'no-store',
     headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,Accept:'application/json'}
   });
   if(!response.ok)return false;
   const d=await response.json().catch(()=>null);
   const templates=Array.isArray(d?.data)?d.data:[];
   // Fail closed if the approval API is incomplete/ambiguous or there are
   // multiple templates with the same name and language.
   const matches=templates.filter(t=>t?.name==='order_status_update' && t?.language==='en');
   if(matches.length!==1)return false;
   const t=matches[0];
   if(t.status!=='APPROVED'||t.category!=='UTILITY'||!Array.isArray(t.components))return false;
   const bodies=t.components.filter(x=>x?.type==='BODY');
   if(bodies.length!==1||typeof bodies[0].text!=='string')return false;
   const vars=[...bodies[0].text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m=>Number(m[1]));
   if(JSON.stringify(vars)!=='[1,2,3]')return false;
   // We do not provide dynamic header or button parameters; disallow them.
   for(const component of t.components){
     if(component?.type==='HEADER' && component.format && component.format!=='TEXT')return false;
     if(component?.type==='HEADER' && /\{\{\s*\d+\s*\}\}/.test(String(component.text||'')))return false;
     if(component?.type==='BUTTONS' && Array.isArray(component.buttons) && component.buttons.some(b=>
       /\{\{\s*\d+\s*\}\}/.test(String(b?.url||'')) ))return false;
   }
   return true;
 }catch{return false}
 finally{clearTimeout(timeout)}
}
function database(env){
 const key=String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'').trim();
 const raw=String(env.SUPABASE_URL||'').trim().replace(/\/$/,'');
 if(!key||!raw)return null;
 try{const u=new URL(raw);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||
   u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)return null;
   return {base:raw,key};
 }catch{return null;}
}
async function postgrest(db,path,body){
 const r=await fetch(db.base+'/rest/v1/'+path,{
  method:body===undefined?'GET':'POST',cache:'no-store',
  headers:{apikey:db.key,Authorization:'Bearer '+db.key,Accept:'application/json',
   'content-type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 if(!r.ok)throw Error('Database request failed');
 return r.json();
}
async function validConsent(db,claim,orderId){
 const f='order_id=eq.'+orderId+'&phone_e164=eq.'+encodeURIComponent(claim.recipientPhone)+
   '&revoked_at=is.null&select=order_id&limit=1';
 const orders=await postgrest(db,'whatsapp_order_consents?'+f);
 const c='phone_e164=eq.'+encodeURIComponent(claim.recipientPhone)+
  '&purpose=eq.transactional&status=eq.opted_in&revoked_at=is.null&select=phone_e164&limit=1';
 const contacts=await postgrest(db,'whatsapp_contact_consents?'+c);
 return Array.isArray(orders)&&orders.length===1&&Array.isArray(contacts)&&contacts.length===1;
}
function param(value,max){
 const s=String(value||'').replace(/[\r\n\t]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
 return s;
}
async function submitMeta(env,claim){
 const name=param(claim.customerName,70), order=param(claim.displayOrderId,80);
 if(!name||!order||!(/^\+[1-9]\d{7,14}$/.test(String(claim.recipientPhone))))
  return {id:null,code:'INVALID_CLAIM'};
 const payload={
  messaging_product:'whatsapp',recipient_type:'individual',to:claim.recipientPhone.slice(1),
  type:'template',template:{name:'order_status_update',language:{code:'en'},
   components:[{type:'body',parameters:[
    {type:'text',text:name},{type:'text',text:order},{type:'text',text:'Confirmed'}
   ]}]
  }
 };
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),9000);
 try{
  const r=await fetch('https://graph.facebook.com/'+graphVersion(env)+'/'
   +env.WHATSAPP_PHONE_NUMBER_ID+'/messages',{
    method:'POST',signal:controller.signal,redirect:'error',
    headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,
      'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>null);
  const id=String(data?.messages?.[0]?.id||'');
  if(r.ok&&/^wamid\.[^\s]+$/.test(id)&&id.length<=255)return {id,code:null};
  // When Meta reports HTTP 200 but no verifiable message ID, outcome is unknown.
  return {id:null,code:r.ok?'PROVIDER_OUTCOME_UNKNOWN':'META_REJECTED'};
 }catch{
  // Network failures may have been submitted. Never retry automatically.
  return {id:null,code:'PROVIDER_OUTCOME_UNKNOWN'};
 }finally{clearTimeout(timeout);}
}
export async function onRequestPost({request,env}){
 let body;
 try{body=await request.json()}catch{return respond({error:'Invalid JSON'},400);}
 const keys=body&&typeof body==='object'&&!Array.isArray(body)?Object.keys(body):[];
 const dryRun=keys.length===1&&body.dryRun===true;
 const dispatch=keys.length===1&&body.dispatch===true;
 if(!dryRun&&!dispatch)return respond({error:'Only dryRun:true or dispatch:true accepted'},400);
 const ok=dispatch
   ?await matchBearer(request,env.WHATSAPP_ORDER_INTERNAL_TOKEN,40)
   :await matchBearer(request,env.OUTREACH_API_TOKEN,1);
 if(!ok)return respond({error:'Unauthorized'},401);
 const active=ready(env);
 const db=database(env);
 if(!db)return respond({error:'Database unavailable',sent:0},503);
 const notBefore=cutoff(env.WHATSAPP_ORDER_CONFIRMATION_NOT_BEFORE);
 if(dispatch&&!active)return respond({armed:false,error:'Global WhatsApp launch not authorized',sent:0},423);
 try{
  // Explicitly avoid historical candidates. DB claim repeats cutoff and age.
  // Dry run can inspect backlog without Meta credentials or launch approval.
  const after=new Date(Math.max(Date.parse(notBefore||'2026-10-01T00:00:00Z'),
      Date.now()-23*60*60*1000)).toISOString();
  const params=new URLSearchParams({
   select:'id,order_id,created_at',event_type:'eq.order_confirmed',
   status:'in.(pending_review,ready)',attempt_count:'eq.0',
   provider_message_id:'is.null',attempt_started_at:'is.null',
   order:'created_at.asc',limit:'20'
  });
  params.append('created_at','gte.'+after);
  params.append('created_at','lte.'+new Date().toISOString());
  const candidates=await postgrest(db,'whatsapp_order_notification_outbox?'+params);
  if(!Array.isArray(candidates))throw Error('Invalid queue response');
  if(dryRun){
    // This is read-only: it may inspect the Meta approved template if the WABA
    // ID is configured, but NEVER claims an order or sends any message.
    const templateVerified=await approvedOrderTemplate(env);
    return respond({dryRun:true,armed:active&&templateVerified,sent:0,
      templateVerified,candidates:candidates.length,requiresExplicitLaunch:true,
    missing: [
      ...(!env.WHATSAPP_ORDER_INTERNAL_TOKEN?['WHATSAPP_ORDER_INTERNAL_TOKEN']:[]),
      ...(!cutoff(env.WHATSAPP_ORDER_CONFIRMATION_NOT_BEFORE)?['WHATSAPP_ORDER_CONFIRMATION_NOT_BEFORE']:[]),
      ...(!env.WHATSAPP_ACCESS_TOKEN?['WHATSAPP_ACCESS_TOKEN']:[]),
      ...(!env.WHATSAPP_PHONE_NUMBER_ID?['WHATSAPP_PHONE_NUMBER_ID']:[]),
      ...(!graphVersion(env)?['WHATSAPP_GRAPH_VERSION_OR_WHATSAPP_API_VERSION']:[]),
      ...(!env.WHATSAPP_BUSINESS_ACCOUNT_ID?['WHATSAPP_BUSINESS_ACCOUNT_ID']:[]),
      ...(!String(env.WHATSAPP_ALLOWED_TEMPLATES||'').split(',').map(s=>s.trim()).includes('order_status_update')?['WHATSAPP_ALLOWED_TEMPLATES']:[])
    ]});
  }
  if(candidates.length>0 && !(await approvedOrderTemplate(env)))
    return respond({armed:false,error:'Meta-approved order template unavailable or schema mismatch',
      sent:0,claimed:0,autoRetry:false},424);
  let claimed=0,accepted=0,needsReview=0,skipped=0;
  for(const row of candidates){
   if(claimed>=MAX_PER_TICK)break;
   const id=Number(row.order_id);
   if(!Number.isSafeInteger(id)||id<=0){skipped++;continue;}
   const claim=await postgrest(db,'rpc/claim_whatsapp_order_confirmation',{
    p_order_id:id,p_activation_cutoff:notBefore
   });
   if(!claim||!Number.isSafeInteger(Number(claim.outboxId))){skipped++;continue;}
   claimed++;
   let outcome={id:null,code:'PROVIDER_OUTCOME_UNKNOWN'};
   try{
    if(await validConsent(db,claim,id))outcome=await submitMeta(env,claim);
    else outcome={id:null,code:'CONSENT_REVOKED'};
   }catch{outcome={id:null,code:'PROVIDER_OUTCOME_UNKNOWN'};}
   // Never expose phone, name, order ID, provider ID, or internal tokens.
   try{
    const finished=await postgrest(db,'rpc/finish_whatsapp_order_confirmation',{
      p_outbox_id:claim.outboxId,p_provider_message_id:outcome.id,
      p_error_code:outcome.code});
    if(finished!==true)needsReview++;
   }catch{needsReview++;}
   if(outcome.id)accepted++;
   if(outcome.code)needsReview++;
  }
  return respond({armed:true,dryRun:false,claimed,providerAccepted:accepted,
    reviewRequired:needsReview,skipped,autoRetry:false,
    note:'Provider acceptance is not final WhatsApp delivery'});
 }catch{
  return respond({error:'WhatsApp dispatch unavailable',sent:0,reviewRequired:true},503);
 }
}
export function onRequestGet(){return respond({error:'Method not allowed'},405);}
