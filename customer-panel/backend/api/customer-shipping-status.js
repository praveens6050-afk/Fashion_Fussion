const {SUPABASE_URL,serverHeaders,cors,json,readBody,getSupabaseUser}=require('../lib');

async function rest(path){
  const response=await fetch(SUPABASE_URL+'/rest/v1/'+path,{headers:serverHeaders});
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const error=new Error(data?.message||data?.error||'Shipping status request failed');
    error.status=response.status;
    throw error;
  }
  return data;
}

async function getOrderByKey(key){
  const value=String(key||'').trim();
  if(!value){const error=new Error('Invalid order reference');error.status=400;throw error}
  const filter=/^\d+$/.test(value)?'id=eq.'+encodeURIComponent(value):'display_order_id=eq.'+encodeURIComponent(value);
  const select='id,user_id';
  const rows=await rest('orders?'+filter+'&select='+select+'&limit=1');
  if(!rows?.[0]){const error=new Error('Order not found');error.status=404;throw error}
  return rows[0];
}

async function getShipment(orderId){
  const rows=await rest('order_shipments?order_id=eq.'+encodeURIComponent(orderId)+'&direction=eq.forward&select=provider,courier_name,awb_code,status,provider_status,tracking_url,pickup_requested_at,last_synced_at,created_at&limit=1');
  return rows?.[0]||null;
}

function safeShipment(row){
  if(!row)return null;
  return{
    provider:row.provider||null,
    courier_name:row.courier_name||null,
    awb_code:row.awb_code||null,
    status:row.status||'pending',
    provider_status:row.provider_status||null,
    tracking_url:row.tracking_url||null,
    pickup_requested_at:row.pickup_requested_at||null,
    last_synced_at:row.last_synced_at||null,
    created_at:row.created_at||null
  };
}

module.exports=async function customerShippingStatus(req,res){
  cors(req,res);
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  if(req.method!=='POST')return json(req,res,405,{error:'Method not allowed'});
  try{
    const body=await readBody(req);
    const user=await getSupabaseUser(req);
    const order=await getOrderByKey(body.order_key??body.order_id);
    if(String(order.user_id)!==String(user.id))return json(req,res,404,{error:'Order not found'});
    return json(req,res,200,{ok:true,shipment:safeShipment(await getShipment(order.id))});
  }catch(error){
    const status=Number(error?.status)||400;
    if(status>=500)console.error('customer shipping status error:',error);
    return json(req,res,status,{error:error?.message||'Shipping status unavailable'});
  }
};
