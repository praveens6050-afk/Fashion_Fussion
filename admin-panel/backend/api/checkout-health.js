const {
  KEY_ID,KEY_SECRET,WEBHOOK_SECRET,SUPABASE_URL,
  serverHeaders,cors,json,readBody,requireAdminUser,basicAuth
}=require('../lib');

async function checkoutSnapshot(){
  const response=await fetch(SUPABASE_URL+'/rest/v1/rpc/admin_checkout_readiness_snapshot',{
    method:'POST',
    headers:{...serverHeaders,'Content-Type':'application/json'},
    body:'{}'
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok){const error=new Error(data?.message||data?.error||'Checkout readiness database check failed');error.status=response.status;throw error}
  return data&&typeof data==='object'?data:{};
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
    await requireAdminUser(req);
    const [snapshot,razorpay]=await Promise.all([checkoutSnapshot(),razorpayStatus()]);
    const activeProducts=Number(snapshot.active_products||0);
    const ordersCount=Number(snapshot.orders_count||0);
    const activeVariants=Number(snapshot.active_variants||0);
    const inventoryRows=Number(snapshot.inventory_rows||0);
    const addressReady=Boolean(snapshot.delivery_address_ready);
    const rpcs={ready:Boolean(snapshot.checkout_rpcs_ready),missing:Array.isArray(snapshot.missing_rpcs)?snapshot.missing_rpcs:[]};
    const webhookConfigured=Boolean(WEBHOOK_SECRET);
    const baseReady=activeProducts>0&&rpcs.ready&&addressReady;
    const codTestReady=baseReady;
    const prepaidTestReady=baseReady&&razorpay.authenticated&&webhookConfigured;
    const blockers=[];
    if(activeProducts<1)blockers.push('Publish at least one active product before a real checkout test.');
    if(!addressReady)blockers.push('The current admin test account needs a saved delivery address before a real checkout test.');
    if(!rpcs.ready)blockers.push('Required checkout database RPCs are missing: '+rpcs.missing.join(', '));
    if(!razorpay.credentials_configured)blockers.push('Razorpay server credentials are not configured.');
    else if(!razorpay.authenticated)blockers.push('Razorpay API authentication failed.');
    if(!webhookConfigured)blockers.push('Razorpay webhook secret is not configured.');
    return json(req,res,200,{
      ok:true,
      checked_at:new Date().toISOString(),
      database:{server_configured:true,active_products:activeProducts,orders_count:ordersCount,active_variants:activeVariants,inventory_rows:inventoryRows},
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
