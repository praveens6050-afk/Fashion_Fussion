const {SUPABASE_URL,SUPABASE_SERVER_KEY,cors,json,readBody,requireAdminUser}=require('../lib');

const GATEWAY_URL=String(process.env.PAYOUT_GATEWAY_URL||'').trim();
const GATEWAY_TOKEN=String(process.env.PAYOUT_GATEWAY_TOKEN||'').trim();
const DIRECT_ENABLED=String(process.env.RAZORPAYX_DIRECT_EGRESS_ENABLED||'').toLowerCase()==='true';
const RAZORPAYX_KEY_ID=String(process.env.RAZORPAYX_KEY_ID||process.env.RAZORPAY_KEY_ID||'').trim();
const RAZORPAYX_KEY_SECRET=String(process.env.RAZORPAYX_KEY_SECRET||process.env.RAZORPAY_KEY_SECRET||'').trim();
const RAZORPAYX_ACCOUNT_NUMBER=String(process.env.RAZORPAYX_ACCOUNT_NUMBER||'').trim();

function serverHeaders(){return{apikey:SUPABASE_SERVER_KEY,Authorization:'Bearer '+SUPABASE_SERVER_KEY,'Content-Type':'application/json'}}
async function rpc(name,args){
  const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:serverHeaders(),body:JSON.stringify(args||{})});
  const d=await r.json().catch(()=>null);if(!r.ok){const e=new Error(d?.message||d?.error||'Payout database action failed');e.status=r.status;throw e}return d;
}
function config(){return{configured:Boolean(GATEWAY_URL||(DIRECT_ENABLED&&RAZORPAYX_KEY_ID&&RAZORPAYX_KEY_SECRET&&RAZORPAYX_ACCOUNT_NUMBER)),mode:GATEWAY_URL?'gateway':DIRECT_ENABLED?'direct':'disabled',gateway:GATEWAY_URL?new URL(GATEWAY_URL).origin:null,direct_enabled:DIRECT_ENABLED}}
async function callProvider(prepared){
  const payload={operation:'create_payout',settlement_id:prepared.settlement_id,amount:Number(prepared.amount_paise),currency:prepared.currency||'INR',fund_account_id:prepared.fund_account_id,mode:prepared.payout_mode||'IMPS',purpose:'payout',reference_id:'ff-settlement-'+prepared.settlement_id,narration:'Fashion Fussion seller settlement'};
  if(GATEWAY_URL){
    const r=await fetch(GATEWAY_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+GATEWAY_TOKEN,'Idempotency-Key':prepared.idempotency_key},body:JSON.stringify(payload)});const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d?.error||d?.message||'Payout gateway request failed');e.status=502;e.provider=d;throw e}return d;
  }
  if(!(DIRECT_ENABLED&&RAZORPAYX_KEY_ID&&RAZORPAYX_KEY_SECRET&&RAZORPAYX_ACCOUNT_NUMBER)){const e=new Error('Seller payout provider is not configured');e.status=503;throw e}
  const auth='Basic '+Buffer.from(RAZORPAYX_KEY_ID+':'+RAZORPAYX_KEY_SECRET).toString('base64');
  const r=await fetch('https://api.razorpay.com/v1/payouts',{method:'POST',headers:{'Content-Type':'application/json',Authorization:auth,'X-Payout-Idempotency':prepared.idempotency_key},body:JSON.stringify({account_number:RAZORPAYX_ACCOUNT_NUMBER,fund_account_id:prepared.fund_account_id,amount:Number(prepared.amount_paise),currency:prepared.currency||'INR',mode:prepared.payout_mode||'IMPS',purpose:'payout',queue_if_low_balance:false,reference_id:'ff-settlement-'+prepared.settlement_id,narration:'Fashion Fussion seller settlement'})});
  const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d?.error?.description||d?.error?.reason||'RazorpayX payout request failed');e.status=502;e.provider=d;throw e}return d;
}
async function record(settlementId,d,failure){
  const status=String(d?.status||d?.provider_status||(failure?'failed':'processing')).toLowerCase();
  const details={entity:d?.entity||null,status_details:d?.status_details||null,failure_reason:d?.failure_reason||d?.error?.reason||null};
  return rpc('admin_record_seller_payout_result',{p_settlement_id:settlementId,p_provider_payout_ref:d?.id||d?.payout_id||null,p_provider_status:status,p_provider_utr:d?.utr||null,p_failure_reason:failure||d?.failure_reason||d?.error?.description||null,p_provider_details:details});
}
module.exports=async function sellerPayout(req,res){
  cors(req,res);if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  if(req.method==='GET')return json(req,res,200,{ok:true,...config()});
  if(req.method!=='POST')return json(req,res,405,{error:'Method not allowed'});
  try{
    await requireAdminUser(req);const body=await readBody(req);const id=Number(body.settlement_id);if(!Number.isInteger(id)||id<1)return json(req,res,400,{error:'Invalid settlement ID'});
    if(!config().configured)return json(req,res,503,{error:'Seller payout provider is not configured',...config()});
    const prepared=await rpc('admin_prepare_seller_payout',{p_settlement_id:id});
    if(prepared?.already_paid)return json(req,res,200,{ok:true,already_paid:true,settlement_id:id,status:'paid'});
    try{const provider=await callProvider(prepared);const saved=await record(id,provider,null);return json(req,res,200,{ok:true,settlement_id:id,provider_status:provider?.status||null,result:saved})}
    catch(error){await record(id,error.provider||{},error.message).catch(()=>{});throw error}
  }catch(error){return json(req,res,error.status||400,{error:error.message||'Seller payout failed'})}
};
