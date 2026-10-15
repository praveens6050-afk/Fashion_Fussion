// Private READ-ONLY Meta WhatsApp preflight. Does not message customers,
// change templates, register numbers, mutate Supabase or update launch flags.
// Operator must supply OUTREACH_API_TOKEN, never Meta secrets or a WABA ID.
const EXPECTED_NAME = 'order_status_update';
const EXPECTED_LANGUAGE = 'en';
const EXPECTED_BODY = 'Hi {{1}}, your Fashion Fussion order {{2}} status has been updated to {{3}}. Please check your account for the latest order details.';
function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers:{
    'content-type':'application/json; charset=UTF-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'
  }});
}
async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(String(value || ''))));
}
async function authorized(request, env) {
  const expected = String(env.OUTREACH_API_TOKEN || '');
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [a,b] = await Promise.all([digest(supplied),digest(expected)]);
  let different = 0;
  for (let i=0;i<a.length;i++) different |= a[i]^b[i];
  return different === 0;
}
function cleanBody(text) {
  return String(text || '').replace(/\s+/g,' ').trim();
}
function checkTemplate(entry) {
  const checks = {
    templateFound:Boolean(entry),
    statusApproved:entry?.status === 'APPROVED',
    languageMatches:entry?.language === EXPECTED_LANGUAGE,
    categoryUtility:String(entry?.category || '').toUpperCase() === 'UTILITY',
    exactBodyMatches:false,
    noUnexpectedDynamicComponents:false
  };
  const components = Array.isArray(entry?.components) ? entry.components : [];
  const bodies = components.filter(c=>String(c?.type||'').toUpperCase()==='BODY');
  const headers = components.filter(c=>String(c?.type||'').toUpperCase()==='HEADER');
  const footers = components.filter(c=>String(c?.type||'').toUpperCase()==='FOOTER');
  const extras = components.filter(c=>!['BODY','HEADER','FOOTER'].includes(String(c?.type||'').toUpperCase()));
  checks.exactBodyMatches=bodies.length===1 && cleanBody(bodies[0].text)===EXPECTED_BODY;
  // The approved UI can include a *static* Fashion Fussion text header.
  // Such a header needs no Cloud API parameter. Never accept variable,
  // image, video, document, location, or interactive button components.
  const staticTextHeader=headers.length<=1 && headers.every(c=>
    String(c?.format||'').toUpperCase()==='TEXT'
    && cleanBody(c?.text)==='Fashion Fussion'
    && !/{{\s*\d+\s*}}/.test(String(c?.text||''))
    && !c?.example
  );
  const staticFooter=footers.length<=1 && footers.every(c=>
    cleanBody(c?.text)==='Fashion Fussion'
    && !/{{\s*\d+\s*}}/.test(String(c?.text||''))
  );
  checks.noUnexpectedDynamicComponents=extras.length===0 && staticTextHeader && staticFooter;
  return checks;
}
async function readMeta(path, token) {
  // Fixed graph.facebook.com origin only. Numeric WABA ID, restricted
  // version and static endpoint paths are validated before this call.
  const response = await fetch('https://graph.facebook.com/'+path, {
    method:'GET',redirect:'error',cache:'no-store',
    headers:{Authorization:'Bearer '+token,Accept:'application/json'}
  });
  if (!response.ok) throw new Error('META_READ_FAILED');
  const data = await response.json();
  if (!Array.isArray(data?.data)) throw new Error('META_RESPONSE_INVALID');
  return data;
}
// Shared between the read-only operator status endpoint and the private
// order dispatcher. This function performs ONLY Meta GET requests; it never
// sends an order notification or mutates consent or state.
export async function verifyMetaOrderTemplate(env) {
  const version = String(env.WHATSAPP_GRAPH_VERSION||'').trim();
  const waba = String(env.WHATSAPP_BUSINESS_ACCOUNT_ID||'').trim();
  const phone = String(env.WHATSAPP_PHONE_NUMBER_ID||'').trim();
  const token = String(env.WHATSAPP_ACCESS_TOKEN||'');
  const allowed = new Set(String(env.WHATSAPP_ALLOWED_TEMPLATES||'')
    .split(',').map(s=>s.trim()).filter(Boolean));
  const missing = [];
  if (!/^v\d{1,2}\.\d{1,2}$/.test(version)) missing.push('WHATSAPP_GRAPH_VERSION');
  if (!/^[0-9]{10,25}$/.test(waba)) missing.push('WHATSAPP_BUSINESS_ACCOUNT_ID');
  if (!/^[0-9]{13,25}$/.test(phone)) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (token.length<20) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!allowed.has(EXPECTED_NAME)) missing.push('WHATSAPP_ALLOWED_TEMPLATES_ORDER_STATUS_UPDATE');
  if (missing.length) return {dryRun:true,messagesSent:0,ready:false,
    issue:'CONFIGURATION_INCOMPLETE',missing};

  // Verify template approval, exact three-parameter body and phone membership.
  // Provider pagination or unavailable GET permissions are NOT silently ignored.
  try {
    const [templates,phoneNumbers] = await Promise.all([
      readMeta(version+'/'+waba+'/message_templates?'+new URLSearchParams({
        name:EXPECTED_NAME,fields:'name,status,language,category,components',limit:'100'
      }).toString(),token),
      readMeta(version+'/'+waba+'/phone_numbers?'+new URLSearchParams({
        fields:'id',limit:'100'
      }).toString(),token)
    ]);
    const matches=templates.data.filter(t=>t?.name===EXPECTED_NAME && t?.language===EXPECTED_LANGUAGE);
    const template=matches.length===1?matches[0]:null;
    const checks=checkTemplate(template);
    const phoneNumberInBusiness=phoneNumbers.data.some(row=>String(row?.id||'')===phone);
    const paginationComplete=!templates.paging?.next && !phoneNumbers.paging?.next;
    const ready=matches.length===1 && phoneNumberInBusiness && paginationComplete
      && Object.values(checks).every(Boolean);
    const issues=[];
    if (matches.length!==1) issues.push('TEMPLATE_NOT_UNIQUE_OR_MISSING');
    if (!checks.statusApproved) issues.push('TEMPLATE_NOT_APPROVED');
    if (!checks.categoryUtility) issues.push('TEMPLATE_NOT_UTILITY');
    if (!checks.exactBodyMatches || !checks.noUnexpectedDynamicComponents)
      issues.push('TEMPLATE_PARAMETER_MAPPING_MISMATCH');
    if (!phoneNumberInBusiness) issues.push('PHONE_NUMBER_NOT_VERIFIED_IN_BUSINESS');
    if (!paginationComplete) issues.push('META_RESULT_PAGINATED');
    return {dryRun:true,messagesSent:0,ready,templateName:EXPECTED_NAME,
      language:EXPECTED_LANGUAGE,phoneNumberInBusiness,paginationComplete,
      checks,issues:[...new Set(issues)],
      note:'GET-only Meta configuration check; consent, sending permission and delivery not proven.'};
  } catch {
    return {dryRun:true,messagesSent:0,ready:false,
      issue:'META_READ_UNAVAILABLE',note:'Meta GET access unavailable or invalid. No message was sent.'};
  }
}
export async function onRequestGet({request, env}) {
  if (!(await authorized(request,env))) return reply({error:'Unauthorized'},401);
  const report = await verifyMetaOrderTemplate(env);
  return reply(report, report.issue==='META_READ_UNAVAILABLE'?503:200);
}
export function onRequestPost(){return reply({error:'Read-only GET required'},405);}
