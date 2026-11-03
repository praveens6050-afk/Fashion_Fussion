// Authenticated CRM reply sender. Provider credentials are server-side only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const allowedOrigins = new Set(["https://www.crm.fashionfussion.in","https://crm.fashionfussion.in"]);
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const corsFor = (origin: string | null) => ({...corsHeaders,...(origin && allowedOrigins.has(origin) ? {"Access-Control-Allow-Origin": origin} : {})});
const response = (body: unknown, status=200, origin: string | null = null) => new Response(JSON.stringify(body), {status,headers:{...corsFor(origin),"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0,max);
const label: Record<string,string> = {customer_support:"Customer Support",seller_support:"Seller Support",sales:"Sales",marketing:"Marketing",orders:"Orders"};
const fromEnv = (role:string) => {
  const key = ({customer_support:"CRM_FROM_CUSTOMER_CARE",seller_support:"CRM_FROM_SELLER_SUPPORT",sales:"CRM_FROM_SALES_TEAM",marketing:"CRM_FROM_MARKETING",orders:"CRM_FROM_ORDERS"} as Record<string,string>)[role];
  const fallback = ({customer_support:"customer.care@fashionfussion.in",seller_support:"seller.support@fashionfussion.in",sales:"sales@fashionfussion.in",marketing:"marketing@fashionfussion.in",orders:"orders@fashionfussion.in"} as Record<string,string>)[role];
  return key ? Deno.env.get(key) || fallback || "" : "";
};
async function zohoToken(db:any, role:string): Promise<{accessToken:string;accountId:string}> {
  const {data:mailbox,error}=await db.rpc("crm_get_zoho_mailbox_auth",{p_department:role});
  if(error||!mailbox?.refresh_token||!mailbox?.zoho_account_id) throw new Error("ZOHO_MAILBOX_NOT_CONNECTED");
  const clientId=Deno.env.get("ZOHO_CLIENT_ID"), clientSecret=Deno.env.get("ZOHO_CLIENT_SECRET");
  if(!clientId||!clientSecret) throw new Error("ZOHO_OAUTH_NOT_CONFIGURED");
  const dc=(Deno.env.get("ZOHO_ACCOUNTS_DOMAIN")||"https://accounts.zoho.in").replace(/\/$/, "");
  const body=new URLSearchParams({refresh_token:String(mailbox.refresh_token),client_id:clientId,client_secret:clientSecret,grant_type:"refresh_token"});
  const res=await fetch(dc+"/oauth/v2/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body,redirect:"error"});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.access_token) throw new Error("ZOHO_TOKEN_REFRESH_FAILED");
  return {accessToken:String(data.access_token),accountId:String(mailbox.zoho_account_id)};
}
async function sendEmail(db:any, c:any, body:string, requestId:string, role:string): Promise<{id:string;provider:"email";fromAddress:string;toAddress:string}> {
  const sender=fromEnv(role);
  const recipient=clean(c.contact_email,254);
  const zohoMessageId=clean(c.metadata?.zoho_message_id,80);
  if(!sender||!recipient||!recipient.includes("@")) throw new Error("EMAIL_SENDER_NOT_CONFIGURED");
  // Zoho's documented reply endpoint needs the provider's internal message ID.
  // Do not silently send a new thread when the adapter has not supplied it.
  if(!/^[0-9]+$/.test(zohoMessageId)) throw new Error("ZOHO_ORIGINAL_MESSAGE_ID_MISSING");
  const {accessToken:token,accountId}=await zohoToken(db,role);
  const api=(Deno.env.get("ZOHO_MAIL_API_BASE")||"https://mail.zoho.in/api").replace(/\/$/, "");
  const content="<p>"+body.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>")+"</p>";
  const payload={fromAddress:sender,toAddress:recipient,content,action:"reply",mailFormat:"html",encoding:"UTF-8"};
  const res=await fetch(api+"/accounts/"+encodeURIComponent(accountId)+"/messages/"+encodeURIComponent(zohoMessageId),{method:"POST",headers:{"authorization":"Zoho-oauthtoken "+token,"content-type":"application/json"},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok || (data?.status && String(data.status.code||"")!=="200")) throw new Error("ZOHO_REPLY_FAILED");
  const msgId=String(data?.data?.messageId||data?.data?.message_id||"zoho-reply-"+requestId);
  return {id:msgId,provider:"email",fromAddress:sender,toAddress:recipient};
}
async function sendAttemptConflict(db:any,requestId:string,conversationId:number,provider:string,origin:string|null) {
  const {data:prior,error:priorError}=await db.from("crm_inbox_send_attempts").select("conversation_id,state,error_code,provider_message_id").eq("request_id",requestId).maybeSingle();
  if(priorError) return response({error:"SEND_ATTEMPT_LOOKUP_FAILED"},503,origin);
  if(prior&&Number(prior.conversation_id)!==Number(conversationId)) return response({error:"SEND_ALREADY_ATTEMPTED"},409,origin);
  if(prior?.state==="sent") return response({ok:true,duplicate:true,provider_message_id:prior.provider_message_id},200,origin);
  if(prior?.state==="sending") return response({error:prior.error_code||(provider==="whatsapp"?"WHATSAPP_SEND_OUTCOME_UNCERTAIN":"SEND_ALREADY_ATTEMPTED")},409,origin);
  const {data:active,error:activeError}=await db.from("crm_inbox_send_attempts").select("error_code").eq("conversation_id",conversationId).eq("state","sending").maybeSingle();
  if(activeError) return response({error:"SEND_ATTEMPT_LOOKUP_FAILED"},503,origin);
  if(active) return response({error:active.error_code||(provider==="whatsapp"?"WHATSAPP_SEND_OUTCOME_UNCERTAIN":"SEND_ALREADY_ATTEMPTED")},409,origin);
  return response({error:"SEND_ALREADY_ATTEMPTED",state:prior?.state||"unknown"},409,origin);
}
async function sendWhatsApp(c:any, body:string, requestId:string): Promise<{id:string;provider:"whatsapp"}> {
  const token=Deno.env.get("META_WHATSAPP_ACCESS_TOKEN");
  const phoneId=clean(c.metadata?.business_phone_number_id,100);
  const recipient=clean(c.contact_phone,30).replace(/[^0-9]/g,"");
  if(!token||!phoneId||!recipient) throw new Error("WHATSAPP_SENDER_NOT_CONFIGURED");
  const lastInbound=Date.parse(String(c.last_inbound_at||c.received_at||""));
  if(!Number.isFinite(lastInbound)||Date.now()-lastInbound>24*60*60*1000) throw new Error("WHATSAPP_TEMPLATE_REQUIRED_OUTSIDE_24H");
  const graph=(Deno.env.get("META_GRAPH_API_VERSION")||"v23.0");
  let res:Response;
  try{
    res=await fetch("https://graph.facebook.com/"+graph+"/"+encodeURIComponent(phoneId)+"/messages",{method:"POST",headers:{"authorization":"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to:recipient,type:"text",text:{preview_url:false,body},biz_opaque_callback_data:requestId})});
  }catch{throw new Error("WHATSAPP_SEND_OUTCOME_UNCERTAIN");}
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(res.status>=500?"WHATSAPP_SEND_OUTCOME_UNCERTAIN":"WHATSAPP_SEND_FAILED");
  if(typeof data?.messages?.[0]?.id!=="string") throw new Error("WHATSAPP_SEND_OUTCOME_UNCERTAIN");
  return {id:String(data.messages[0].id),provider:"whatsapp"};
}

async function whatsappConfig(db:any): Promise<{token:string;phoneId:string;graph:string;wabaId:string}> {
  const token=Deno.env.get("META_WHATSAPP_ACCESS_TOKEN")||"";
  const wabaId=Deno.env.get("META_WHATSAPP_BUSINESS_ACCOUNT_ID")||"";
  const {data,error}=await db.from("crm_inbox_conversations").select("metadata").eq("provider","whatsapp")
    .not("metadata->>business_phone_number_id","is",null).order("received_at",{ascending:false}).limit(1).maybeSingle();
  const phoneId=clean(data?.metadata?.business_phone_number_id,100);
  const graph=Deno.env.get("META_GRAPH_API_VERSION")||"v23.0";
  if(error||!token||!/^\d{8,25}$/.test(phoneId)||!/^\d{8,25}$/.test(wabaId)) throw new Error("WHATSAPP_SENDER_NOT_CONFIGURED");
  return {token,phoneId,graph,wabaId};
}
async function approvedMarketingTemplates(db:any) {
  const {token,graph,wabaId}=await whatsappConfig(db);
  const headers={authorization:"Bearer "+token,accept:"application/json"};
  const templateRes=await fetch("https://graph.facebook.com/"+graph+"/"+encodeURIComponent(wabaId)+"/message_templates?fields=name,status,category,language,components&limit=100",{headers});
  const templateData=await templateRes.json().catch(()=>({}));
  if(!templateRes.ok||!Array.isArray(templateData?.data)) {
    console.error("whatsapp_template_list_failed",{status:templateRes.status,metaErrorCode:clean(templateData?.error?.code,40),metaErrorSubcode:clean(templateData?.error?.error_subcode,40),metaErrorType:clean(templateData?.error?.type,80),metaErrorMessage:clean(templateData?.error?.message,240)});
    throw new Error("WHATSAPP_TEMPLATE_ACCESS_UNAVAILABLE");
  }
  const approvedMarketing=templateData.data.filter((t:any)=>String(t.status).toUpperCase()==="APPROVED"&&String(t.category).toUpperCase()==="MARKETING");
  return approvedMarketing
    .map((t:any)=>{
      const components=Array.isArray(t.components)?t.components:[];
      const body=components.find((c:any)=>String(c.type).toUpperCase()==="BODY");
      if(!body||typeof body.text!=="string"||components.some((c:any)=>{
        const type=String(c.type).toUpperCase();
        if(type==="BODY"||type==="FOOTER") return false;
        if(type==="HEADER") return String(c.format).toUpperCase()!=="TEXT"||typeof c.text!=="string"||String(c.text).includes("{{");
        if(type==="BUTTONS") return !Array.isArray(c.buttons)||c.buttons.some((b:any)=>String(b.text||"").includes("{{")||String(b.url||"").includes("{{"));
        return true;
      })) return null;
      const indexes=[...body.text.matchAll(/\{\{(\d+)\}\}/g)].map((m:any)=>Number(m[1]));
      if(indexes.some((n:number,i:number)=>n!==i+1)) return null;
      return {name:String(t.name),language:String(t.language),body:String(body.text),parameter_count:indexes.length};
    }).filter(Boolean);
}
async function startWhatsAppChat(db:any,user:any,role:string,payload:any,requestId:string,origin:string|null) {
  if(!["administrator","sales","marketing"].includes(role)) return response({error:"WHATSAPP_NEW_CHAT_ROLE_REQUIRED"},403,origin);
  const rawPhone=clean(payload?.phone,32).replace(/[\s().-]/g,"");
  const recipient=rawPhone.replace(/^\+/,"");
  const templateName=clean(payload?.template_name,100),language=clean(payload?.language,20);
  const parameters=Array.isArray(payload?.parameters)?payload.parameters:[];
  const department=role==="administrator"?clean(payload?.department,20):role;
  if(!/^\+?[1-9][0-9]{7,14}$/.test(rawPhone)||!templateName||!language||!["sales","marketing"].includes(department))
    return response({error:"INVALID_INPUT"},400,origin);
  if(role!=="administrator"&&department!==role) return response({error:"DEPARTMENT_ACCESS_DENIED"},403,origin);
  if(parameters.length>20||parameters.some((v:any)=>typeof v!=="string"||v.trim().length>200))
    return response({error:"INVALID_TEMPLATE_PARAMETERS"},400,origin);
  const {data:consent,error:consentError}=await db.from("whatsapp_contact_consents").select("id,status,revoked_at,consented_at,proof_reference")
    .eq("phone_e164","+"+recipient).eq("purpose","marketing").maybeSingle();
  if(consentError){
    console.error("whatsapp_consent_check_failed",{code:clean(consentError.code,40)});
    return response({error:"WHATSAPP_CONSENT_CHECK_UNAVAILABLE"},503,origin);
  }
  if(consent?.status!=="opted_in"||consent?.revoked_at||!consent?.consented_at||!String(consent?.proof_reference||"").trim())
    return response({error:"WHATSAPP_MARKETING_OPT_IN_REQUIRED"},403,origin);
  let templates:any[];
  try{templates=await approvedMarketingTemplates(db)}catch(e){return response({error:e instanceof Error?e.message:"WHATSAPP_TEMPLATE_ACCESS_UNAVAILABLE"},503,origin);}
  const template=templates.find(t=>t.name===templateName&&t.language===language);
  if(!template||parameters.length!==template.parameter_count) return response({error:"WHATSAPP_TEMPLATE_NOT_AVAILABLE_OR_PARAMETERS_INVALID"},422,origin);
  const {token,phoneId,graph}=await whatsappConfig(db);
  const preview=template.body.replace(/\{\{(\d+)\}\}/g,(_:string,n:string)=>parameters[Number(n)-1]);
  let conv:any=null;
  const {data:existing,error:existingError}=await db.from("crm_inbox_conversations").select("*").eq("provider","whatsapp")
    .eq("department",department).eq("contact_phone",recipient).order("received_at",{ascending:false}).limit(1).maybeSingle();
  if(existingError) return response({error:"CONVERSATION_LOOKUP_FAILED"},503,origin);
  conv=existing||null;
  if(conv?.assigned_to&&conv.assigned_to!==user.id&&role!=="administrator") return response({error:"CONVERSATION_ASSIGNED_TO_ANOTHER_AGENT"},409,origin);
  if(conv&&!conv.assigned_to&&["sales","marketing"].includes(role)){
    const {data:claimed,error:claimError}=await db.from("crm_inbox_conversations").update({assigned_to:user.id,updated_at:new Date().toISOString()})
      .eq("id",conv.id).is("assigned_to",null).select("id").maybeSingle();
    if(claimError)return response({error:"CONVERSATION_ASSIGNMENT_FAILED"},503,origin);
    if(!claimed){
      const {data:latest}=await db.from("crm_inbox_conversations").select("assigned_to").eq("id",conv.id).maybeSingle();
      if(latest?.assigned_to&&latest.assigned_to!==user.id)return response({error:"CONVERSATION_ASSIGNED_TO_ANOTHER_AGENT"},409,origin);
    }
  }
  if(!conv){
    const {data:created,error:createError}=await db.from("crm_inbox_conversations").insert({
      provider:"whatsapp",provider_message_id:"crm-start-"+requestId,provider_thread_id:null,department,
      contact_type:"prospect",contact_name:clean(payload?.contact_name,120)||null,contact_phone:recipient,
      inbox_address:"sales.team@fashionfussion.in",subject:"WhatsApp outreach",latest_message:"Preparing approved WhatsApp template",
      received_at:new Date().toISOString(),status:"open",priority:"normal",assigned_to:role==="administrator"?null:user.id,
      metadata:{business_phone_number_id:phoneId,crm_initiated:true,start_request_id:requestId}
    }).select("*").single();
    if(createError||!created) return response({error:"CONVERSATION_CREATE_FAILED"},503,origin);
    conv=created;
  }
  const {error:claimError}=await db.from("crm_inbox_send_attempts").insert({request_id:requestId,conversation_id:conv.id,actor_user_id:user.id,provider:"whatsapp",state:"sending"});
  if(claimError){
    if(claimError.code!=="23505") return response({error:"SEND_ATTEMPT_CLAIM_FAILED"},503,origin);
    return await sendAttemptConflict(db,requestId,conv.id,"whatsapp",origin);
  }
  let providerId:string|null=null,providerRequestStarted=false;
  try{
    providerRequestStarted=true;
    const res=await fetch("https://graph.facebook.com/"+graph+"/"+encodeURIComponent(phoneId)+"/messages",{
      method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
      body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to:recipient,type:"template",
        template:{name:template.name,language:{code:template.language},...(parameters.length?{components:[{type:"body",parameters:parameters.map((value:string)=>({type:"text",text:value.trim()}))}]}:{})},
        biz_opaque_callback_data:requestId})
    });
    const data=await res.json().catch(()=>({}));
    providerId=typeof data?.messages?.[0]?.id==="string"?data.messages[0].id:null;
    if(!res.ok) throw new Error(res.status>=500?"WHATSAPP_SEND_OUTCOME_UNCERTAIN":"WHATSAPP_SEND_FAILED");
    if(!providerId) throw new Error("WHATSAPP_SEND_OUTCOME_UNCERTAIN");
    const {error:messageError}=await db.from("crm_inbox_messages").insert({
      conversation_id:conv.id,provider_message_id:providerId,direction:"outbound",sender_label:user.email||label[role],
      body:preview,metadata:{provider:"whatsapp",request_id:requestId,actor_user_id:user.id,template_name:template.name,template_language:template.language},
      send_request_id:requestId,delivery_status:"sent"
    });
    if(messageError) throw new Error("WHATSAPP_SENT_INBOX_LOG_FAILED");
    const {error:conversationUpdateError}=await db.from("crm_inbox_conversations").update({latest_message:preview,received_at:new Date().toISOString(),status:"waiting",updated_at:new Date().toISOString()}).eq("id",conv.id);
    if(conversationUpdateError) console.error("whatsapp_conversation_update_after_send_failed",{conversationId:conv.id,requestId});
    const {error:attemptUpdateError}=await db.from("crm_inbox_send_attempts").update({state:"sent",provider_message_id:providerId,updated_at:new Date().toISOString()}).eq("request_id",requestId);
    if(attemptUpdateError) console.error("whatsapp_send_attempt_finalize_failed",{conversationId:conv.id,requestId});
    return response({ok:true,provider_message_id:providerId,provider:"whatsapp",conversation_id:conv.id},200,origin);
  }catch(e){
    const rawCode=e instanceof Error?e.message:"PROVIDER_SEND_FAILED";
    if(providerId||rawCode==="WHATSAPP_SEND_OUTCOME_UNCERTAIN"||(providerRequestStarted&&rawCode!=="WHATSAPP_SEND_FAILED")){
      const code=providerId?"WHATSAPP_SENT_INBOX_LOG_FAILED":"WHATSAPP_SEND_OUTCOME_UNCERTAIN";
      const {error:markError}=await db.from("crm_inbox_send_attempts").update({error_code:code,...(providerId?{provider_message_id:providerId}:{}),updated_at:new Date().toISOString()}).eq("request_id",requestId);
      if(markError) console.error("whatsapp_uncertain_attempt_marker_failed",{requestId});
      return response({error:code},502,origin);
    }
    await db.from("crm_inbox_send_attempts").update({state:"failed",error_code:rawCode,updated_at:new Date().toISOString()}).eq("request_id",requestId);
    return response({error:rawCode},502,origin);
  }
}

Deno.serve(async(req)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsFor(origin)});
  if(req.method!=="POST") return response({error:"METHOD_NOT_ALLOWED"},405,origin);
  if(origin && !["https://www.crm.fashionfussion.in","https://crm.fashionfussion.in"].includes(origin)) return response({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  // Owner-approved permanent live-reply activation (2026-11-01).
  // Authentication, CRM team/department authorization, provider checks, request idempotency,
  // delivery auditing, and the WhatsApp 24-hour window remain enforced below.
  const url=Deno.env.get("SUPABASE_URL"), serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader=req.headers.get("authorization")||"";
  const token=authHeader.replace(/^Bearer\s+/i,"");
  if(!url||!serviceKey||!token) return response({error:"AUTH_REQUIRED"},401,origin);
  let payload:any;
  try{payload=await req.json()}catch{return response({error:"INVALID_JSON"},400)}
  const action=clean(payload?.action,40)||"reply";
  const conversationId=Number(payload?.conversation_id), requestId=clean(payload?.request_id,64), body=clean(payload?.body,4000), mode=payload?.mode==="internal_note"?"internal_note":"reply";
  if(!requestId) return response({error:"INVALID_INPUT"},400,origin);
  if(action==="reply"&&(!Number.isSafeInteger(conversationId)||conversationId<=0||!body)) return response({error:"INVALID_INPUT"},400,origin);
  if(!["reply","list_whatsapp_templates","start_whatsapp_chat"].includes(action)) return response({error:"INVALID_ACTION"},400,origin);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return response({error:"INVALID_REQUEST_ID"},400,origin);
  const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await db.auth.getUser(token);
  const user=userData?.user;
  if(userError||!user) return response({error:"INVALID_SESSION"},401,origin);
  let role=""; 
  const {data:profile}=await db.from("profiles").select("is_admin").eq("id",user.id).maybeSingle();
  if(profile?.is_admin===true) role="administrator";
  else {
    const {data:member}=await db.from("crm_team_members").select("email,role,is_active").eq("user_id",user.id).maybeSingle();
    if(member?.is_active===true&&String(member.email||"").toLowerCase()===String(user.email||"").toLowerCase()&&label[member.role]) role=member.role;
  }
  if(!role) return response({error:"CRM_ACCESS_DENIED"},403,origin);
  if(action==="list_whatsapp_templates"){
    if(!["administrator","sales","marketing"].includes(role)) return response({error:"WHATSAPP_NEW_CHAT_ROLE_REQUIRED"},403,origin);
    try{return response({ok:true,templates:await approvedMarketingTemplates(db),sender_role:role},200,origin)}catch(e){console.error("whatsapp_template_catalog_lookup_failed",{error:e instanceof Error?clean(e.message,240):"unknown"});return response({error:e instanceof Error?e.message:"WHATSAPP_TEMPLATE_ACCESS_UNAVAILABLE"},503,origin)}
  }
  if(action==="start_whatsapp_chat") return await startWhatsAppChat(db,user,role,payload,requestId,origin);
  const {data:c,error:cError}=await db.from("crm_inbox_conversations").select("*").eq("id",conversationId).maybeSingle();
  if(cError||!c) return response({error:"CONVERSATION_NOT_FOUND"},404,origin);
  const sharedSalesMarketing = ["sales.team@fashionfussion.in","sales@fashionfussion.in"].includes(String(c.inbox_address||"").trim().toLowerCase()) && ["sales","marketing"].includes(role);
  if(role!=="administrator"&&role!==c.department&&!sharedSalesMarketing) return response({error:"DEPARTMENT_ACCESS_DENIED"},403,origin);
  if(sharedSalesMarketing&&!c.assigned_to){
    const {data:claimed}=await db.from("crm_inbox_conversations").update({assigned_to:user.id,updated_at:new Date().toISOString()}).eq("id",conversationId).is("assigned_to",null).select("id").maybeSingle();
    if(claimed) c.assigned_to=user.id;
    else {
      const {data:latest}=await db.from("crm_inbox_conversations").select("assigned_to").eq("id",conversationId).maybeSingle();
      c.assigned_to=latest?.assigned_to||null;
    }
  }
  if(sharedSalesMarketing&&c.assigned_to&&c.assigned_to!==user.id) return response({error:"CONVERSATION_ASSIGNED_TO_ANOTHER_AGENT"},409,origin);
  if(mode==="internal_note") return response({error:"INTERNAL_NOTES_NOT_YET_SUPPORTED"},501,origin);
  if(c.provider==="email"&&!c.contact_email) return response({error:"CONTACT_EMAIL_MISSING"},422,origin);
  if(c.provider==="whatsapp"&&!c.contact_phone) return response({error:"CONTACT_PHONE_MISSING"},422,origin);
  const {error:claimError}=await db.from("crm_inbox_send_attempts").insert({request_id:requestId,conversation_id:conversationId,actor_user_id:user.id,provider:c.provider,state:"sending"});
  if(claimError){
    if(claimError.code!=="23505") return response({error:"SEND_ATTEMPT_CLAIM_FAILED"},503,origin);
    return await sendAttemptConflict(db,requestId,conversationId,c.provider,origin);
  }
  let sentProviderId:string|null=null;
  try{
    const senderRole=sharedSalesMarketing ? role : c.department;
    const sent=c.provider==="email"?await sendEmail(db,c,body,requestId,senderRole):await sendWhatsApp(c,body,requestId);
    sentProviderId=sent.id;
    const {error:messageError}=await db.from("crm_inbox_messages").insert({conversation_id:conversationId,provider_message_id:sent.id,direction:"outbound",sender_label:user.email||label[role],body,metadata:{provider:sent.provider,request_id:requestId,actor_user_id:user.id,...(sent.provider==="email"?{from_address:sent.fromAddress,to_address:sent.toAddress}:{})},send_request_id:requestId,delivery_status:"sent"});
    if(messageError) throw new Error(c.provider==="whatsapp"?"WHATSAPP_SENT_INBOX_LOG_FAILED":"MESSAGE_AUDIT_WRITE_FAILED");
    const {error:conversationUpdateError}=await db.from("crm_inbox_conversations").update({latest_message:body,received_at:new Date().toISOString(),status:"waiting",updated_at:new Date().toISOString()}).eq("id",conversationId);
    if(conversationUpdateError) console.error("crm_conversation_update_after_send_failed",{conversationId,requestId});
    const {error:attemptUpdateError}=await db.from("crm_inbox_send_attempts").update({state:"sent",provider_message_id:sent.id,updated_at:new Date().toISOString()}).eq("request_id",requestId);
    if(attemptUpdateError) console.error("crm_send_attempt_finalize_failed",{conversationId,requestId});
    return response({ok:true,provider_message_id:sent.id,provider:sent.provider},200,origin);
  }catch(e){
    const rawCode=e instanceof Error?e.message:"PROVIDER_SEND_FAILED";
    const uncertain=Boolean(sentProviderId&&c.provider==="whatsapp")||rawCode==="WHATSAPP_SEND_OUTCOME_UNCERTAIN";
    if(uncertain){
      const code=sentProviderId?"WHATSAPP_SENT_INBOX_LOG_FAILED":"WHATSAPP_SEND_OUTCOME_UNCERTAIN";
      const {error:markError}=await db.from("crm_inbox_send_attempts").update({error_code:code,...(sentProviderId?{provider_message_id:sentProviderId}:{}),updated_at:new Date().toISOString()}).eq("request_id",requestId);
      if(markError) console.error("crm_uncertain_attempt_marker_failed",{conversationId,requestId});
      return response({error:code},502,origin);
    }
    await db.from("crm_inbox_send_attempts").update({state:"failed",error_code:rawCode,updated_at:new Date().toISOString()}).eq("request_id",requestId);
    const status=rawCode==="WHATSAPP_TEMPLATE_REQUIRED_OUTSIDE_24H"?422:502;
    return response({error:rawCode},status,origin);
  }
});

