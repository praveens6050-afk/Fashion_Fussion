function cleanHttpOrigin(value){
  const raw=String(value||'').trim().replace(/^['"]|['"]$/g,'');
  if(!raw)return '';
  try{
    const url=new URL(raw);
    if(!['https:','http:'].includes(url.protocol))return '';
    return url.origin;
  }catch{return ''}
}

function normalizeSupabaseEnv(){
  const current=cleanHttpOrigin(process.env.SUPABASE_URL);
  if(current){
    process.env.SUPABASE_URL=current;
    return current;
  }
  const candidates=[
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.PUBLIC_SUPABASE_URL,
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_PROJECT_URL,
    'https://gmdevprqtvoshbbytsxf.supabase.co'
  ];
  for(const candidate of candidates){
    const valid=cleanHttpOrigin(candidate);
    if(valid){
      console.warn('SUPABASE_URL is invalid; using a valid Supabase project URL fallback.');
      process.env.SUPABASE_URL=valid;
      return valid;
    }
  }
  return '';
}

module.exports=async function adminAction(req,res){
  try{
    normalizeSupabaseEnv();
    require('../backend/admin-auth-bootstrap.js')();
    const mode=String(req.query?.mode||'').trim();
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const action=String(body.action||'').trim();

    if(mode==='product-costs'){
      return require('../backend/api/admin-product-costs.js')(req,res);
    }
    if(action==='connection_test'){
      return require('../backend/api/shiprocket-health.js')(req,res);
    }
    if(action==='checkout_health'){
      return require('../backend/api/checkout-health.js')(req,res);
    }
    if(['config','admin_list','create_shipment','customer_status','check_serviceability','assign_awb','request_pickup','sync_tracking'].includes(action)){
      return require('../backend/api/shipping.js')(req,res);
    }
    if(body.quote_id!=null||action==='finalize'||action==='save_state'){
      return require('../backend/api/admin-business-quote-action.js')(req,res);
    }
    return require('../backend/api/admin-order-action.js')(req,res);
  }catch(error){
    console.error('admin API router error:',error);
    if(res.headersSent)return;
    res.statusCode=500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    return res.end(JSON.stringify({ok:false,error:error?.message||'Admin API failed to start'}));
  }
};
