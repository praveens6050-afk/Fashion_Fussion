const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PRODUCTS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'products.json'), 'utf8')
);
const BY_ID = new Map(PRODUCTS.map(p=>[p.id,p]));
const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

function cors(res){
  const origin=process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin",origin);
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}
function json(res,status,body){res.statusCode=status;res.setHeader("Content-Type","application/json");cors(res);res.end(JSON.stringify(body));}
function readBody(req){
  return new Promise((resolve,reject)=>{let s="";req.on("data",c=>s+=c);req.on("end",()=>{try{resolve(JSON.parse(s||"{}"))}catch(e){reject(e)}});req.on("error",reject)});
}
function calculate(items){
  if(!Array.isArray(items)||!items.length) throw new Error("Cart is empty");
  let total=0;
  const normalized=items.map(x=>{
    const id=Number(x.id), qty=Number(x.qty), p=BY_ID.get(id);
    if(!p||!Number.isInteger(qty)||qty<1||qty>20) throw new Error("Invalid cart item");
    const line=p.price*qty; total+=line;
    return {id,qty,name:p.name,unit_price:p.price,line_total:line};
  });
  if(total<1) throw new Error("Invalid order amount");
  return {items:normalized,total};
}
function basicAuth(){return "Basic "+Buffer.from(KEY_ID+":"+KEY_SECRET).toString("base64");}
module.exports={PRODUCTS,KEY_ID,KEY_SECRET,cors,json,readBody,calculate,basicAuth};
