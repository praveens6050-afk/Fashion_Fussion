const PROJECT_URL='https://gmdevprqtvoshbbytsxf.supabase.co';
const PROJECT_PUBLISHABLE_KEY='sb_publishable_cBskcrMhDQhLLgTbYLFMuA_6nazgFVA';

function allowedOrigins(){
  return String(process.env.ALLOWED_ORIGIN||'https://admin.fashionfussion.in')
    .split(',').map(v=>v.trim()).filter(Boolean);
}

function accessToken(req){
  const value=String(req?.headers?.authorization||req?.headers?.Authorization||'');
  if(!value.startsWith('Bearer ')){
    const error=new Error('Please log in before continuing');
    error.status=401;
    throw error;
  }
  const token=value.slice(7).trim();
  if(!token){
    const error=new Error('Please log in before continuing');
    error.status=401;
    throw error;
  }
  return token;
}

async function getSupabaseUser(req){
  const origin=String(req?.headers?.origin||'').trim();
  if(origin&&!allowedOrigins().includes(origin)){
    const error=new Error('Origin not allowed');
    error.status=403;
    throw error;
  }
  const token=accessToken(req);
  const response=await fetch(PROJECT_URL+'/auth/v1/user',{
    headers:{apikey:PROJECT_PUBLISHABLE_KEY,Authorization:'Bearer '+token}
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data?.id){
    const error=new Error('Your login session has expired. Please log in again.');
    error.status=401;
    throw error;
  }
  return data;
}

async function requireAdminUser(req){
  const user=await getSupabaseUser(req);
  const token=accessToken(req);
  const response=await fetch(
    PROJECT_URL+'/rest/v1/profiles?id=eq.'+encodeURIComponent(user.id)+'&select=id,is_admin&limit=1',
    {headers:{apikey:PROJECT_PUBLISHABLE_KEY,Authorization:'Bearer '+token}}
  );
  const rows=await response.json().catch(()=>[]);
  if(!response.ok||!rows?.[0]?.is_admin){
    const error=new Error('Administrator access is required');
    error.status=403;
    throw error;
  }
  return user;
}

module.exports=function installAdminAuth(){
  const lib=require('./lib');
  lib.getSupabaseUser=getSupabaseUser;
  lib.requireAdminUser=requireAdminUser;
  return lib;
};
