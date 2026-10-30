import { onRequestPost as dispatchCrmEmailReply } from './outreach/crm-email-reply-dispatch.js';
import { onRequestPost as dispatchCrmWhatsAppReply } from './outreach/crm-whatsapp-reply-dispatch.js';
function json(body,status,origin,headers={}) {
  return new Response(JSON.stringify(body),{status,headers:{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin',
    ...(origin?{'Access-Control-Allow-Origin':origin}:{}),...headers
  }});
}
function allowedOrigins(env) {
  return [...new Set(String(env.ALLOWED_ORIGIN||'').split(',').map(v=>v.trim()).filter(Boolean))];
}
export async function onRequestOptions({request,env}) {
  const origin=request.headers.get('Origin')||'';
  if(origin&&!allowedOrigins(env).includes(origin))return json({ok:false,error:'Origin not allowed'},403,'');
  return new Response(null,{status:204,headers:{
    ...(origin?{'Access-Control-Allow-Origin':origin}:{}),
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Max-Age':'600','Cache-Control':'no-store','Vary':'Origin'
  }});
}
export async function onRequestPost({request,env}) {
  const origin=request.headers.get('Origin')||'';
  if(origin&&!allowedOrigins(env).includes(origin))return json({ok:false,error:'Origin not allowed'},403,'');
  const authorization=request.headers.get('Authorization')||'';
  if(!authorization.startsWith('Bearer ')||!authorization.slice(7).trim())
    return json({ok:false,error:'Please sign in again'},401,origin);
  const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=String(env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY||'');
  if(!base||!key||!allowedOrigins(env).length)
    return json({ok:false,error:'CRM support inbox is not configured'},503,origin);
  let input;
  try{input=await request.json()}catch{return json({ok:false,error:'Invalid request'},400,origin);}
  if(!input||typeof input!=='object'||Array.isArray(input))
    return json({ok:false,error:'Invalid request'},400,origin);
  const action=input.action;
  let rpc,body;
  if(action==='snapshot'&&Object.keys(input).length===1){
    rpc='admin_crm_whatsapp_support_snapshot';body={};
  }else if(action==='snapshot_email'&&Object.keys(input).length===1){
    rpc='admin_crm_email_support_snapshot';body={};
  }else if(action==='classify_email'&&Object.keys(input).sort().join(',')==='action,inboundEventId'
    &&Number.isSafeInteger(input.inboundEventId)&&input.inboundEventId>0){
    rpc='admin_crm_classify_email_event';body={p_inbound_event_id:input.inboundEventId};
  }else if(action==='classify_whatsapp'&&Object.keys(input).sort().join(',')==='action,inboundEventId,senderRole'
    &&Number.isSafeInteger(input.inboundEventId)&&input.inboundEventId>0
    &&['customer','seller','admin'].includes(input.senderRole)){
    rpc='admin_crm_classify_whatsapp_event';body={p_inbound_event_id:input.inboundEventId,p_sender_role:input.senderRole};
  }else if(action==='approve_email_reply'&&Object.keys(input).sort().join(',')==='action,replyId'
    &&Number.isSafeInteger(input.replyId)&&input.replyId>0){
    rpc='admin_crm_approve_email_reply';body={p_reply_id:input.replyId};
  }else if(action==='approve_reply'&&Object.keys(input).sort().join(',')==='action,replyId'
    &&Number.isSafeInteger(input.replyId)&&input.replyId>0){
    rpc='admin_crm_approve_whatsapp_reply';body={p_reply_id:input.replyId};
  }else if(action==='send_approved_reply'&&Object.keys(input).sort().join(',')==='action,replyId'
    &&Number.isSafeInteger(input.replyId)&&input.replyId>0){
    rpc='__dispatch_whatsapp';body={replyId:input.replyId};
  }else if(action==='send_approved_email_reply'&&Object.keys(input).sort().join(',')==='action,replyId'
    &&Number.isSafeInteger(input.replyId)&&input.replyId>0){
    rpc='__dispatch_email';body={replyId:input.replyId};
  }else if(action==='queue_email_reply'&&Object.keys(input).sort().join(',')==='action,fromEmail,inboundEventId,replyText,requestKey'
    &&Number.isSafeInteger(input.inboundEventId)&&input.inboundEventId>0
    &&typeof input.replyText==='string'&&input.replyText.trim().length>=1
    &&input.replyText.trim().length<=10000
    &&typeof input.requestKey==='string'&&/^[A-Za-z0-9._:-]{8,160}$/.test(input.requestKey)
    &&typeof input.fromEmail==='string'&&['customer.care@fashionfussion.in','seller.support@fashionfussion.in','sales.team@fashionfussion.in','orders@fashionfussion.in'].includes(input.fromEmail.toLowerCase())){
    rpc='admin_crm_queue_email_reply';
    body={p_inbound_event_id:input.inboundEventId,p_reply_text:input.replyText.trim(),p_request_key:input.requestKey,p_from_email:input.fromEmail.toLowerCase()};
  }else if(action==='queue_reply'&&Object.keys(input).sort().join(',')==='action,inboundEventId,replyText,requestKey'
    &&Number.isSafeInteger(input.inboundEventId)&&input.inboundEventId>0
    &&typeof input.replyText==='string'&&input.replyText.trim().length>=1
    &&input.replyText.trim().length<=1000
    &&typeof input.requestKey==='string'&&/^[A-Za-z0-9._:-]{8,160}$/.test(input.requestKey)){
    rpc='admin_crm_queue_whatsapp_reply';
    body={p_inbound_event_id:input.inboundEventId,p_reply_text:input.replyText.trim(),p_request_key:input.requestKey};
  }else if(action==='assign_team'&&Object.keys(input).sort().join(',')==='action,active,teamKey,userId'
    &&typeof input.userId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.userId)
    &&['customer_support','seller_support','sales_marketing'].includes(input.teamKey)
    &&typeof input.active==='boolean'){
    rpc='admin_crm_set_whatsapp_team_member';
    body={p_user_id:input.userId,p_team_key:input.teamKey,p_active:input.active};
  }else return json({ok:false,error:'Invalid support inbox action'},400,origin);
  try{
    const userResponse=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:authorization}});
    const user=await userResponse.json().catch(()=>null);
    if(!userResponse.ok||!user?.id)return json({ok:false,error:'Please sign in again'},401,origin);
  const headers={apikey:key,Authorization:authorization,'Content-Type':'application/json',Accept:'application/json'};
  if(action==='snapshot'||action==='snapshot_email'){
    let stage='role_lookup';
    try{
      const roleResponse=await fetch(base+'/rest/v1/rpc/crm_whatsapp_actor_team',{
        method:'POST',headers,body:JSON.stringify({})
      });
      const actor=await roleResponse.json().catch(()=>null);
      if(!roleResponse.ok||typeof actor!=='string'){
        console.error('CRM inbox role lookup failed',roleResponse.status);
        return json({ok:false,error:roleResponse.status===401?'Please sign in again':'CRM team access is missing or role lookup failed'},roleResponse.status===401?401:403,origin);
      }
      const actorTeam=actor;
      const isAdmin=actorTeam==='admin_operations';
      if(!isAdmin&&!['customer_support','seller_support','sales_marketing'].includes(actorTeam))
        return json({ok:false,error:'Active CRM team access is required'},403,origin);
      stage='inbox_query';
      const provider=action==='snapshot'?'whatsapp':'email';
      const select='id,provider,provider_thread_id,provider_message_id,department,contact_type,contact_name,contact_email,contact_phone,inbox_address,subject,latest_message,received_at,status,priority,assigned_to,metadata';
      const inboxResponse=await fetch(base+'/rest/v1/crm_inbox_conversations?select='+encodeURIComponent(select)+'&provider=eq.'+provider+'&order=received_at.desc&limit=100',{
        headers:{...headers,Prefer:'count=exact'}
      });
      const conversations=await inboxResponse.json().catch(()=>null);
      if(!inboxResponse.ok||!Array.isArray(conversations)){
        console.error('CRM inbox query failed',provider,inboxResponse.status);
        return json({ok:false,error:'CRM inbox data query failed. Check table grants and department policies.'},503,origin);
      }
      const canRead=(c)=>isAdmin
        ||c.department===actorTeam
        ||(actorTeam==='sales_marketing'&&(['sales','marketing'].includes(c.department)||String(c.inbox_address||'').trim().toLowerCase()==='sales.team@fashionfussion.in'));
      const scoped=conversations.filter(canRead);
      const recent=scoped.map(c=>({
        id:Number(c.id),
        support_team:['sales','marketing'].includes(c.department)?'sales_marketing':c.department,
        routing_status:c.status||'open',
        sender_role:c.contact_type||'unknown',
        sender_phone:c.contact_phone||'',
        sender_email:c.contact_email||'',
        recipient_email:c.inbox_address||'',
        subject:c.subject||'',
        message_type:c.provider,
        message_text:c.latest_message||'',
        created_at:c.received_at,
        received_at:c.received_at,
        latest_reply_status:'Reply actions disabled',
        latest_reply_id:null,
        contact_name:c.contact_name||'',
        priority:c.priority||'normal'
      }));
      const count=(team)=>recent.filter(c=>c.support_team===team).length;
      return json({ok:true,data:{
        recent,actor_team:actorTeam,is_admin:isAdmin,generated_at:new Date().toISOString(),
        queues:{
          customer_support:isAdmin||actorTeam==='customer_support'?count('customer_support'):0,
          seller_support:isAdmin||actorTeam==='seller_support'?count('seller_support'):0,
          sales_marketing:isAdmin||actorTeam==='sales_marketing'?count('sales_marketing'):0,
          admin_operations:isAdmin?count('admin_operations'):0,
          needs_review:recent.filter(c=>c.routing_status==='needs_review').length
        }
      }},200,origin);
    }catch(error){
      console.error('CRM inbox snapshot failed',stage,error instanceof Error?error.message:'unknown');
      return json({ok:false,error:stage==='role_lookup'?'CRM role lookup failed. Please sign in again.':'CRM inbox could not load. Check database permissions and try refresh.'},503,origin);
    }
  }
  if(rpc==='__dispatch_whatsapp'||rpc==='__dispatch_email'){
      const profileResponse=await fetch(base+'/rest/v1/profiles?id=eq.'+encodeURIComponent(user.id)+'&select=is_admin&limit=1',
        {headers:{apikey:key,Authorization:authorization,Accept:'application/json'}});
      const profiles=await profileResponse.json().catch(()=>[]);
      if(!profileResponse.ok||profiles?.[0]?.is_admin!==true)
        return json({ok:false,error:'Administrator approval is required to send replies'},403,origin);
      const internalToken=String(rpc==='__dispatch_whatsapp'?env.CRM_WHATSAPP_REPLY_INTERNAL_TOKEN||'':env.CRM_EMAIL_REPLY_INTERNAL_TOKEN||'');
      if(internalToken.length<40)return json({ok:false,error:'Reply dispatcher is not configured'},503,origin);
      const dispatchRequest=new Request(new URL(request.url).toString(),{method:'POST',
        headers:{Authorization:'Bearer '+internalToken,'Content-Type':'application/json'},
        body:JSON.stringify({replyId:body.replyId,dryRun:false})});
      const dispatchResponse=await (rpc==='__dispatch_whatsapp'?dispatchCrmWhatsAppReply:dispatchCrmEmailReply)({request:dispatchRequest,env});
      const dispatchData=await dispatchResponse.json().catch(()=>({}));
      return json({ok:dispatchResponse.ok,...dispatchData},dispatchResponse.status,origin);
    }
    // Authorization is enforced inside the SECURITY DEFINER RPC using auth.uid().
    // This permits scoped team members without exposing the broader admin CRM.
    const response=await fetch(base+'/rest/v1/rpc/'+rpc,{method:'POST',headers,body:JSON.stringify(body)});
    if(!response.ok)return json({ok:false,error:response.status===401?'Please sign in again':
      response.status===403?'CRM team access is missing or this conversation belongs to another queue':
      response.status===22023?'Invalid reply request':'WhatsApp support inbox is temporarily unavailable'},
      response.status===401?401:response.status===403?403:503,origin);
    const data=await response.json().catch(()=>null);
    return json({ok:true,data:data&&typeof data==='object'?data:{}},200,origin);
  }catch{return json({ok:false,error:'WhatsApp support inbox is temporarily unavailable'},503,origin);}
}
export async function onRequest({request}) {
  return json({ok:false,error:'Method not allowed'},405,request.headers.get('Origin')||'',{
    'Allow':'POST, OPTIONS','Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization'
  });
}
