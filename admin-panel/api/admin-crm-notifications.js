'use strict';
const { withAdminRequest } = require('../backend/admin-auth-bootstrap.js');

function respond(req,res,status,body){
  const origin=String(req?.headers?.origin||'').trim();
  const allowed=String(process.env.ALLOWED_ORIGIN||'https://admin.fashionfussion.in,https://crm.fashionfussion.in')
    .split(',').map(v=>v.trim()).filter(Boolean);
  if(origin&&allowed.includes(origin))res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.statusCode=status;
  return res.end(JSON.stringify(body));
}

module.exports=async function adminCrmNotifications(req,res){
  if(req.method==='OPTIONS'){
    const origin=String(req?.headers?.origin||'').trim();
    const allowed=String(process.env.ALLOWED_ORIGIN||'https://admin.fashionfussion.in,https://crm.fashionfussion.in')
      .split(',').map(v=>v.trim()).filter(Boolean);
    if(origin&&!allowed.includes(origin))return respond(req,res,403,{ok:false,error:'Origin not allowed'});
    res.statusCode=204;res.setHeader('Cache-Control','no-store');return res.end();
  }
  if(req.method!=='POST')return respond(req,res,405,{ok:false,error:'Method not allowed'});
  try{
    return await withAdminRequest(req,async()=>{
      const lib=require('../backend/lib');
      await lib.requireAdminUser(req);
      const response=await fetch(lib.SUPABASE_URL+'/rest/v1/rpc/admin_crm_notification_snapshot',{
        method:'POST',
        headers:{...lib.serverHeaders,'Content-Type':'application/json'},
        body:'{}'
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok){
        const status=response.status===401?401:response.status===403?403:502;
        return respond(req,res,status,{ok:false,error:status===403?'Administrator access is required':'Notification diagnostics are temporarily unavailable'});
      }
      return respond(req,res,200,{ok:true,data:data&&typeof data==='object'?data:{}});
    });
  }catch(error){
    const status=error.status===401?401:error.status===403?403:500;
    return respond(req,res,status,{ok:false,error:status===401?'Please sign in again':status===403?'Administrator access is required':'CRM notification diagnostics are unavailable'});
  }
};
