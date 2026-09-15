const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const exists=file=>fs.existsSync(path.join(root,file));
const errors=[];
const publicPages=['about.html','faq.html','business-buying.html','contact.html','terms.html','shipping-delivery.html','returns-refunds.html','privacy.html','security-policy.html'];
const privatePages=['admin.html','admin-account.html','admin-login.html','account.html','cart.html','checkout.html','quote-checkout.html','login.html','signup.html','reset-password.html','wishlist.html','notifications.html','coupons.html','gift-cards.html','order-confirmation.html','order-details.html','order-status.html','order-tracking.html'];
const sitemap=read('sitemap.xml');
const robots=read('robots.txt');
const trust=read('business-registration-trust.js');
const vercel=read('vercel.json');
const index=read('index.html');
for(const page of publicPages){
  if(!exists(page))errors.push(`missing public page ${page}`);
  const absolute=`https://fashion-fussion-olive.vercel.app/${page}`;
  if(!sitemap.includes(`<loc>${absolute}</loc>`))errors.push(`sitemap missing ${page}`);
  if(robots.includes(`Disallow: /${page}`))errors.push(`robots incorrectly blocks ${page}`);
  if(!trust.includes(`'${page}'`)&&!trust.includes(`\"${page}\"`))errors.push(`homepage discovery script missing ${page}`);
  if(!vercel.includes(`\"source\": \"/${page}\"`)||!vercel.includes(`<${absolute}>; rel=\\\"canonical\\\"`))errors.push(`canonical header missing for ${page}`);
}
for(const page of privatePages){
  if(!robots.includes(`Disallow: /${page}`))errors.push(`robots missing private-route block ${page}`);
}
for(const marker of ['X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Permissions-Policy'])if(!vercel.includes(marker))errors.push(`vercel security headers missing ${marker}`);
for(const page of ['search.html','product.html'])if(!vercel.includes(`\"source\": \"/${page}\"`))errors.push(`missing noindex route declaration for ${page}`);
if(!vercel.includes('noindex, nofollow, noarchive'))errors.push('private-route noindex policy missing');
if(!index.includes('<meta name="description"'))errors.push('homepage meta description missing');
if(!sitemap.includes('<loc>https://fashion-fussion-olive.vercel.app/</loc>'))errors.push('sitemap missing homepage');
if(!robots.includes('Sitemap: https://fashion-fussion-olive.vercel.app/sitemap.xml'))errors.push('robots missing sitemap declaration');
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('Public launch source guard passed: public discovery, sitemap, robots, canonical and security-header contracts are intact.');
