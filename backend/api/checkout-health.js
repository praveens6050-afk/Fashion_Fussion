const {
  KEY_ID,KEY_SECRET,WEBHOOK_SECRET,SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,
  serverHeaders,cors,json,readBody,requireAdminUser,basicAuth
}=require('../lib');

const REQUIRED_RPCS=[
  'reserve_order_promotions','reserve_order_inventory','release_order_inventory','release_order_promotions',
  'finalize_cod_order_inventory','finalize_zero_value_order_inventory','commit_order_inventory',
  'finalize_checkout_order','claim_prepaid_order_cancellation','restore_cancelled_order_promotions',
  'restock_cancelled_order_inventory','record_payment_exception'
];

async function countRows(path){
  const response=await fetch(SUPABASE_URL+'/rest/v1/'+path,{method:'HEAD',headers:{...serverHeaders,Prefer:'count=exact'}});
  if(!response.ok)throw new Error('Checkout readiness database count failed');
  const range=String(response.headers.get('content-range')||'0/0');
  const total=Number(range.split('/')[1]||0);
  return Number.isFinite(total)?total:0;
}

async function currentUserAddressReady(userId){
  const response=await fetch(SUPABASE_URL+'/rest/v1/customer_addresses?user_id=eq.'+encodeURIComponent(userId)+'&select=id&limit=1',{headers:serverHeaders});
  const rows=await response.json().catch(()=>[]);
  if(!response.ok)throw new Error('Could not check the admin test account delivery address');
  return Boolean(rows?.[0]?.id);
}

async function checkoutRpcStatus(){
  const response=await fetch(SUPABASE_URL+'/rest/v1/',{headers:serverHeaders});
  const schema=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error('Could not inspect checkout database RPCs');
  const paths=schema?.paths||{};
  const missing=REQUIRED_RPCS.filter(name=>!paths['/rpc/'+name]);
  return{ready:missing.length===0,missing};
}

async function razorpayStatus(){
  const configured=Boolean(KEY_ID&&KEY_SECRET);
  if(!configured)return{credentials_configured:false,authenticated:false,latency_ms:null};
  const started=Date.now();
  const response=await fetch('https://api.razorpay.com/v1/orders?count=1&skip=0',{method:'GET',headers:{Authorization:basicAuth()}});
  await response.text().catch(()=>null);
  return{credentials_configured:true,authenticated:response.ok,latency_ms:Date.now()-started};
}

module.exports=async function checkoutHealth(req,res){
  cors(req,res);
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  if(req.method!=='POST')return json(req,res,405,{error:'Method not allowed'});
  try{
    await readBody(req);
    const user=await requireAdminUser(req);
    const server_configured=Boolean(SUPABASE_URL&&SUPABASE_SERVICE_ROLE_KEY);
    const [activeProducts,ordersCount,activeVariants,inventoryRows,addressReady,rpcs,razorpay]=await Promise.all([
      countRows('products?is_active=eq.true&select=id'),
      countRows('orders?select=id'),
      countRows('product_variants?is_active=eq.true&select=id'),
      countRows('inventory_levels?select=variant_id'),
      currentUserAddressReady(user.id),
      checkoutRpcStatus(),
      razorpayStatus()
    ]);
    const webhookConfigured=Boolean(WEBHOOK_SECRET);
    const baseReady=server_configured&&activeProducts>0&&rpcs.ready&&addressReady;
    const codTestReady=baseReady;
    const prepaidTestReady=baseReady&&razorpay.authenticated&&webhookConfigured;
    const blockers=[];
    if(!server_configured)blockers.push('Supabase server configuration is incomplete.');
    if(activeProducts<1)blockers.push('Publish at least one active product before a real checkout test.');
    if(!addressReady)blockers.push('The current admin test account needs a saved delivery address before a real checkout test.');
    if(!rpcs.ready)blockers.push('Required checkout database RPCs are missing: '+rpcs.missing.join(', '));
    if(!razorpay.credentials_configured)blockers.push('Razorpay server credentials are not configured.');
    else if(!razorpay.authenticated)blockers.push('Razorpay API authentication failed.');
    if(!webhookConfigured)blockers.push('Razorpay webhook secret is not configured.');
    return json(req,res,200,{
      ok:true,
      checked_at:new Date().toISOString(),
      database:{server_configured,active_products:activeProducts,orders_count:ordersCount,active_variants:activeVariants,inventory_rows:inventoryRows},
      test_account:{delivery_address_ready:addressReady},
      checkout_rpcs:rpcs,
      razorpay:{...razorpay,webhook_secret_configured:webhookConfigured},
      cod_test_ready:codTestReady,
      prepaid_test_ready:prepaidTestReady,
      blockers
    });
  }catch(error){
    console.error('checkout health error:',error);
    return json(req,res,error.status||400,{ok:false,error:error.message||'Checkout readiness check failed'});
  }
};
