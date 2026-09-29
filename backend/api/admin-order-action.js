const {SUPABASE_URL,serverHeaders,cors,json,readBody,requireAdminUser}=require('../lib');
const {reconcileRefundProcessor}=require('./refund-recovery');

const FULFILLMENT_NEXT={ordered:['packed'],packed:['shipped'],shipped:['out_for_delivery'],out_for_delivery:['delivered'],delivered:[],cancelled:[]};
const PAYMENT_EXCEPTION_RESOLUTIONS=new Set(['processor_refund_confirmed','duplicate_or_false_positive','support_review_completed']);

async function rest(path,options={}){
  const response=await fetch(SUPABASE_URL+'/rest/v1/'+path,{...options,headers:{...serverHeaders,...(options.headers||{})}});
  const data=await response.json().catch(()=>null);
  if(!response.ok){const error=new Error(data?.message||data?.error||'Admin database request failed');error.status=response.status;throw error}
  return data;
}
async function rpc(name,args={}){
  const response=await fetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{...serverHeaders,'Content-Type':'application/json'},body:JSON.stringify(args)});
  const data=await response.json().catch(()=>null);
  if(!response.ok){const error=new Error(data?.message||data?.error||'Order action failed');error.status=response.status;throw error}
  return data;
}
async function getOrder(id){const rows=await rest('orders?id=eq.'+encodeURIComponent(id)+'&select=id,user_id,status,payment_method,fulfillment_status&limit=1');if(!rows?.[0]){const error=new Error('Order not found');error.status=404;throw error}return rows[0]}
function validatePaymentState(order){const method=String(order.payment_method||'').toLowerCase(),status=String(order.status||'').toLowerCase();if(method==='prepaid'&&status!=='paid')throw new Error('Only paid prepaid orders can advance fulfillment');if(method==='cod'&&!['cod_pending','cod_collected'].includes(status))throw new Error('This COD order cannot advance fulfillment');if(!['prepaid','cod'].includes(method))throw new Error('Unsupported payment method')}
async function updateFulfillment(id,nextStatus){const next=String(nextStatus||'').trim().toLowerCase();if(!Object.prototype.hasOwnProperty.call(FULFILLMENT_NEXT,next))throw new Error('Invalid fulfillment status');if(next==='cancelled')throw new Error('Use the dedicated cancellation action for cancellations');const order=await getOrder(id);validatePaymentState(order);const current=String(order.fulfillment_status||'ordered').trim().toLowerCase();if(!Object.prototype.hasOwnProperty.call(FULFILLMENT_NEXT,current))throw new Error('Current fulfillment status is invalid');if(current===next)return {order_id:id,fulfillment_status:current,unchanged:true};if(!FULFILLMENT_NEXT[current].includes(next))throw new Error('Invalid fulfillment transition from '+current+' to '+next);const rows=await rest('orders?id=eq.'+encodeURIComponent(id)+'&fulfillment_status=eq.'+encodeURIComponent(current),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({fulfillment_status:next,fulfillment_updated_at:new Date().toISOString()})});if(!rows?.length)throw new Error('Order changed before this update. Refresh and try again.');return {order_id:id,fulfillment_status:next}}
async function listPaymentExceptions(){const rows=await rpc('admin_list_payment_exceptions');return Array.isArray(rows)?rows:[]}
async function resolvePaymentException(body){const exceptionId=Number(body.exception_id),resolutionCode=String(body.resolution_code||'').trim(),note=String(body.resolution_note||'').trim();if(!Number.isInteger(exceptionId)||exceptionId<1)throw new Error('Invalid payment exception ID');if(!PAYMENT_EXCEPTION_RESOLUTIONS.has(resolutionCode))throw new Error('Invalid resolution code');if(note.length<8||note.length>500)throw new Error('Resolution note must be 8 to 500 characters');const resolved=await rpc('admin_resolve_payment_exception',{p_exception_id:exceptionId,p_resolution_code:resolutionCode,p_resolution_note:note});const row=Array.isArray(resolved)?resolved[0]:resolved;if(!row?.exception_id){const error=new Error('Payment exception could not be resolved');error.status=409;throw error}return {exception_id:row.exception_id,order_id:row.order_id,status:row.status,payment_state_changed:false}}
async function reconcileCancelledResources(id){await rpc('admin_reconcile_cancelled_order_resources',{p_order_id:id});const order=await getOrder(id);return{order_id:id,status:order.status,fulfillment_status:order.fulfillment_status,resources_reconciled:true,payment_state_changed:false}}

module.exports=async function adminOrderAction(req,res){
  cors(req,res);
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  if(req.method!=='POST')return json(req,res,405,{error:'Method not allowed'});
  try{
    await requireAdminUser(req);
    const body=await readBody(req),action=String(body.action||'').trim();
    if(action==='list_payment_exceptions')return json(req,res,200,{ok:true,action,exceptions:await listPaymentExceptions()});
    if(action==='resolve_payment_exception')return json(req,res,200,{ok:true,action,...await resolvePaymentException(body)});
    const id=Number(body.order_id);
    if(!Number.isInteger(id)||id<1)return json(req,res,400,{error:'Invalid order ID'});
    if(!['collect_cod','cancel_cod','update_fulfillment','reconcile_cancelled_resources','reconcile_refund_processor'].includes(action))return json(req,res,400,{error:'Invalid order action'});
    if(action==='update_fulfillment')return json(req,res,200,{ok:true,action,...await updateFulfillment(id,body.fulfillment_status)});
    if(action==='reconcile_cancelled_resources')return json(req,res,200,{ok:true,action,...await reconcileCancelledResources(id)});
    if(action==='reconcile_refund_processor')return json(req,res,200,{ok:true,action,...await reconcileRefundProcessor(id)});
    await rpc(action==='collect_cod'?'admin_complete_cod_order':'admin_cancel_cod_order',{p_order_id:id});
    return json(req,res,200,{ok:true,order_id:id,action});
  }catch(error){return json(req,res,error.status||400,{error:error.message||'Unable to update order'})}
};
