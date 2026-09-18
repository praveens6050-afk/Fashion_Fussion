const orderAction=require('../backend/api/admin-order-action.js');
const quoteAction=require('../backend/api/admin-business-quote-action.js');
const shippingAction=require('../backend/api/shipping.js');
const shiprocketHealth=require('../backend/api/shiprocket-health.js');
const checkoutHealth=require('../backend/api/checkout-health.js');
const productCosts=require('../backend/api/admin-product-costs.js');

module.exports=async function adminAction(req,res){
  const mode=String(req.query?.mode||'').trim();
  if(mode==='product-costs')return productCosts(req,res);
  const body=req.body&&typeof req.body==='object'?req.body:{};
  const action=String(body.action||'').trim();
  if(action==='connection_test')return shiprocketHealth(req,res);
  if(action==='checkout_health')return checkoutHealth(req,res);
  if(['config','admin_list','create_shipment','customer_status','check_serviceability','assign_awb','request_pickup','sync_tracking'].includes(action))return shippingAction(req,res);
  if(body.quote_id!=null||action==='finalize'||action==='save_state')return quoteAction(req,res);
  return orderAction(req,res);
};
