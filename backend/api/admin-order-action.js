const {SUPABASE_URL,serverHeaders,cors,json,readBody,requireAdminUser}=require('../lib');

async function rpc(name,args){
  const response=await fetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{...serverHeaders,'Content-Type':'application/json'},body:JSON.stringify(args)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.message||data?.error||'Order action failed');
  return data;
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
    if(!['collect_cod','cancel_cod'].includes(action))return json(req,res,400,{error:'Invalid order action'});
    const fn=action==='collect_cod'?'complete_cod_order_service':'cancel_cod_order_service';
    await rpc(fn,{p_order_id:id,p_admin_id:admin.id});
    return json(req,res,200,{ok:true,order_id:id,action});
  }catch(error){
    return json(req,res,error.status||400,{error:error.message||'Unable to update order'});
  }
};
