const { chromium } = require('playwright');

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';
const LEGACY_KEY='fashion_fussion_cart';
const LINE_KEY='fashion_fussion_cart_lines_v2';
const VARIANT_KEY='fashion_fussion_cart_variants';
const CHECKOUT_KEY='fashion_fussion_checkout_key';

(async()=>{
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  const failures=[];
  page.on('pageerror',err=>failures.push(`pageerror: ${err.message}`));

  const products=[
    {id:910001,name:'Single Variant Smoke',description:'single sellable option',category:'Smoke',price:299,rating:0,reviews:0,gst_rate:18,image_url:null,is_active:true,has_variants:true},
    {id:910002,name:'Multi Variant Smoke',description:'multiple sellable options',category:'Smoke',price:399,rating:0,reviews:0,gst_rate:18,image_url:null,is_active:true,has_variants:true},
    {id:910003,name:'Base Product Smoke',description:'no variants',category:'Smoke',price:199,rating:0,reviews:0,gst_rate:18,image_url:null,is_active:true,has_variants:false}
  ];

  await page.route('**/rest/v1/products*',async route=>{
    const req=route.request(),url=new URL(req.url()),accept=String(req.headers()['accept']||'');
    const idFilter=url.searchParams.get('id');
    let body=products;
    if(idFilter&&idFilter.startsWith('eq.')){
      const id=Number(idFilter.slice(3));
      const found=products.find(p=>p.id===id)||null;
      body=accept.includes('application/vnd.pgrst.object+json')?found:(found?[found]:[]);
    }
    await route.fulfill({status:200,headers:{'content-type':'application/json; charset=utf-8','content-range':'0-2/3'},body:JSON.stringify(body)});
  });

  await page.route('**/rest/v1/product_variants*',async route=>{
    const url=new URL(route.request().url()),filter=url.searchParams.get('product_id')||'';
    const id=Number(filter.replace(/^eq\./,''));
    const rows=id===910001?[{id:501,product_id:910001,is_active:true}]:id===910002?[{id:601,product_id:910002,is_active:true},{id:602,product_id:910002,is_active:true}]:[];
    await route.fulfill({status:200,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(rows)});
  });

  await page.route('**/rest/v1/rpc/get_variant_availability',async route=>{
    let payload={};try{payload=JSON.parse(route.request().postData()||'{}')}catch{}
    const id=Number(payload.p_product_id);
    const rows=id===910001?[{variant_id:501,in_stock:true}]:id===910002?[{variant_id:601,in_stock:true},{variant_id:602,in_stock:true}]:[];
    await route.fulfill({status:200,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(rows)});
  });

  const response=await page.goto(BASE+'/search.html',{waitUntil:'domcontentloaded',timeout:30000});
  if(!response||!response.ok())throw new Error('search page failed to load');
  await page.locator('[data-add="910001"]').waitFor({state:'visible',timeout:10000});
  await page.evaluate(key=>sessionStorage.setItem(key,'stale-checkout-key'),CHECKOUT_KEY);
  await page.locator('[data-add="910001"]').click();
  await page.waitForFunction(({lineKey})=>{const lines=JSON.parse(localStorage.getItem(lineKey)||'[]');return lines.some(x=>x.id===910001&&x.variant_id===501&&x.qty===1)},{lineKey:LINE_KEY});
  const singleState=await page.evaluate(({legacyKey,lineKey,variantKey,checkoutKey})=>({legacy:JSON.parse(localStorage.getItem(legacyKey)||'{}'),lines:JSON.parse(localStorage.getItem(lineKey)||'[]'),variants:JSON.parse(localStorage.getItem(variantKey)||'{}'),checkout:sessionStorage.getItem(checkoutKey)}),{legacyKey:LEGACY_KEY,lineKey:LINE_KEY,variantKey:VARIANT_KEY,checkoutKey:CHECKOUT_KEY});
  if(Number(singleState.legacy['910001'])!==1)throw new Error('single variant catalog add did not sync legacy cart');
  if(Number(singleState.variants['910001'])!==501)throw new Error('single variant catalog add did not persist selected variant');
  if(singleState.checkout!==null)throw new Error('catalog cart mutation did not invalidate checkout key');

  await page.locator('[data-add="910003"]').click();
  await page.waitForFunction(({lineKey})=>{const lines=JSON.parse(localStorage.getItem(lineKey)||'[]');return lines.some(x=>x.id===910003&&x.variant_id===null&&x.qty===1)},{lineKey:LINE_KEY});
  const baseLegacy=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),LEGACY_KEY);
  if(Number(baseLegacy['910003'])!==1)throw new Error('base catalog add did not sync legacy cart');

  await Promise.all([
    page.waitForURL(url=>url.pathname.endsWith('/product.html')&&url.searchParams.get('id')==='910002'),
    page.locator('[data-add="910002"]').click()
  ]);
  const multiState=await page.evaluate(({legacyKey,lineKey})=>({legacy:JSON.parse(localStorage.getItem(legacyKey)||'{}'),lines:JSON.parse(localStorage.getItem(lineKey)||'[]')}),{legacyKey:LEGACY_KEY,lineKey:LINE_KEY});
  if(multiState.legacy['910002']!=null||multiState.lines.some(x=>x.id===910002))throw new Error('multi-variant catalog add silently created a cart line');

  if(failures.length)throw new Error(failures.join('\n'));
  await context.close();
  await browser.close();
  console.log('Catalog variant cart smoke passed: single variant maps safely, base products sync, multi-variant requires selection.');
})().catch(err=>{console.error(err.stack||err);process.exit(1)});
