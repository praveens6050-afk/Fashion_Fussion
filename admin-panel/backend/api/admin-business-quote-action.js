const {SUPABASE_URL,serverHeaders,cors,json,readBody,requireAdminUser}=require('../lib');

const MANUAL_STATUS=new Set(['requested','under_review','rejected','cancelled']);
const LOCKED_STATUS=new Set(['accepted','ordered','expired','cancelled']);

async function rest(path,options={}){
  const response=await fetch(SUPABASE_URL+'/rest/v1/'+path,{...options,headers:{...serverHeaders,...(options.headers||{})}});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.message||data?.error||'Business quote action failed');
  return data;
}

async function rpc(name,args){
  return rest('rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
}

async function getQuote(id){
  const rows=await rest('bulk_quotes?id=eq.'+encodeURIComponent(id)+'&select=id,status&limit=1');
  if(!rows?.[0]){
    const error=new Error('Quote not found');
    error.status=404;
    throw error;
  }
  return rows[0];
}

function cleanNote(value){
  const note=String(value??'').trim();
  if(note.length>1000)throw new Error('Admin note is too long');
  return note||null;
}

function cleanValidUntil(value){
  if(value==null||value==='')return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw new Error('Invalid quote validity date');
  return date.toISOString();
}

function cleanPrices(value){
  if(!Array.isArray(value)||!value.length)throw new Error('At least one quote item price is required');
  if(value.length>100)throw new Error('Too many quote items');
  const seen=new Set();
  return value.map(item=>{
    const itemId=Number(item?.item_id);
    const price=Number(item?.quoted_unit_price);
    if(!Number.isInteger(itemId)||itemId<1)throw new Error('Invalid quote item');
    if(seen.has(itemId))throw new Error('Duplicate quote item');
    seen.add(itemId);
    if(!Number.isFinite(price)||price<=0||price>10000000)throw new Error('Invalid quoted unit price');
    return {item_id:itemId,quoted_unit_price:Math.round(price*100)/100};
  });
}

module.exports=async function adminBusinessQuoteAction(req,res){
  cors(req,res);
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  if(req.method!=='POST')return json(req,res,405,{error:'Method not allowed'});
  try{
    await requireAdminUser(req);
    const body=await readBody(req);
    const id=Number(body.quote_id);
    const action=String(body.action||'').trim();
    if(!Number.isInteger(id)||id<1)return json(req,res,400,{error:'Invalid quote ID'});
    if(!['finalize','save_state'].includes(action))return json(req,res,400,{error:'Invalid quote action'});

    const quote=await getQuote(id);
    const current=String(quote.status||'').trim().toLowerCase();
    if(LOCKED_STATUS.has(current))return json(req,res,409,{error:'This quote is read-only'});

    if(action==='finalize'){
      const prices=cleanPrices(body.item_prices);
      const validUntil=cleanValidUntil(body.valid_until);
      const note=cleanNote(body.admin_note);
      await rpc('finalize_bulk_quote',{p_quote_id:id,p_item_prices:prices,p_valid_until:validUntil,p_admin_note:note});
      return json(req,res,200,{ok:true,quote_id:id,action});
    }

    const status=String(body.status||'').trim().toLowerCase();
    if(!MANUAL_STATUS.has(status))return json(req,res,400,{error:'Invalid admin status'});
    const payload={
      status,
      admin_note:cleanNote(body.admin_note),
      valid_until:cleanValidUntil(body.valid_until),
      updated_at:new Date().toISOString()
    };
    const rows=await rest(
      'bulk_quotes?id=eq.'+encodeURIComponent(id)+'&status=not.in.(accepted,ordered,expired,cancelled)',
      {method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(payload)}
    );
    if(!rows?.length)return json(req,res,409,{error:'Quote changed before this update. Refresh and try again.'});
    return json(req,res,200,{ok:true,quote_id:id,action,status});
  }catch(error){
    return json(req,res,error.status||400,{error:error.message||'Unable to update business quote'});
  }
};
