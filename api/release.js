'use strict';

module.exports=function release(req,res){
  if(req.method!=='GET'&&req.method!=='HEAD'){
    res.statusCode=405;
    res.setHeader('Allow','GET, HEAD');
    return res.end(req.method==='HEAD'?'':JSON.stringify({error:'Method not allowed'}));
  }
  res.statusCode=200;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  const payload={
    ok:true,
    provider:'cloudflare-pages',
    git_provider:'github',
    git_ref:process.env.CF_PAGES_BRANCH||process.env.GITHUB_REF_NAME||null,
    git_sha:process.env.CF_PAGES_COMMIT_SHA||process.env.GITHUB_SHA||null,
    deployment_id:process.env.CF_PAGES_URL||null,
    environment:process.env.CF_PAGES_BRANCH==='cloudflare-customer'?'production':'preview'
  };
  if(req.method==='HEAD')return res.end();
  return res.end(JSON.stringify(payload));
};
