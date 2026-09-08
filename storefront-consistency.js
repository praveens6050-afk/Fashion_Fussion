(function(){
  const replacements=[
    [/₹599/g,'₹299'],
    [/above ₹599/gi,'above ₹299'],
    [/9am\s*[–-]\s*7pm/gi,'24/7']
  ];
  function fixText(root=document.body){
    if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let n;
    while((n=walker.nextNode())){
      let t=n.nodeValue;
      if(!t)continue;
      let out=t;
      for(const [re,to] of replacements)out=out.replace(re,to);
      if(out!==t)n.nodeValue=out;
    }
  }
  function fix(){fixText(document.body)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fix);else fix();
  const obs=new MutationObserver(()=>fix());
  if(document.documentElement)obs.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
})();