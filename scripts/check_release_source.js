const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const errors=[];
function read(file){return fs.readFileSync(path.join(root,file),'utf8')}
const release=read('api/release.js');
for(const marker of ['CF_PAGES_BRANCH','CF_PAGES_COMMIT_SHA','CF_PAGES_URL',"provider:'cloudflare-pages'","git_provider:'github'",'Cache-Control','no-store'])if(!release.includes(marker))errors.push(`api/release.js: missing ${marker}`);
if(/SERVICE_ROLE|SUPABASE_SERVICE|SHIPROCKET|RAZORPAY|PASSWORD|SECRET|TOKEN/.test(release))errors.push('api/release.js: release identity endpoint must not expose application secrets');
const workflow=read('.github/workflows/production-freshness.yml');
for(const marker of ['push:','branches: [cloudflare-customer]','EXPECTED_SHA: ${{ github.sha }}','https://fashionfussion.in/release.json','live_sha','Cross-panel Cloudflare smoke','exit 1'])if(!workflow.includes(marker))errors.push(`production-freshness.yml: missing ${marker}`);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('Cloudflare production release identity and freshness source guards passed');
