function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})}
async function digest(v){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v||'')))}
async function equal(a,b){const[x,y]=await Promise.all([digest(a),digest(b)]);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0}
async function rpc(base,key,name,body){
 const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
 if(!r.ok)throw new Error('Database dispatch state update failed');return r.json();
}
export async function onRequestPost({request,env}){
 const secret=String(env.CRM_WHATSAPP_REPLY_INTERNAL_TOKEN||''),auth=request.headers.get('Authorization')||'',submitted=auth.startsWith('Bearer ')?auth.slice(7):'';
 if(secret.length<40||!submitted||!await equal(submitted,secret))return json({ok:false,error:'Unauthorized'},401);
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');const key=String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'');
 if(!base||!key)return json({ok:false,error:'Server database configuration missing'},503);
 let input;try{input=await request.json()}catch{return json({ok:false,error:'Invalid JSON'},400)}
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='replyId'&&k!=='dryRun')||!Number.isSafeInteger(input.replyId)||input.replyId<=0||typeof input.dryRun!=='boolean')return json({ok:false,error:'Invalid dispatch request'},400);
 const gates={sendingEnabled:env.CRM_WHATSAPP_REPLY_SENDING_ENABLED==='true',launchApproved:env.CRM_WHATSAPP_REPLY_GLOBAL_LAUNCH_APPROVED==='true',acknowledged:env.CRM_WHATSAPP_REPLY_GLOBAL_LAUNCH_ACK==='reviewed_support_reply_v1'};
 const config={accessTokenPresent:Boolean(env.WHATSAPP_ACCESS_TOKEN),phoneNumberIdValid:/^\d{13,25}$/.test(String(env.WHATSAPP_PHONE_NUMBER_ID||'')),graphVersionValid:/^v\d+\.\d+$/.test(String(env.WHATSAPP_GRAPH_VERSION||''))};
 if(input.dryRun)return json({ok:true,dryRun:true,readyToAttempt:false,gates,configPresenceOnly:config,messagesSent:0});
 if(!gates.sendingEnabled||!gates.launchApproved||!gates.acknowledged)return json({ok:false,error:'CRM WhatsApp reply launch gates are closed'},423);
 if(!config.accessTokenPresent||!config.phoneNumberIdValid||!config.graphVersionValid)return json({ok:false,error:'WhatsApp sender configuration is incomplete'},503);
 let claimed;
 try{
  const pre=await fetch(base+'/rest/v1/whatsapp_support_reply_outbox?id=eq.'+input.replyId+'&select=id,status,attempt_count,recipient_phone&limit=1',{headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}});
  const rows=await pre.json().catch(()=>[]);const row=Array.isArray(rows)?rows[0]:null;
  if(!pre.ok||!row||row.status!=='ready'||row.attempt_count!==0||!/^[0-9]{8,15}$/.test(row.recipient_phone||''))return json({ok:false,error:'Reply is not ready or recipient is invalid'},409);
  claimed=await rpc(base,key,'claim_crm_whatsapp_reply',{p_reply_id:input.replyId});
  if(!claimed?.claimed)return json({ok:false,error:'Reply window expired, identity review is required, or reply was already attempted'},409);
  if(!/^[0-9]{8,15}$/.test(claimed.toPhone||'')||typeof claimed.text!=='string'||!claimed.text.trim()||claimed.text.length>1000||String(claimed.phoneNumberId||'')!==String(env.WHATSAPP_PHONE_NUMBER_ID))throw new Error('Claimed reply validation failed or originating WhatsApp number mismatch');
  const url='https://graph.facebook.com/'+env.WHATSAPP_GRAPH_VERSION+'/'+env.WHATSAPP_PHONE_NUMBER_ID+'/messages';
  const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:claimed.toPhone,type:'text',text:{preview_url:false,body:claimed.text}})});
  const provider=await response.json().catch(()=>null);const id=provider?.messages?.[0]?.id;
  if(!response.ok||typeof id!=='string'||!/^wamid[.][^\s]+$/.test(id)){
   await rpc(base,key,'finish_crm_whatsapp_reply',{p_reply_id:input.replyId,p_provider_message_id:null,p_error_code:'META_SEND_REJECTED'});
   return json({ok:false,error:'Meta did not confirm acceptance; this reply will not be retried automatically'},502);
  }
  await rpc(base,key,'finish_crm_whatsapp_reply',{p_reply_id:input.replyId,p_provider_message_id:id,p_error_code:null});
  return json({ok:true,accepted:true,replyId:input.replyId,retryAllowed:false,message:'Meta accepted the WhatsApp reply. Delivery/read status is separate.'});
 }catch(error){
  if(claimed?.claimed){try{await rpc(base,key,'finish_crm_whatsapp_reply',{p_reply_id:input.replyId,p_provider_message_id:null,p_error_code:'PROVIDER_OUTCOME_UNCERTAIN'})}catch{}}
  return json({ok:false,error:'Dispatch failed or provider outcome is uncertain; automatic retry is disabled'},502);
 }
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:{'Allow':'POST, OPTIONS'}})}
export async function onRequest({request}){return json({ok:false,error:'Method not allowed'},405)}
