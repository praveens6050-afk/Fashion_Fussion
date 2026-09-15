const { chromium }=require('playwright');
const BASE=process.env.SMOKE_BASE_URL||'http://127.0.0.1:4173';
const routes=['/index.html','/about.html','/faq.html','/business-buying.html','/contact.html','/terms.html','/shipping-delivery.html','/returns-refunds.html','/privacy.html','/security-policy.html'];
const footerLinks=['about.html','faq.html','business-buying.html','contact.html','terms.html','shipping-delivery.html','returns-refunds.html','privacy.html','security-policy.html'];
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  for(const route of routes){
    const response=await page.goto(BASE+route,{waitUntil:'domcontentloaded',timeout:30000});
    if(!response||!response.ok())throw new Error(`${route} returned ${response&&response.status()}`);
    const title=String(await page.title()).trim();
    if(!title)throw new Error(`${route} has no document title`);
    const metaNoindex=await page.locator('meta[name="robots"][content*="noindex" i]').count();
    if(metaNoindex)throw new Error(`${route} unexpectedly contains a noindex meta tag`);
  }
  await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('footer a[href="faq.html"]').waitFor({state:'attached',timeout:10000});
  for(const href of footerLinks){
    if(!(await page.locator(`footer a[href="${href}"]`).count()))throw new Error(`homepage footer discovery missing ${href}`);
  }
  const businessLinks=await page.locator('a[href="business-buying.html"]').count();
  if(businessLinks<2)throw new Error('homepage business buying discovery is not wired across navigation/content');
  await browser.close();
  console.log('Public launch browser smoke passed: public pages load and homepage Help/Company/Legal discovery is intact.');
})().catch(err=>{console.error(err.stack||err);process.exit(1)});
