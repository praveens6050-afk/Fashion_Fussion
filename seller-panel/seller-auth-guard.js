(function(){
'use strict';
function hasStoredSupabaseSession(storage){
  try{
    for(let i=0;i<storage.length;i++){
      const key=String(storage.key(i)||'');
      if(!/^sb-.*-auth-token(?:\.|$)/i.test(key))continue;
      const raw=storage.getItem(key);
      if(!raw)continue;
      try{
        const value=JSON.parse(raw);
        const candidate=Array.isArray(value)?value[0]:value;
        if(candidate&&typeof candidate==='object'&&(candidate.access_token||candidate.currentSession?.access_token||candidate.session?.access_token))return true;
      }catch{
        if(raw.length>40)return true;
      }
    }
  }catch{}
  return false;
}
if(!hasStoredSupabaseSession(localStorage)&&!hasStoredSupabaseSession(sessionStorage)){
  location.replace('/login');
}
})();
