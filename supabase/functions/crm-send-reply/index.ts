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
const label: Record<string,string> = {customer_support:"Customer Support",seller_support:"Seller Support",sales:"Sales",marketing:"Marketing"};
const fromEnv = (role:string) => {
  const key = ({customer_support:"CRM_FROM_CUSTOMER_CARE",seller_support:"CRM_FROM_SELLER_SUPPORT",sales:"CRM_FROM_SALES_TEAM",marketing:"CRM_FROM_MARKETING"} as Record<string,string>)[role];
  return key ? Deno.env.get(key) || "" : "";
};
async function zohoToken(): Promise<string> {
  const existing=Deno.env.get("ZOHO_ACCESS_TOKEN");
  const refresh=Deno.env.get("ZOHO_REFRESH_TOKEN");
  if (!refresh) {
    if (existing) return existing;
    throw new Error("ZOHO_SENDER_NOT_CONFIGURED");
  }
  const clientId=Deno.env.get("ZOHO_CLIENT_ID"), clientSecret=Deno.env.get("ZOHO_CLIENT_SECRET");
  if(!clientId||!clientSecret) throw new Error("ZOHO_OAUTH_NOT_CONFIGURED");
  const dc=(Deno.env.get("ZOHO_ACCOUNTS_DOMAIN")||"https://accounts.zoho.in").replace(/\/$/, "");
  const body=new URLSearchParams({refresh_token:refresh,client_id:clientId,client_secret:clientSecret,grant_type:"refresh_token"});
  const res=await fetch(dc+"/oauth/v2/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.access_token) throw new Error("ZOHO_TOKEN_REFRESH_FAILED");
  return String(data.access_token);
}
async function sendEmail(c:any, body:string, requestId:string, role:string) {
  const accountId=Deno.env.get("ZOHO_MAIL_ACCOUNT_ID");
  const sender=fromEnv(role);
  const recipient=clean(c.contact_email,254);
  const zohoMessageId=clean(c.metadata?.zoho_message_id,80);
  if(!accountId||!sender||!recipient||!recipient.includes("@")) throw new Error("EMAIL_SENDER_NOT_CONFIGURED");
  // Zoho's documented reply endpoint needs the provider's internal message ID.
  // Do not silently send a new thread when the adapter has not supplied it.
  if(!/^[0-9]+$/.test(zohoMessageId)) throw new Error("ZOHO_ORIGINAL_MESSAGE_ID_MISSING");
  const token=await zohoToken();
  const api=(Deno.env.get("ZOHO_MAIL_API_BASE")||"https://mail.zoho.in/api").replace(/\/$/, "");
  const content="<p>"+body.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>")+"</p>";
  const payload={fromAddress:sender,toAddress:recipient,content,action:"reply",mailFormat:"html",encoding:"UTF-8"};
  const res=await fetch(api+"/accounts/"+encodeURIComponent(accountId)+"/messages/"+encodeURIComponent(zohoMessageId),{method:"POST",headers:{"authorization":"Zoho-oauthtoken "+token,"content-type":"application/json"},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok || (data?.status && String(data.status.code||"")!=="200")) throw new Error("ZOHO_REPLY_FAILED");
  const msgId=String(data?.data?.messageId||data?.data?.message_id||"zoho-reply-"+requestId);
  return {id:msgId,provider:"email"};
}
async function sendWhatsApp(c:any, body:string, requestId:string) {
  const token=Deno.env.get("META_WHATSAPP_ACCESS_TOKEN");
  const phoneId=clean(c.metadata?.business_phone_number_id,100);
  const recipient=clean(c.contact_phone,30).replace(/[^0-9]/g,"");
  if(!token||!phoneId||!recipient) throw new Error("WHATSAPP_SENDER_NOT_CONFIGURED");
  const lastInbound=Date.parse(String(c.last_inbound_at||c.received_at||""));
  if(!Number.isFinite(lastInbound)||Date.now()-lastInbound>24*60*60*1000) throw new Error("WHATSAPP_TEMPLATE_REQUIRED_OUTSIDE_24H");
  const graph=(Deno.env.get("META_GRAPH_API_VERSION")||"v23.0");
  const res=await fetch("https://graph.facebook.com/"+graph+"/"+encodeURIComponent(phoneId)+"/messages",{method:"POST",headers:{"authorization":"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to:recipient,type:"text",text:{preview_url:false,body},biz_opaque_callback_data:requestId})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data?.messages?.[0]?.id) throw new Error("WHATSAPP_SEND_FAILED");
  return {id:String(data.messages[0].id),provider:"whatsapp"};
}
Deno.serve(async(req)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsFor(origin)});
  if(req.method!=="POST") return response({error:"METHOD_NOT_ALLOWED"},405,origin);
  if(origin && !["https://www.crm.fashionfussion.in","https://crm.fashionfussion.in"].includes(origin)) return response({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  const url=Deno.env.get("SUPABASE_URL"), serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader=req.headers.get("authorization")||"";
  const token=authHeader.replace(/^Bearer\s+/i,"");
  if(!url||!serviceKey||!token) return response({error:"AUTH_REQUIRED"},401,origin);
  let payload:any;
  try{payload=await req.json()}catch{return response({error:"INVALID_JSON"},400)}
  const conversationId=Number(payload?.conversation_id), requestId=clean(payload?.request_id,64), body=clean(payload?.body,4000), mode=payload?.mode==="internal_note"?"internal_note":"reply";
  if(!Number.isSafeInteger(conversationId)||conversationId<=0||!body||!requestId) return response({error:"INVALID_INPUT"},400,origin);
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
  const {data:c,error:cError}=await db.from("crm_inbox_conversations").select("*").eq("id",conversationId).maybeSingle();
  if(cError||!c) return response({error:"CONVERSATION_NOT_FOUND"},404,origin);
  const sharedSalesMarketing = String(c.inbox_address||"").trim().toLowerCase()==="sales.team@fashionfussion.in" && ["sales","marketing"].includes(role);
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
  if(claimError) {
    const {data:prior}=await db.from("crm_inbox_send_attempts").select("state,provider_message_id").eq("request_id",requestId).maybeSingle();
    if(prior?.state==="sent") return response({ok:true,duplicate:true,provider_message_id:prior.provider_message_id},200,origin);
    return response({error:"SEND_ALREADY_ATTEMPTED",state:prior?.state||"unknown"},409,origin);
  }
  try{
    const sent=c.provider==="email"?await sendEmail(c,body,requestId,c.department):await sendWhatsApp(c,body,requestId);
    const {error:messageError}=await db.from("crm_inbox_messages").insert({conversation_id:conversationId,provider_message_id:sent.id,direction:"outbound",sender_label:user.email||label[role],body,metadata:{provider:sent.provider,request_id:requestId,actor_user_id:user.id},send_request_id:requestId,delivery_status:"sent"});
    if(messageError) throw new Error("MESSAGE_AUDIT_WRITE_FAILED");
    await db.from("crm_inbox_conversations").update({latest_message:body,received_at:new Date().toISOString(),status:"waiting",updated_at:new Date().toISOString()}).eq("id",conversationId);
    await db.from("crm_inbox_send_attempts").update({state:"sent",provider_message_id:sent.id,updated_at:new Date().toISOString()}).eq("request_id",requestId);
    return response({ok:true,provider_message_id:sent.id,provider:sent.provider},200,origin);
  }catch(e){
    const code=e instanceof Error?e.message:"PROVIDER_SEND_FAILED";
    await db.from("crm_inbox_send_attempts").update({state:"failed",error_code:code,updated_at:new Date().toISOString()}).eq("request_id",requestId);
    const status=code==="WHATSAPP_TEMPLATE_REQUIRED_OUTSIDE_24H"?422:502;
    return response({error:code},status,origin);
  }
});
