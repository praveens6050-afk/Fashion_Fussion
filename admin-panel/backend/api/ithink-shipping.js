'use strict';

const ACCESS_TOKEN=String(process.env.ITHINK_ACCESS_TOKEN||'').trim();
const SECRET_KEY=String(process.env.ITHINK_SECRET_KEY||'').trim();
const PICKUP_ADDRESS_ID=String(process.env.ITHINK_PICKUP_ADDRESS_ID||'').trim();
const RETURN_ADDRESS_ID=String(process.env.ITHINK_RETURN_ADDRESS_ID||PICKUP_ADDRESS_ID).trim();
const PICKUP_PINCODE=String(process.env.ITHINK_PICKUP_PINCODE||'').trim();
const API='https://my.ithinklogistics.com/api_v3';
const TRACK_API='https://api.ithinklogistics.com/api_v3';
const LOGISTICS=String(process.env.ITHINK_LOGISTICS||'delhivery').trim().toLowerCase();
const SERVICE_TYPE=String(process.env.ITHINK_SERVICE_TYPE||'').trim().toLowerCase();

function configured(){return Boolean(ACCESS_TOKEN&&SECRET_KEY&&PICKUP_ADDRESS_ID&&RETURN_ADDRESS_ID)}
function credentialsConfigured(){return Boolean(ACCESS_TOKEN&&SECRET_KEY)}
function positive(value,label){const n=Number(value);if(!Number.isFinite(n)||n<=0)throw new Error(label+' must be greater than zero');return n}
function phone(value){return String(value||'').replace(/\D/g,'').slice(-10)}
function date(value){const d=value?new Date(value):new Date();const p=n=>String(n).padStart(2,'0');return p(d.getDate())+'-'+p(d.getMonth()+1)+'-'+d.getFullYear()}
async function request(path,data,base=API){
  const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-cache'},body:JSON.stringify({data:{...data,access_token:ACCESS_TOKEN,secret_key:SECRET_KEY}})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||Number(result.status_code||200)>=400||String(result.status||'').toLowerCase()==='error'){
    const error=new Error(result.html_message||result.message||'iThink Logistics request failed');error.status=502;throw error;
  }
  return result;
}
function assertReady(){if(!configured()){const e=new Error('Configure ITHINK_ACCESS_TOKEN, ITHINK_SECRET_KEY, ITHINK_PICKUP_ADDRESS_ID and ITHINK_RETURN_ADDRESS_ID in the Cloudflare Admin environment.');e.status=503;throw e}}
function assertShippable(order){
  const fulfillment=String(order.fulfillment_status||'ordered').toLowerCase(),method=String(order.payment_method||'').toLowerCase(),status=String(order.status||'').toLowerCase();
  if(fulfillment!=='packed')throw new Error('Mark the order Packed before creating a courier shipment');
  if(method==='prepaid'&&status!=='paid')throw new Error('Only paid prepaid orders can be shipped');
  if(method==='cod'&&!['cod_pending','cod_collected'].includes(status))throw new Error('This COD order is not eligible for shipping');
  if(!['prepaid','cod'].includes(method))throw new Error('Unsupported payment method');
}
function packageProducts(order){
  const items=Array.isArray(order.items)?order.items:[];
  if(!items.length)throw new Error('Order has no items to ship');
  return items.slice(0,40).map((item,index)=>({
    product_name:String(item.name||'Product').slice(0,180),
    product_sku:String(item.sku||('FF-'+order.id+'-'+(index+1))).slice(0,80),
    product_quantity:String(Math.max(1,Number(item.qty)||1)),
    product_price:String(Math.max(0.01,Number(item.unit_price||item.price||item.line_total||0))),
    product_discount:'0'
  }));
}
function shipmentPayload(order,body,logistics){
  const a=order.shipping_address||{},mobile=phone(a.phone||order.customer_phone);
  if(!a.address_line1||!a.city||!a.state||!a.postal_code||!/^\d{6}$/.test(String(a.postal_code))||mobile.length!==10)throw new Error('Order delivery address needs a valid 10-digit phone and 6-digit pincode for iThink Logistics');
  const weightKg=positive(body.weight_kg,'Package weight');
  const box={length:positive(body.length_cm,'Package length'),width:positive(body.breadth_cm,'Package breadth'),height:positive(body.height_cm,'Package height')};
  const total=Math.max(0.01,Number(order.total_amount||0));
  const cod=String(order.payment_method).toLowerCase()==='cod';
  return {
    waybill:'',
    order:'FF-'+String(order.display_order_id||order.id).replace(/[^A-Za-z0-9_-]/g,'-'),
    sub_order:'',
    order_date:date(order.created_at),
    total_amount:String(total),
    name:String(a.full_name||order.customer_name||'Customer').slice(0,100),
    is_billing_same_as_shipping:'yes',
    billing_name:String(a.full_name||order.customer_name||'Customer').slice(0,100),
    billing_add:String(a.address_line1).slice(0,180),
    billing_add2:String(a.address_line2||'').slice(0,180),
    billing_add3:'',billing_pin:String(a.postal_code),billing_city:String(a.city).slice(0,80),
    billing_state:String(a.state).slice(0,80),billing_country:String(a.country||'India'),
    billing_phone:mobile,billing_email:String(order.customer_email||'').slice(0,120),
    add:String(a.address_line1).slice(0,180),
    add2:String(a.address_line2||'').slice(0,180),
    pin:String(a.postal_code),
    city:String(a.city).slice(0,80),
    state:String(a.state).slice(0,80),
    country:String(a.country||'India'),
    phone:mobile,
    email:String(order.customer_email||'').slice(0,120),
    products:packageProducts(order),
    shipment_length:String(box.length),
    shipment_width:String(box.width),
    shipment_height:String(box.height),
    weight:String(weightKg),
    cod_amount:cod?String(total):'0',
    payment_mode:cod?'COD':'Prepaid',
    return_address_id:RETURN_ADDRESS_ID
  };
}
async function checkServiceability(order,body){
  assertReady();assertShippable(order);
  if(!/^\d{6}$/.test(PICKUP_PINCODE)){const e=new Error('Set ITHINK_PICKUP_PINCODE to your 6-digit warehouse pincode to check iThink courier rates.');e.status=503;throw e}
  const a=order.shipping_address||{},to=String(a.postal_code||'');
  if(!/^\d{6}$/.test(to))throw new Error('Order delivery pincode is invalid');
  const data=await request('/rate/check.json',{
    from_pincode:PICKUP_PINCODE,to_pincode:to,
    shipping_length_cms:String(positive(body.length_cm,'Package length')),
    shipping_width_cms:String(positive(body.breadth_cm,'Package breadth')),
    shipping_height_cms:String(positive(body.height_cm,'Package height')),
    shipping_weight_kg:String(positive(body.weight_kg,'Package weight')),
    order_type:'forward',
    payment_method:String(order.payment_method).toLowerCase()==='cod'?'cod':'prepaid',
    product_mrp:String(Math.max(0,Number(order.total_amount||0)))
  });
  const rows=Array.isArray(data.data)?data.data:Object.values(data.data||{});
  const couriers=rows.filter(x=>x&&typeof x==='object').map((x)=>({
    courier_id:null,courier_name:x.logistic_name||null,logistics:x.logistic_name||null,
    logistics_service_type:x.logistic_service_type||'',rate:Number.isFinite(Number(x.rate))?Number(x.rate):null,
    estimated_delivery_days:x.delivery_tat==null?null:String(x.delivery_tat),
    prepaid:String(x.prepaid||'').toUpperCase()==='Y',cod:String(x.cod||'').toUpperCase()==='Y',
    pickup:String(x.pickup||'').toUpperCase()==='Y'
  })).filter(x=>x.courier_name);
  return {couriers,expected_delivery_date:data.expected_delivery_date||null};
}
async function createShipment(order,body,ctx){
  assertReady();assertShippable(order);
  const existing=await ctx.getShipment(order.id);
  if(existing?.provider_shipment_id||existing?.provider_order_id||existing?.awb_code)return{created:false,idempotent:true,shipment:ctx.safeShipment(existing)};
  const requested=String(body.logistics||LOGISTICS).trim();
  const allowed=['delhivery','bluedart','xpressbees','ecom','ekart'];
  const logistics=allowed.find(x=>x===requested.toLowerCase())||'delhivery';
  const payload=shipmentPayload(order,body,logistics);
  const result=await request('/order/add.json',{
    shipments:[payload],pickup_address_id:PICKUP_ADDRESS_ID,logistics,s_type:SERVICE_TYPE,order_type:'forward',api_source:'1'
  });
  const first=result.data?.['1']||Object.values(result.data||{})[0]||{};
  if(String(first.status||'').toLowerCase()!=='success'||!first.waybill){
    const error=new Error(first.remark||result.html_message||'iThink Logistics did not create the shipment or return an AWB');error.status=502;throw error;
  }
  const now=new Date().toISOString(),awb=String(first.waybill);
  const record={
    order_id:order.id,provider:'ithink',direction:'forward',
    provider_order_id:first.refnum?String(first.refnum):payload.order,
    provider_shipment_id:awb,awb_code:awb,courier_id:null,
    courier_name:first.logistic_name||logistics,status:'manifested',
    provider_status:'Manifested',tracking_url:first.tracking_url||('https://ithinklogistics.co.in/postship/tracking/'+encodeURIComponent(awb)),
    package_weight_kg:Number(body.weight_kg),package_length_cm:Number(body.length_cm),
    package_breadth_cm:Number(body.breadth_cm),package_height_cm:Number(body.height_cm),
    last_synced_at:now,updated_at:now
  };
  const rows=await ctx.rest('order_shipments?on_conflict=order_id,direction',{
    method:'POST',headers:{'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=representation'},
    body:JSON.stringify(record)
  });
  return{created:true,idempotent:false,shipment:ctx.safeShipment(rows?.[0]||record),provider_response:{awb_number:awb,logistics:first.logistic_name||logistics}};
}
async function syncTracking(orderId,ctx){
  const shipment=await ctx.getShipment(orderId);
  if(!shipment?.awb_code)throw new Error('AWB is required before tracking can be synced');
  const result=await request('/order/track.json',{awb_number_list:String(shipment.awb_code)},TRACK_API);
  const item=result.data?.[String(shipment.awb_code)]||Object.values(result.data||{})[0]||{};
  if(!item||!item.current_status)throw new Error('iThink Logistics returned no tracking status for this AWB');
  const status=String(item.current_status),normalized=status.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'tracking';
  const now=new Date().toISOString();
  const row=await ctx.updateShipment(orderId,{
    status:normalized,provider_status:status,
    tracking_url:shipment.tracking_url||('https://ithinklogistics.co.in/postship/tracking/'+encodeURIComponent(shipment.awb_code)),
    last_synced_at:now
  });
  return{synced:true,shipment:ctx.safeShipment(row),tracking:{current_status:status,expected_delivery_date:item.expected_delivery_date||null,last_scan:item.last_scan_details||null}};
}
async function checkConnection(){
  assertReady();
  if(!/^\d{6}$/.test(PICKUP_PINCODE)){const e=new Error('Set ITHINK_PICKUP_PINCODE to test the iThink Logistics connection.');e.status=503;throw e}
  const result=await request('/pincode/check.json',{pincode:PICKUP_PINCODE});
  return{ok:true,provider:'ithink',configured:true,pickup_pincode_configured:true,serviceable_pincodes_returned:Boolean(result.data?.[PICKUP_PINCODE])};
}
module.exports={configured,credentialsConfigured,checkServiceability,createShipment,syncTracking,checkConnection};
