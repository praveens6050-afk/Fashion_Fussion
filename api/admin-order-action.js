const orderAction=require('../backend/api/admin-order-action.js');
const quoteAction=require('../backend/api/admin-business-quote-action.js');
const shippingAction=require('../backend/api/shipping.js');

module.exports=async function adminAction(req,res){
  const body=req.body&&typeof req.body==='object'?req.body:{};
  const action=String(body.action||'').trim();
  if(['config','admin_list','create_shipment','customer_status'].includes(action))return shippingAction(req,res);
  if(body.quote_id!=null||action==='finalize'||action==='save_state')return quoteAction(req,res);
  return orderAction(req,res);
};
