(function(){
  'use strict';
  const originalFetch=window.fetch.bind(window);
  const createOrderUrl='https://fashion-fussion-olive.vercel.app/api/create-order';

  function hasFullAddress(value){
    return Boolean(
      value &&
      String(value.full_name||'').trim() &&
      String(value.phone||'').trim() &&
      String(value.address_line1||'').trim() &&
      String(value.city||'').trim() &&
      String(value.state||'').trim() &&
      String(value.postal_code||'').trim()
    );
  }

  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:String(input&&input.url||'');
    const method=String(init&&init.method||'GET').toUpperCase();
    if(url!==createOrderUrl||method!=='POST'||!init||typeof init.body!=='string'){
      return originalFetch(input,init);
    }

    try{
      const payload=JSON.parse(init.body);
      const addressId=payload&&payload.shipping_address&&payload.shipping_address.id;
      if(addressId&&!hasFullAddress(payload.shipping_address)&&window.supabaseClient){
        const result=await window.supabaseClient
          .from('customer_addresses')
          .select('id,label,full_name,phone,address_line1,address_line2,city,state,postal_code,country')
          .eq('id',addressId)
          .maybeSingle();
        if(!result.error&&result.data){
          payload.shipping_address=result.data;
          init={...init,body:JSON.stringify(payload)};
        }
      }
    }catch(error){
      console.warn('Checkout address compatibility fallback skipped:',error);
    }

    return originalFetch(input,init);
  };
})();
