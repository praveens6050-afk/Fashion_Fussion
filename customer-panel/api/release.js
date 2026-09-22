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
    provider:'vercel',
    git_provider:process.env.VERCEL_GIT_PROVIDER||null,
    git_ref:process.env.VERCEL_GIT_COMMIT_REF||null,
    git_sha:process.env.VERCEL_GIT_COMMIT_SHA||null,
    deployment_id:process.env.VERCEL_DEPLOYMENT_ID||null,
    environment:process.env.VERCEL_ENV||null
  };
  if(req.method==='HEAD')return res.end();
  return res.end(JSON.stringify(payload));
};
