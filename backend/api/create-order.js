const {KEY_ID,cors,json,readBody,calculate,basicAuth}=require("../lib");

module.exports=async function(req,res){
  cors(res);
  if(req.method==="OPTIONS"){res.statusCode=204;return res.end();}
  if(req.method!=="POST") return json(res,405,{error:"Method not allowed"});
  if(!KEY_ID||!process.env.RAZORPAY_KEY_SECRET) return json(res,500,{error:"Razorpay server keys are not configured"});
  try{
    const body=await readBody(req), calc=calculate(body.items);
    const receipt="FF_"+Date.now()+"_"+Math.random().toString(36).slice(2,8);
    const r=await fetch("https://api.razorpay.com/v1/orders",{
      method:"POST",headers:{"Authorization":basicAuth(),"Content-Type":"application/json"},
      body:JSON.stringify({amount:calc.total*100,currency:"INR",receipt,notes:{store:"Fashion_Fussion"}})
    });
    const data=await r.json();
    if(!r.ok) return json(res,502,{error:data.error?.description||"Razorpay order creation failed"});
    return json(res,200,{key_id:KEY_ID,order:data,items:calc.items});
  }catch(e){return json(res,400,{error:e.message||"Invalid request"});}
};
