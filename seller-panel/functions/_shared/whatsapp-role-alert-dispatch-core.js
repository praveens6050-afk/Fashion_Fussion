const TEMPLATES = Object.freeze({
  seller: {
    name: 'seller_order_received',
    body: 'New Fashion Fussion order {{1}} has been received for your store. Please review it in your seller panel.',
    flag: 'WHATSAPP_SELLER_ALERT_SENDING_ENABLED',
    approval: 'WHATSAPP_SELLER_ALERT_GLOBAL_LAUNCH_APPROVED',
    acknowledgement: 'WHATSAPP_SELLER_ALERT_GLOBAL_LAUNCH_ACK',
    ackValue: 'verified_seller_alerts_v1',
    cutoff: 'WHATSAPP_SELLER_ALERT_NOT_BEFORE',
    token: 'WHATSAPP_SELLER_ALERT_INTERNAL_TOKEN',
    table: 'whatsapp_seller_order_notification_outbox',
    rpcClaim: 'claim_whatsapp_seller_order_alert',
    rpcFinish: 'finish_whatsapp_seller_order_alert'
  },
  admin: {
    name: 'fashion_fussion_admin_alert',
    body: 'Fashion Fussion operational alert: {{1}}. Reference: {{2}}.',
    flag: 'WHATSAPP_ADMIN_ALERT_SENDING_ENABLED',
    approval: 'WHATSAPP_ADMIN_ALERT_GLOBAL_LAUNCH_APPROVED',
    acknowledgement: 'WHATSAPP_ADMIN_ALERT_GLOBAL_LAUNCH_ACK',
    ackValue: 'verified_admin_alerts_v1',
    cutoff: 'WHATSAPP_ADMIN_ALERT_NOT_BEFORE',
    token: 'WHATSAPP_ADMIN_ALERT_INTERNAL_TOKEN',
    table: 'whatsapp_admin_alert_outbox',
    rpcClaim: 'claim_whatsapp_admin_alert',
    rpcFinish: 'finish_whatsapp_admin_alert'
  }
});
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'
}});
async function equalSecret(request,expected,min=40){
  if(typeof expected!=='string'||expected.length<min)return false;
  const h=request.headers.get('authorization')||'', supplied=h.startsWith('Bearer ')?h.slice(7):'';
  if(supplied.length<min)return false;
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',new TextEncoder().encode(supplied)),
    crypto.subtle.digest('SHA-256',new TextEncoder().encode(expected))]);
  const x=new Uint8Array(a),y=new Uint8Array(b);let diff=0;
  for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  return diff===0;
}
function cutoff(env,cfg){
  const s=String(env[cfg.cutoff]||'').trim();
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s))return null;
  const n=Date.parse(s);
  if(!Number.isFinite(n)||n>Date.now()||n<Date.parse('2026-10-01T00:00:00Z'))return null;
  const iso=new Date(n).toISOString();
  return (s.length===20?iso.replace('.000Z','Z'):iso)===s?s:null;
}
function database(env){
  const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'').trim();
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!key)return null;
  return {base,key};
}
async function dbCall(db,path,body){
  const r=await fetch(db.base+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',cache:'no-store',
    headers:{apikey:db.key,Authorization:'Bearer '+db.key,Accept:'application/json','content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!r.ok)throw Error('DB_UNAVAILABLE');
  return r.json();
}
function configured(env,cfg){
  return env[cfg.flag]==='true'&&env[cfg.approval]==='true'&&env[cfg.acknowledgement]===cfg.ackValue
    &&env.WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED==='true'
    &&env.WHATSAPP_ORDER_GLOBAL_LAUNCH_ACK==='verified_opt_in_orders_v1'
    &&/^[0-9]{13,25}$/.test(String(env.WHATSAPP_PHONE_NUMBER_ID||''))
    &&/^v\d{1,2}\.\d{1,2}$/.test(String(env.WHATSAPP_GRAPH_VERSION||''))
    &&String(env.WHATSAPP_ACCESS_TOKEN||'').length>=20
    &&String(env.WHATSAPP_ALLOWED_TEMPLATES||'').split(',').some(v=>v.trim()===cfg.name)
    &&cutoff(env,cfg)!==null;
}
async function verifyTemplate(env,cfg){
  const version=String(env.WHATSAPP_GRAPH_VERSION||''),waba=String(env.WHATSAPP_BUSINESS_ACCOUNT_ID||'');
  const phone=String(env.WHATSAPP_PHONE_NUMBER_ID||''),token=String(env.WHATSAPP_ACCESS_TOKEN||'');
  if(!/^v\d{1,2}\.\d{1,2}$/.test(version)||!/^[0-9]{10,25}$/.test(waba)
    ||!/^[0-9]{13,25}$/.test(phone)||token.length<20)return false;
  try{
    const paths=[
      'https://graph.facebook.com/'+version+'/'+waba+'/message_templates?'+new URLSearchParams({name:cfg.name,fields:'name,status,language,category,components',limit:'100'}),
      'https://graph.facebook.com/'+version+'/'+waba+'/phone_numbers?'+new URLSearchParams({fields:'id',limit:'100'})
    ];
    const responses=await Promise.all(paths.map(url=>fetch(url,{method:'GET',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'}})));
    if(responses.some(r=>!r.ok))return false;
    const [templates,numbers]=await Promise.all(responses.map(r=>r.json()));
    if(!Array.isArray(templates?.data)||!Array.isArray(numbers?.data)||templates.paging?.next||numbers.paging?.next)return false;
    const matches=templates.data.filter(t=>t?.name===cfg.name&&t?.language==='en');
    if(matches.length!==1)return false;
    const t=matches[0],components=Array.isArray(t.components)?t.components:[];
    const body=components.filter(c=>String(c?.type||'').toUpperCase()==='BODY');
    const headers=components.filter(c=>String(c?.type||'').toUpperCase()==='HEADER');
    const footers=components.filter(c=>String(c?.type||'').toUpperCase()==='FOOTER');
    const extras=components.filter(c=>!['BODY','HEADER','FOOTER'].includes(String(c?.type||'').toUpperCase()));
    const staticHeader=headers.length<=1&&headers.every(c=>String(c.format||'').toUpperCase()==='TEXT'&&String(c.text||'').trim()==='Fashion Fussion'&&!c.example);
    const staticFooter=footers.length<=1&&footers.every(c=>String(c.text||'').trim()==='Fashion Fussion');
    return t.status==='APPROVED'&&String(t.category||'').toUpperCase()==='UTILITY'
      &&body.length===1&&String(body[0].text||'').replace(/\s+/g,' ').trim()===cfg.body
      &&staticHeader&&staticFooter&&extras.length===0
      &&numbers.data.some(n=>String(n?.id||'')===phone);
  }catch{return false;}
}
function safeText(value,max){return String(value||'').replace(/[\r\n\t]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
async function sendTemplate(env,cfg,claim){
  const params=cfg.name==='seller_order_received'
    ?[safeText(claim.displayOrderId,80)]
    :[safeText(claim.alertType,60),safeText(claim.referenceCode,80)];
  if(params.some(x=>!x)||!(/^\+[1-9]\d{7,14}$/.test(String(claim.recipientPhone||''))))return {id:null,code:'INVALID_CLAIM'};
  const payload={messaging_product:'whatsapp',recipient_type:'individual',to:claim.recipientPhone.slice(1),
    type:'template',template:{name:cfg.name,language:{code:'en'},components:[{type:'body',parameters:params.map(text=>({type:'text',text}))}]}};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
  try{
    const r=await fetch('https://graph.facebook.com/'+env.WHATSAPP_GRAPH_VERSION+'/'+env.WHATSAPP_PHONE_NUMBER_ID+'/messages',{
      method:'POST',signal:controller.signal,redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await r.json().catch(()=>null),id=String(data?.messages?.[0]?.id||'');
    if(r.ok&&/^wamid\.[^\s]+$/.test(id)&&id.length<=255)return {id,code:null};
    return {id:null,code:r.ok?'PROVIDER_OUTCOME_UNKNOWN':'META_REJECTED'};
  }catch{return {id:null,code:'PROVIDER_OUTCOME_UNKNOWN'};}finally{clearTimeout(timer);}
}
export async function dispatchRoleAlert(request,env,role){
  const cfg=TEMPLATES[role];if(!cfg)return reply({error:'Unsupported role'},404);
  let input;try{input=await request.json()}catch{return reply({error:'Invalid JSON'},400);}
  const keys=input&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input):[];
  const dry=keys.length===1&&input.dryRun===true,dispatch=keys.length===1&&input.dispatch===true;
  if(!dry&&!dispatch)return reply({error:'Only dryRun:true or dispatch:true accepted'},400);
  const authorized=await equalSecret(request,dry?String(env.OUTREACH_API_TOKEN||''):String(env[cfg.token]||''),dry?1:40);
  if(!authorized)return reply({error:'Unauthorized'},401);
  const db=database(env);if(!db)return reply({error:'Database unavailable',sent:0},503);
  const active=configured(env,cfg);
  const notBefore=cutoff(env,cfg);
  if(dispatch&&!active)return reply({armed:false,error:'Role alert dispatch not authorized',sent:0},423);
  try{
    const since=new Date(Math.max(Date.parse(notBefore||'2026-10-01T00:00:00Z'),Date.now()-23*60*60*1000)).toISOString();
    const params=new URLSearchParams({select:'id,created_at',status:'eq.ready',attempt_count:'eq.0',
      provider_message_id:'is.null',attempt_started_at:'is.null',order:'created_at.asc',limit:'20'});
    params.append('created_at','gte.'+since);params.append('created_at','lte.'+new Date().toISOString());
    const candidates=await dbCall(db,cfg.table+'?'+params);
    if(!Array.isArray(candidates))throw Error('BAD_QUEUE');
    if(dry)return reply({dryRun:true,armed:active,candidates:candidates.length,sent:0,requiresExplicitLaunch:true});
    if(!candidates.length)return reply({armed:true,claimed:0,providerAccepted:0,reviewRequired:0,skipped:0,autoRetry:false});
    if(!(await verifyTemplate(env,cfg)))return reply({armed:false,error:'Approved role template or sender preflight failed',claimed:0,providerAccepted:0,sent:0,autoRetry:false},423);
    let claimed=0,accepted=0,review=0,skipped=0;
    for(const row of candidates){
      if(claimed>=2)break;
      const outboxId=Number(row.id);if(!Number.isSafeInteger(outboxId)||outboxId<=0){skipped++;continue;}
      const claim=await dbCall(db,'rpc/'+cfg.rpcClaim,{p_outbox_id:outboxId,p_activation_cutoff:notBefore});
      if(!claim||!Number.isSafeInteger(Number(claim.outboxId))){skipped++;continue;}
      claimed++;
      let outcome={id:null,code:'PROVIDER_OUTCOME_UNKNOWN'};
      try{
        if(role==='seller'){
          const phone=encodeURIComponent(claim.recipientPhone);
          const consent=await dbCall(db,'whatsapp_contact_consents?phone_e164=eq.'+phone+'&purpose=eq.transactional&status=eq.opted_in&revoked_at=is.null&consented_at=not.is.null&select=phone_e164&limit=1');
          if(Array.isArray(consent)&&consent.length===1)outcome=await sendTemplate(env,cfg,claim);
          else outcome={id:null,code:'CONSENT_REVOKED'};
        }else outcome=await sendTemplate(env,cfg,claim);
      }catch{outcome={id:null,code:'PROVIDER_OUTCOME_UNKNOWN'};}
      try{
        const finished=await dbCall(db,'rpc/'+cfg.rpcFinish,{p_outbox_id:claim.outboxId,p_provider_message_id:outcome.id,p_error_code:outcome.code});
        if(finished!==true)review++;
      }catch{review++;}
      if(outcome.id)accepted++;if(outcome.code)review++;
    }
    return reply({armed:true,claimed,providerAccepted:accepted,reviewRequired:review,skipped,autoRetry:false,
      note:'Provider acceptance does not confirm delivery; uncertain outcomes are never retried.'});
  }catch{return reply({error:'Role alert dispatch unavailable',sent:0,reviewRequired:true},503);}
}
