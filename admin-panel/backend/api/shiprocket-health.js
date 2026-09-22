const {cors,json,readBody,requireAdminUser}=require('../lib');

const EMAIL=String(process.env.SHIPROCKET_EMAIL||'').trim();
const PASSWORD=String(process.env.SHIPROCKET_PASSWORD||'').trim();
const PICKUP_LOCATION=String(process.env.SHIPROCKET_PICKUP_LOCATION||'').trim();
const PICKUP_PINCODE=String(process.env.SHIPROCKET_PICKUP_PINCODE||'').trim();
const LOGIN_URL='https://apiv2.shiprocket.in/v1/external/auth/login';

module.exports=async function shiprocketHealth(req,res){
  cors(req,res);
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  if(req.method!=='POST')return json(req,res,405,{error:'Method not allowed'});
  try{
    await readBody(req);
    await requireAdminUser(req);
    if(!EMAIL||!PASSWORD){return json(req,res,503,{ok:false,provider:'shiprocket',authenticated:false,error:'Shiprocket API user credentials are not configured'})}
    const started=Date.now();
    const response=await fetch(LOGIN_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:EMAIL,password:PASSWORD})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data?.token){return json(req,res,502,{ok:false,provider:'shiprocket',authenticated:false,error:data?.message||'Shiprocket authentication failed'})}
    return json(req,res,200,{ok:true,provider:'shiprocket',authenticated:true,pickup_location_configured:Boolean(PICKUP_LOCATION),pickup_pincode_configured:/^\d{6}$/.test(PICKUP_PINCODE),serviceability_ready:Boolean(PICKUP_LOCATION&&/^\d{6}$/.test(PICKUP_PINCODE)),latency_ms:Date.now()-started,checked_at:new Date().toISOString()});
  }catch(error){console.error('shiprocket health error:',error);return json(req,res,error.status||400,{ok:false,provider:'shiprocket',authenticated:false,error:error.message||'Shiprocket connection test failed'})}
};
