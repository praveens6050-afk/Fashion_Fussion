const {SUPABASE_URL,serverHeaders,cors,json,readBody,requireAdminUser}=require('../lib');

const FULFILLMENT_NEXT={
  ordered:['packed'],
  packed:['shipped'],
  shipped:['out_for_delivery'],
  out_for_delivery:['delivered'],
  delivered:[],
  cancelled:[]
};

async function rpc(name,args){
  const response=await fetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{...serverHeaders,'Content-Type':'application/json'},body:JSON.stringify(args)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.message||data?.error||'Order action failed');
  return data;
}

async function getOrder(id){
  const response=await fetch(
    SUPABASE_URL+'/rest/v1/orders?id=eq.'+encodeURIComponent(id)+'&select=id,status,payment_method,fulfillment_status&limit=1',
    {headers:serverHeaders}
  );
  const rows=await response.json().catch(()=>[]);
  if(!response.ok)throw new Error(rows?.message||rows?.error||'Could not load order');
  if(!rows?.[0]){
    const error=new Error('Order not found');
    error.status=404;
    throw error;
  }
  return rows[0];
}

function validatePaymentState(order){
  const method=String(order.payment_method||'').toLowerCase();
  const status=String(order.status||'').toLowerCase();
  if(method==='prepaid'&&status!=='paid')throw new Error('Only paid prepaid orders can advance fulfillment');
  if(method==='cod'&&!['cod_pending','cod_collected'].includes(status))throw new Error('This COD order cannot advance fulfillment');
  if(!['prepaid','cod'].includes(method))throw new Error('Unsupported payment method');
}

async function updateFulfillment(id,nextStatus){
  const next=String(nextStatus||'').trim().toLowerCase();
  if(!Object.prototype.hasOwnProperty.call(FULFILLMENT_NEXT,next))throw new Error('Invalid fulfillment status');
  if(next==='cancelled')throw new Error('Use the dedicated cancellation action for cancellations');

  const order=await getOrder(id);
  validatePaymentState(order);
  const current=String(order.fulfillment_status||'ordered').trim().toLowerCase();
  if(!Object.prototype.hasOwnProperty.call(FULFILLMENT_NEXT,current))throw new Error('Current fulfillment status is invalid');
  if(current===next)return {order_id:id,fulfillment_status:current,unchanged:true};
  if(!FULFILLMENT_NEXT[current].includes(next))throw new Error('Invalid fulfillment transition from '+current+' to '+next);

  const response=await fetch(
    SUPABASE_URL+'/rest/v1/orders?id=eq.'+encodeURIComponent(id)+'&fulfillment_status=eq.'+encodeURIComponent(current),
    {
      method:'PATCH',
      headers:{...serverHeaders,'Content-Type':'application/json','Prefer':'return=representation'},
      body:JSON.stringify({fulfillment_status:next,fulfillment_updated_at:new Date().toISOString()})
    }
  );
  const rows=await response.json().catch(()=>[]);
  if(!response.ok)throw new Error(rows?.message||rows?.error||'Could not update fulfillment');
  if(!rows?.length)throw new Error('Order changed before this update. Refresh and try again.');
  return {order_id:id,fulfillment_status:next};
}

module.exports=async function adminOrderAction(req,res){
  cors(req,res);
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  if(req.method!=='POST')return json(req,res,405,{error:'Method not allowed'});
  try{
    const admin=await requireAdminUser(req);
    const body=await readBody(req);
    const id=Number(body.order_id);
    const action=String(body.action||'').trim();
    if(!Number.isInteger(id)||id<1)return json(req,res,400,{error:'Invalid order ID'});
    if(!['collect_cod','cancel_cod','update_fulfillment'].includes(action))return json(req,res,400,{error:'Invalid order action'});

    if(action==='update_fulfillment'){
      const result=await updateFulfillment(id,body.fulfillment_status);
      return json(req,res,200,{ok:true,action,...result});
    }

    const fn=action==='collect_cod'?'complete_cod_order_service':'cancel_cod_order_service';
    await rpc(fn,{p_order_id:id,p_admin_id:admin.id});
    return json(req,res,200,{ok:true,order_id:id,action});
  }catch(error){
    return json(req,res,error.status||400,{error:error.message||'Unable to update order'});
  }
};
