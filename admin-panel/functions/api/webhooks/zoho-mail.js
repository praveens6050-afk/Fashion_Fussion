function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}})}
async function digest(value){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value||'')))}
async function secureEqual(a,b){const [x,y]=await Promise.all([digest(a),digest(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0}
function validEmail(v){return typeof v==='string'&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
export async function onRequestPost({request,env}){
 const secret=String(env.ZOHO_CRM_WEBHOOK_SECRET||'');
 const auth=request.headers.get('Authorization')||'';
 const submitted=auth.startsWith('Bearer ')?auth.slice(7):'';
 if(secret.length<40||!submitted||!await secureEqual(submitted,secret))return json({ok:false,error:'Unauthorized'},401);
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'');
 if(!base||!key)return json({ok:false,error:'Server integration is not configured'},503);
 const raw=await request.text();
 if(raw.length>30000)return json({ok:false,error:'Payload too large'},413);
 let input;try{input=JSON.parse(raw)}catch{return json({ok:false,error:'Invalid JSON'},400)}
 const allowed=['externalMessageId','from','fromName','to','subject','text','receivedAt'];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))||
    typeof input.externalMessageId!=='string'||input.externalMessageId.length<1||input.externalMessageId.length>255||
    !validEmail(input.from)||!validEmail(input.to)||
    typeof input.subject!=='string'||input.subject.length>500||
    typeof input.text!=='string'||input.text.length>20000||
    typeof input.receivedAt!=='string'||!Number.isFinite(Date.parse(input.receivedAt))||
    (input.fromName!==undefined&&(typeof input.fromName!=='string'||input.fromName.length>200)))
   return json({ok:false,error:'Invalid email event'},400);
 const recipient=String(input.to).toLowerCase();
 const routes={
   'customer.care@fashionfussion.in':'customer_support',
   'seller.support@fashionfussion.in':'seller_support',
   'sales.team@fashionfussion.in':'sales_marketing',
   'orders@fashionfussion.in':'admin_operations'
 };
 const team=routes[recipient];
 if(!team)return json({ok:false,error:'Recipient mailbox is not an approved CRM route'},403);
 const received=Date.parse(input.receivedAt);
 if(received>Date.now()+300000||received<Date.now()-90*86400000)return json({ok:false,error:'Email event is outside the accepted time window'},400);
 // The production Zoho Mail panel reads crm_email_inbound_events through
 // admin_crm_email_support_snapshot; use its secured intake RPC, not the
 // separate WhatsApp unified-inbox table.
 const response=await fetch(base+'/rest/v1/rpc/ingest_crm_email_message',{method:'POST',
   headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({
     p_external_message_id:input.externalMessageId,
     p_sender_email:input.from,
     p_recipient_email:recipient,
     p_subject:input.subject,
     p_message_text:input.text,
     p_received_at:new Date(received).toISOString()
   })});
 if(!response.ok){return json({ok:false,error:'Email intake is temporarily unavailable'},503)}
 const data=await response.json().catch(()=>null);
 if(!data||data.accepted!==true)return json({ok:false,error:'Email intake did not confirm storage'},503);
 return json({ok:true,stored:Boolean(data.inserted),data:{team:data.team,status:data.status,eventId:data.eventId}},200);
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:{'Allow':'POST, OPTIONS'}})}
export async function onRequest({request}){return json({ok:false,error:'Method not allowed'},405)}
