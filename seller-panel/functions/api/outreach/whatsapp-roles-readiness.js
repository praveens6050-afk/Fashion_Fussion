// Read-only launch readiness by workflow role; no messages, consent writes,
// order staging, dispatch, scheduler, Meta API calls or recipient information.
function json(value,status=200) {
  return new Response(JSON.stringify(value),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'
  }});
}
async function sha(input) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(String(input||''))));
}
async function operatorAuthorized(request,env) {
  const expected=String(env.OUTREACH_API_TOKEN||'');
  const header=request.headers.get('authorization')||'';
  const supplied=header.startsWith('Bearer ')?header.slice(7):'';
  if(!expected || !supplied)return false;
  const [a,b]=await Promise.all([sha(supplied),sha(expected)]);
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}
async function exactCount(base,key,table,select,filter) {
  const response=await fetch(base+'/rest/v1/'+table+'?select='+select+filter,{
    method:'HEAD',cache:'no-store',
    headers:{apikey:key,Authorization:'Bearer '+key,Prefer:'count=exact'}
  });
  if(!response.ok)throw Error('READ_ONLY_COUNT_UNAVAILABLE');
  const range=response.headers.get('content-range')||'';
  const match=range.match(/\/(\d+)$/);
  if(!match)throw Error('COUNT_HEADER_UNAVAILABLE');
  return Number(match[1]);
}
async function schemaReadiness(base,key) {
  // This RPC is STABLE/read-only and returns only schema booleans, never rows
  // or recipient information. Missing migration fails closed as "unverified".
  const response=await fetch(base+'/rest/v1/rpc/whatsapp_notification_schema_readiness',{
    method:'POST',cache:'no-store',
    headers:{apikey:key,Authorization:'Bearer '+key,
      'content-type':'application/json',Accept:'application/json'},
    body:'{}'
  });
  if(!response.ok)return {schemaVerified:false,probeAvailable:false,
    missingColumns:[],claimFunctionPresent:false,finishFunctionPresent:false,
    sellerMappingSchemaVerified:false,sellerMappingMissingColumns:[],
    sellerRecipientSchemaVerified:false,sellerRecipientMissingColumns:[],
    sellerAlertStorageVerified:false,sellerAlertStorageMissingColumns:[],
    adminIdentitySchemaVerified:false,adminIdentityMissingColumns:[],
    adminAlertStorageVerified:false,adminAlertStorageMissingColumns:[]};
  const result=await response.json().catch(()=>null);
  if(!result||typeof result!=='object')return {schemaVerified:false,probeAvailable:false,
    missingColumns:[],claimFunctionPresent:false,finishFunctionPresent:false};
  return {schemaVerified:result.schemaVerified===true,probeAvailable:true,
    missingColumns:Array.isArray(result.missingColumns)?result.missingColumns:[],
    claimFunctionPresent:result.claimFunctionPresent===true,
    finishFunctionPresent:result.finishFunctionPresent===true,
    sellerMappingSchemaVerified:result.sellerMappingSchemaVerified===true,
    sellerMappingMissingColumns:Array.isArray(result.sellerMappingMissingColumns)?result.sellerMappingMissingColumns:[],
    sellerRecipientSchemaVerified:result.sellerRecipientSchemaVerified===true,
    sellerRecipientMissingColumns:Array.isArray(result.sellerRecipientMissingColumns)?result.sellerRecipientMissingColumns:[],
    sellerAlertStorageVerified:result.sellerAlertStorageVerified===true,
    sellerAlertStorageMissingColumns:Array.isArray(result.sellerAlertStorageMissingColumns)?result.sellerAlertStorageMissingColumns:[],
    adminIdentitySchemaVerified:result.adminIdentitySchemaVerified===true,
    adminIdentityMissingColumns:Array.isArray(result.adminIdentityMissingColumns)?result.adminIdentityMissingColumns:[],
    adminAlertStorageVerified:result.adminAlertStorageVerified===true,
    adminAlertStorageMissingColumns:Array.isArray(result.adminAlertStorageMissingColumns)?result.adminAlertStorageMissingColumns:[]};
}
function allowlisted(env,name) {
  return !!name && /^[a-z0-9_]{1,512}$/.test(name) &&
    String(env.WHATSAPP_ALLOWED_TEMPLATES||'').split(',')
      .some(x=>x.trim()===name);
}
export async function onRequestGet({request,env}) {
  if(!(await operatorAuthorized(request,env)))return json({error:'Unauthorized'},401);
  const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY||'');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key)
    return json({error:'Private database configuration unavailable'},503);
  try {
    const [transactional,marketing,orders,inboundReview,queue,schema]=await Promise.all([
      exactCount(base,key,'whatsapp_contact_consents','phone_e164',
        '&purpose=eq.transactional&status=eq.opted_in&revoked_at=is.null'),
      exactCount(base,key,'whatsapp_contact_consents','phone_e164',
        '&purpose=eq.marketing&status=eq.opted_in&revoked_at=is.null'),
      exactCount(base,key,'whatsapp_order_consents','order_id',
        '&revoked_at=is.null'),
      exactCount(base,key,'whatsapp_inbound_events','id',
        '&routing_status=eq.needs_review'),
      exactCount(base,key,'whatsapp_order_notification_outbox','id',''),
      schemaReadiness(base,key)
    ]);
    const sellerTemplate=String(env.WHATSAPP_SELLER_ONBOARDING_TEMPLATE||'').trim();
    const adminTemplate=String(env.WHATSAPP_ADMIN_ALERT_TEMPLATE||'').trim();
    return json({
      readOnly:true,messagesSent:0,ordersCreated:0,consentRecordsChanged:0,
      roles:{
        customer:{
          workflow:'order_confirmed',
          transactionalOptIns:transactional,
          activePerOrderConsents:orders,queueCount:queue,
          ...schema,
          atomicDispatchSchemaVerified:schema.schemaVerified,
          metaTemplateVerified:false,
          status:schema.schemaVerified
            ?'SCHEMA_VERIFIED_META_PREFLIGHT_REQUIRED'
            :'SCHEMA_NOT_VERIFIED'
        },
        seller:{
          workflow:'seller_onboarding',
          marketingOptIns:marketing,
          requestedTemplateConfigured:Boolean(sellerTemplate),
          requestedTemplateAllowlisted:allowlisted(env,sellerTemplate),
          metaTemplateVerified:false,
          sellerMappingSchemaVerified:schema.sellerMappingSchemaVerified,
          sellerMappingMissingColumns:schema.sellerMappingMissingColumns,
          sellerRecipientSchemaVerified:schema.sellerRecipientSchemaVerified,
          sellerRecipientMissingColumns:schema.sellerRecipientMissingColumns,
          alertStorageSchemaVerified:schema.sellerAlertStorageVerified,
          alertStorageMissingColumns:schema.sellerAlertStorageMissingColumns,
          automaticSendingConfigured:false,
          status:!schema.sellerMappingSchemaVerified||!schema.sellerRecipientSchemaVerified
            ?'SELLER_SCHEMA_NOT_VERIFIED':!schema.sellerAlertStorageVerified?'SELLER_ALERT_STORAGE_NOT_VERIFIED':marketing===0?'MARKETING_OPT_IN_REQUIRED':
            'TEMPLATE_AND_CONTROLLED_OUTREACH_REVIEW_REQUIRED'
        },
        admin:{
          workflow:'operational_alerts',
          requestedTemplateConfigured:Boolean(adminTemplate),
          requestedTemplateAllowlisted:allowlisted(env,adminTemplate),
          adminIdentitySchemaVerified:schema.adminIdentitySchemaVerified,
          adminIdentityMissingColumns:schema.adminIdentityMissingColumns,
          alertStorageSchemaVerified:schema.adminAlertStorageVerified,
          alertStorageMissingColumns:schema.adminAlertStorageMissingColumns,
          verifiedAdminRecipients:false,
          metaTemplateVerified:false,
          dedicatedDispatcherVerified:false,
          status:!schema.adminIdentitySchemaVerified?'ADMIN_IDENTITY_SCHEMA_NOT_VERIFIED':!schema.adminAlertStorageVerified?'ADMIN_ALERT_STORAGE_NOT_VERIFIED':'ADMIN_ALERT_WORKFLOW_REQUIRED'
        }
      },
      inboundNeedsManualReview:inboundReview,
      disclaimers:[
        'This is an operator-only privacy-safe inventory, not a sending authorization.',
        'Active marketing consent is purpose-specific; public business phone listings do not constitute opt-in.',
        'Customer template and WABA membership require the separate live GET-only Meta preflight.',
        'Admin WhatsApp requires a dedicated approved template, verified recipients and a separate alert pipeline.'
      ]
    });
  }catch{
    return json({error:'WhatsApp role readiness unavailable; no messages sent'},503);
  }
}
export function onRequestPost(){return json({error:'Read-only GET required'},405);}
