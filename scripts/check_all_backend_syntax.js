const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');

function walk(dir){
  const out=[];
  for(const name of fs.readdirSync(dir)){
    const full=path.join(dir,name);
    const stat=fs.statSync(full);
    if(stat.isDirectory())out.push(...walk(full));
    else if(stat.isFile()&&full.endsWith('.js'))out.push(full);
  }
  return out;
}

const roots=['api','backend'].filter(fs.existsSync);
const files=roots.flatMap(walk).sort();
if(!files.length)throw new Error('No JavaScript API/backend files found');
let failed=false;
for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.status!==0)failed=true;
}
if(failed)process.exit(1);
console.log(`Backend syntax OK: ${files.length} JavaScript files checked.`);
