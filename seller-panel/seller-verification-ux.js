'use strict';
(()=>{
  if(window.__ffSellerVerificationUx)return;
  window.__ffSellerVerificationUx=true;

  const $=id=>document.getElementById(id);
  const notify=message=>window.SellerCatalogBridge?.notify?.(message)||console.info(message);
  const BANKS=[
    ['','Select bank'],
    ['STATE BANK OF INDIA','State Bank of India'],
    ['HDFC BANK','HDFC Bank'],
    ['ICICI BANK','ICICI Bank'],
    ['AXIS BANK','Axis Bank'],
    ['KOTAK MAHINDRA BANK','Kotak Mahindra Bank'],
    ['PUNJAB NATIONAL BANK','Punjab National Bank'],
    ['BANK OF BARODA','Bank of Baroda'],
    ['CANARA BANK','Canara Bank'],
    ['UNION BANK OF INDIA','Union Bank of India'],
    ['BANK OF INDIA','Bank of India'],
    ['INDIAN BANK','Indian Bank'],
    ['CENTRAL BANK OF INDIA','Central Bank of India'],
    ['INDIAN OVERSEAS BANK','Indian Overseas Bank'],
    ['UCO BANK','UCO Bank'],
    ['BANK OF MAHARASHTRA','Bank of Maharashtra'],
    ['IDBI BANK','IDBI Bank'],
    ['YES BANK','YES Bank'],
    ['INDUSIND BANK','IndusInd Bank'],
    ['FEDERAL BANK','Federal Bank'],
    ['IDFC FIRST BANK','IDFC FIRST Bank'],
    ['RBL BANK','RBL Bank'],
    ['BANDHAN BANK','Bandhan Bank'],
    ['CSB BANK','CSB Bank'],
    ['DCB BANK','DCB Bank'],
    ['KARNATAKA BANK','Karnataka Bank'],
    ['KARUR VYSYA BANK','Karur Vysya Bank'],
    ['CITY UNION BANK','City Union Bank'],
    ['TAMILNAD MERCANTILE BANK','Tamilnad Mercantile Bank'],
    ['SOUTH INDIAN BANK','South Indian Bank'],
    ['JAMMU AND KASHMIR BANK','Jammu & Kashmir Bank'],
    ['AU SMALL FINANCE BANK','AU Small Finance Bank'],
    ['EQUITAS SMALL FINANCE BANK','Equitas Small Finance Bank'],
    ['UJJIVAN SMALL FINANCE BANK','Ujjivan Small Finance Bank'],
    ['ESAF SMALL FINANCE BANK','ESAF Small Finance Bank'],
    ['JANA SMALL FINANCE BANK','Jana Small Finance Bank'],
    ['SURYODAY SMALL FINANCE BANK','Suryoday Small Finance Bank'],
    ['AIRTEL PAYMENTS BANK','Airtel Payments Bank'],
    ['INDIA POST PAYMENTS BANK','India Post Payments Bank'],
    ['FINO PAYMENTS BANK','Fino Payments Bank'],
    ['JIO PAYMENTS BANK','Jio Payments Bank'],
    ['OTHER BANK','Other / Co-operative bank']
  ];

  function cleanHolder(value){
    return String(value||'').replace(/[^\p{L}\s]/gu,'').replace(/\s{2,}/g,' ').replace(/^\s+/,'');
  }

  function holderIsValid(value){
    const name=String(value||'').trim();
    return Boolean(name)&&/^[\p{L}]+(?:\s+[\p{L}]+)*$/u.test(name);
  }

  function ensureHolderInput(){
    const input=$('ffHolderName');
    if(!input)return;
    input.inputMode='text';
    input.autocomplete='name';
    input.placeholder='Account holder name';
    const label=input.closest('label');
    if(label&&label.childNodes?.[0])label.childNodes[0].textContent='Account holder name';
  }

  async function ensureBankSelect(){
    const existing=$('ffBankName');
    if(!existing)return;
    if(existing.tagName==='SELECT')return;
    const current=String(existing.value||'').trim();
    const select=document.createElement('select');
    select.id='ffBankName';
    select.name=existing.name||'';
    select.setAttribute('aria-label','Bank name');
    for(const [value,label] of BANKS){const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option)}
    if(current&&!Array.from(select.options).some(o=>o.value.toUpperCase()===current.toUpperCase())){
      const option=document.createElement('option');option.value=current;option.textContent=current;select.appendChild(option);
    }
    const match=Array.from(select.options).find(o=>o.value.toUpperCase()===current.toUpperCase());
    if(match)select.value=match.value;
    existing.replaceWith(select);
    try{
      const client=window.supabaseClient;
      if(client){
        const {data}=await client.rpc('get_seller_finance_profile');
        const saved=String(data?.payout?.bank_name||'').trim();
        if(saved){
          let option=Array.from(select.options).find(o=>o.value.toUpperCase()===saved.toUpperCase());
          if(!option){option=document.createElement('option');option.value=saved;option.textContent=saved;select.appendChild(option)}
          select.value=option.value;
        }
      }
    }catch{}
  }

  function updateHints(){
    if($('ffPanProviderState')?.textContent?.startsWith('Provider ready'))$('ffPanProviderState').textContent='Provider ready — Verify PAN will save and verify automatically.';
    if($('ffGstProviderState')?.textContent?.startsWith('GST provider ready'))$('ffGstProviderState').textContent='GST provider ready — Verify GSTIN will save and verify automatically.';
  }

  async function session(){
    const client=window.supabaseClient;
    if(!client)throw new Error('Seller verification service is not ready');
    const {data:{session},error}=await client.auth.getSession();
    if(error)throw error;
    if(!session?.access_token)throw new Error('Seller session expired');
    return session;
  }

  function setupParams(){
    const holder=cleanHolder($('ffHolderName')?.value||'');
    if($('ffHolderName'))$('ffHolderName').value=holder;
    const ifsc=String($('ffIfsc')?.value||'').trim().toUpperCase();
    if($('ffIfsc'))$('ffIfsc').value=ifsc;
    const account=String($('ffAccountNumber')?.value||'').replace(/\D/g,'');
    if($('ffAccountNumber'))$('ffAccountNumber').value=account;
    return {
      p_legal_name:String($('ffLegalName')?.value||'').trim(),
      p_trade_name:String($('ffTradeName')?.value||'').trim(),
      p_entity_type:String($('ffEntityType')?.value||'individual'),
      p_primary_category:String($('ffPrimaryCategory')?.value||'').trim(),
      p_gst_registered:Boolean($('ffGstRegistered')?.checked),
      p_pan:String($('ffPan')?.value||'').trim().toUpperCase(),
      p_gstin:String($('ffGstin')?.value||'').trim().toUpperCase(),
      p_account_holder_name:holder,
      p_bank_name:String($('ffBankName')?.value||'').trim(),
      p_ifsc:ifsc,
      p_account_number:account,
      p_account_type:String($('ffAccountType')?.value||'current')
    };
  }

  async function persistSetup(){
    const client=window.supabaseClient;
    if(!client)throw new Error('Seller verification service is not ready');
    const params=setupParams();
    if(!params.p_legal_name)throw new Error('Enter the legal name first.');
    const {error}=await client.rpc('save_seller_compliance_profile',params);
    if(error)throw error;
    return params;
  }

  async function postIdentity(type,payload){
    const s=await session();
    const response=await fetch('/api/identity-verify',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.access_token},body:JSON.stringify({type,...payload})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Verification provider rejected the request');
    return data;
  }

  async function verifyPan(){
    const pan=String($('ffPan')?.value||'').trim().toUpperCase();
    if(!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan))throw new Error('Enter a valid 10-character PAN.');
    $('ffPan').value=pan;
    await persistSetup();
    await postIdentity('pan',{pan});
    notify('PAN verified successfully.');
    setTimeout(()=>location.reload(),700);
  }

  async function verifyGst(){
    if(!$('ffGstRegistered')?.checked)throw new Error('Mark the seller as GST registered first.');
    const gstin=String($('ffGstin')?.value||'').trim().toUpperCase();
    if(!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin))throw new Error('Enter a valid 15-character GSTIN.');
    $('ffGstin').value=gstin;
    await persistSetup();
    await postIdentity('gst',{gstin});
    notify('GSTIN verified successfully.');
    setTimeout(()=>location.reload(),700);
  }

  async function verifyBank(){
    const holder=cleanHolder($('ffHolderName')?.value||'');
    if($('ffHolderName'))$('ffHolderName').value=holder;
    if(!holderIsValid(holder)){ $('ffHolderName')?.focus(); throw new Error('Account holder name can contain letters and spaces only.'); }
    const bank=String($('ffBankName')?.value||'').trim();
    if(!bank){$('ffBankName')?.focus();throw new Error('Select the bank from the dropdown.');}
    const ifsc=String($('ffIfsc')?.value||'').trim().toUpperCase();
    if(!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)){ $('ffIfsc')?.focus(); throw new Error('Enter a valid 11-character IFSC code.'); }
    const account=String($('ffAccountNumber')?.value||'').replace(/\D/g,'');
    if(!/^[0-9]{9,18}$/.test(account)){ $('ffAccountNumber')?.focus(); throw new Error('Enter a valid bank account number.'); }
    if($('ffIfsc'))$('ffIfsc').value=ifsc;
    if($('ffAccountNumber'))$('ffAccountNumber').value=account;
    await persistSetup();
    const s=await session();
    const response=await fetch('/api/payout-profile',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.access_token},body:JSON.stringify({action:'verify',account_holder_name:holder,ifsc,account_number:account})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Bank verification provider rejected the request');
    if(!data.bank_verified)throw new Error('Bank verification did not complete.');
    if($('ffAccountNumber'))$('ffAccountNumber').value='';
    notify(data.provider==='cashfree_bav'?'Bank account verified with Cashfree.':'Bank account verified successfully.');
    setTimeout(()=>location.reload(),800);
  }

  function setBusy(button,busy,label){
    if(!button)return;
    if(busy){button.dataset.ffOldText=button.textContent||label;button.textContent='Please wait…';button.disabled=true}
    else{button.textContent=button.dataset.ffOldText||label;button.disabled=false}
  }

  async function handleVerifyClick(event,target,runner,label){
    event.preventDefault();event.stopImmediatePropagation();
    if(target.dataset.ffUxBusy==='1')return;
    target.dataset.ffUxBusy='1';setBusy(target,true,label);
    try{await runner()}catch(error){notify((label+' failed: '+(error?.message||'Please try again.')).replace(label+' failed: '+label+' failed: ',label+' failed: '))}
    finally{target.dataset.ffUxBusy='0';if(document.body.contains(target))setBusy(target,false,label)}
  }

  document.addEventListener('input',event=>{
    const target=event.target;
    if(!(target instanceof HTMLInputElement))return;
    if(target.id==='ffHolderName'){
      const cleaned=cleanHolder(target.value);
      if(target.value!==cleaned)target.value=cleaned;
    }else if(target.id==='ffPan'||target.id==='ffGstin'||target.id==='ffIfsc'){
      target.value=target.value.toUpperCase();
    }else if(target.id==='ffAccountNumber'){
      target.value=target.value.replace(/\D/g,'');
    }
  },true);

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target.closest('button'):null;
    if(!target)return;
    if(target.id==='ffVerifyPan'){handleVerifyClick(event,target,verifyPan,'PAN verification');return}
    if(target.id==='ffVerifyGst'){handleVerifyClick(event,target,verifyGst,'GST verification');return}
    if(target.id==='ffVerifyPayoutProvider'){handleVerifyClick(event,target,verifyBank,'Bank verification');return}
  },true);

  function enhance(){ensureHolderInput();ensureBankSelect();updateHints()}
  let attempts=0;
  const timer=setInterval(()=>{attempts++;enhance();if(attempts>120)clearInterval(timer)},100);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhance,{once:true});else enhance();
})();
