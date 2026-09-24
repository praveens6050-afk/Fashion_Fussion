'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const failures=[];
const providerToken=['ver','cel'].join('');
const retiredHostToken='.'+providerToken+'.app';
const retiredEnvPrefix=providerToken.toUpperCase()+'_';
const skipDirs=new Set(['.git','node_modules','dist','.wrangler','.cache']);
const binaryExt=new Set(['.png','.jpg','.jpeg','.gif','.webp','.ico','.pdf','.zip','.gz','.woff','.woff2','.ttf','.eot','.mp4','.mov','.avi']);

function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(skipDirs.has(entry.name))continue;
    const full=path.join(dir,entry.name);
    const rel=path.relative(root,full).replace(/\\/g,'/');
    const lower=rel.toLowerCase();
    if(lower.includes(providerToken))failures.push(`${rel}: retired-host filename/path remains`);
    if(entry.isDirectory()){walk(full);continue;}
    if(!entry.isFile()||binaryExt.has(path.extname(entry.name).toLowerCase()))continue;
    let text;
    try{text=fs.readFileSync(full,'utf8')}catch{continue}
    const lowerText=text.toLowerCase();
    if(lowerText.includes(providerToken))failures.push(`${rel}: retired-host provider reference remains`);
    if(lowerText.includes(retiredHostToken))failures.push(`${rel}: retired-host domain remains`);
    if(text.includes(retiredEnvPrefix))failures.push(`${rel}: retired-host environment variable remains`);
  }
}

walk(root);
if(failures.length){
  console.error('Cloudflare-only repository audit failed:');
  [...new Set(failures)].sort().forEach(item=>console.error(`- ${item}`));
  process.exit(1);
}
console.log('Cloudflare-only repository audit passed: no retired-host paths, domains, provider references or environment variables remain.');
