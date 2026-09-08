const {SUPABASE_URL,serverHeaders,cors,json,requireAdminUser}=require('../lib');

module.exports=async function adminProductCosts(req,res){
  cors(req,res);
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  if(req.method!=='POST')return json(req,res,405,{error:'Method not allowed'});
  try{
    await requireAdminUser(req);
    const response=await fetch(SUPABASE_URL+'/rest/v1/products?select=id,cost&order=id.asc',{headers:serverHeaders});
    const rows=await response.json().catch(()=>[]);
    if(!response.ok)throw new Error(rows?.message||'Could not load product costs');
    return json(req,res,200,{products:Array.isArray(rows)?rows:[]});
  }catch(error){
    return json(req,res,error.status||400,{error:error.message||'Unable to load product costs'});
  }
};
