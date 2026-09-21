const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const errors=[];
const PUBLIC_ORIGIN='https://fashionfussion.in';
const publicPages=['about.html','faq.html','business-buying.html','contact.html','terms.html','shipping-delivery.html','returns-refunds.html','privacy.html','security-policy.html'];
const sitemap=read('sitemap.xml');
const robots=read('robots.txt');
const homepageDiscovery=read('index.html')+'\n'+read('business-registration-trust.js');
const vercel=read('vercel.json');
const checkout=read('checkout.html');
for(const page of publicPages){
  if(!fs.existsSync(path.join(root,page)))errors.push(`missing public page ${page}`);
  const absolute=`${PUBLIC_ORIGIN}/${page}`;
  if(!sitemap.includes(`<loc>${absolute}</loc>`))errors.push(`sitemap missing ${page}`);
  if(robots.includes(`Disallow: /${page}`))errors.push(`robots incorrectly blocks ${page}`);
  if(!homepageDiscovery.includes(page))errors.push(`homepage discovery missing ${page}`);
  if(!vercel.includes(`\"source\": \"/${page}\"`)||!vercel.includes(`<${absolute}>; rel=\\\"canonical\\\"`))errors.push(`canonical header missing for ${page}`);
}
for(const page of ['admin.html','account.html','cart.html','checkout.html','login.html','wishlist.html','order-details.html'])if(!robots.includes(`Disallow: /${page}`))errors.push(`robots missing private-route block ${page}`);
for(const marker of ['X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Permissions-Policy','Content-Security-Policy'])if(!vercel.includes(marker))errors.push(`vercel security headers missing ${marker}`);
for(const directive of ["default-src 'self'","object-src 'none'","frame-ancestors 'none'","base-uri 'self'","upgrade-insecure-requests","script-src-attr 'none'"])if(!vercel.includes(directive))errors.push(`CSP missing ${directive}`);
if(/script-src[^;]*'unsafe-inline'/.test(vercel))errors.push("CSP script-src must not allow 'unsafe-inline'");
if(checkout.includes('https://checkout.razorpay.com/v1/checkout.js')){
  if(!vercel.includes("script-src 'self' https://cdn.jsdelivr.net https://checkout.razorpay.com"))errors.push('CSP script-src does not allow Razorpay Checkout');
  if(!vercel.includes("connect-src 'self' https://gmdevprqtvoshbbytsxf.supabase.co wss://gmdevprqtvoshbbytsxf.supabase.co https://*.razorpay.com"))errors.push('CSP connect-src does not allow Razorpay endpoints');
  if(!vercel.includes('frame-src https://*.razorpay.com'))errors.push('CSP frame-src does not allow Razorpay frames');
}
if(!vercel.includes('noindex, nofollow, noarchive'))errors.push('private-route noindex policy missing');
if(!read('index.html').includes('<meta name="description"'))errors.push('homepage meta description missing');
if(!sitemap.includes(`<loc>${PUBLIC_ORIGIN}/</loc>`))errors.push('sitemap missing homepage');
if(!robots.includes(`Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml`))errors.push('robots missing sitemap declaration');
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('Public launch contract passed.');
