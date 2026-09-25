'use strict';
(() => {
  if (window.__ffSellerProfileActionHotfix) return;
  window.__ffSellerProfileActionHotfix = true;

  const $ = id => document.getElementById(id);
  const notify = message => window.SellerCatalogBridge?.notify?.(message) || console.info(message);
  let identity = { pan:false, gst:false, address:false };
  let payout = { verification_supported:false, payout_configured:false, provider:null };

  async function refreshReadiness(){
    const [identityResult,payoutResult] = await Promise.allSettled([
      fetch('/api/identity-verify',{headers:{'Cache-Control':'no-store'}}).then(r=>r.json().then(d=>({ok:r.ok,data:d}))),
      fetch('/api/payout-profile',{headers:{'Cache-Control':'no-store'}}).then(r=>r.json().then(d=>({ok:r.ok,data:d})))
    ]);
    if(identityResult.status==='fulfilled'&&identityResult.value.ok&&identityResult.value.data?.providers){
      identity={...identity,...identityResult.value.data.providers};
    }
    if(payoutResult.status==='fulfilled'&&payoutResult.value.ok){
      payout={...payout,...payoutResult.value.data};
    }
    syncUi();
  }

  function syncUi(){
    const pan=$('ffVerifyPan');
    if(pan&&!identity.pan){pan.disabled=false;pan.title='PAN verification provider is not configured yet';}
    const gst=$('ffVerifyGst');
    if(gst&&!identity.gst){gst.disabled=false;gst.title='GST verification provider is not configured yet';}

    const pickupForm=$('ffPickupForm');
    const pickupSubmit=pickupForm?.querySelector('button[type="submit"]');
    if(pickupSubmit){
      pickupSubmit.textContent=identity.address?'Save & verify pickup location':'Save pickup location';
      pickupSubmit.title=identity.address?'Save and verify with Google Maps':'Google Maps is not configured; this will save for admin review';
    }
    document.querySelectorAll('[data-ff-verify-address]').forEach(button=>{
      if(!identity.address){button.disabled=false;button.title='Google Maps verification is not configured yet';}
    });

    const bankVerify=$('ffVerifyPayoutProvider');
    if(bankVerify&&!payout.verification_supported){
      bankVerify.disabled=false;
      bankVerify.title='Bank verification provider is not configured yet';
    }
    const payoutLink=$('ffLinkPayoutProvider');
    if(payoutLink&&!payout.payout_configured){
      payoutLink.disabled=false;
      payoutLink.title='Payout account linking is not configured yet';
    }
  }

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;

    if(target.closest('#ffVerifyPan')&&!identity.pan){
      event.preventDefault();event.stopImmediatePropagation();
      notify('PAN verification provider is not configured yet. Save the PAN and submit it for admin review.');
      return;
    }
    if(target.closest('#ffVerifyGst')&&!identity.gst){
      event.preventDefault();event.stopImmediatePropagation();
      notify('GST verification provider is not configured yet. Save the GSTIN and submit it for admin review.');
      return;
    }
    if(target.closest('[data-ff-verify-address]')&&!identity.address){
      event.preventDefault();event.stopImmediatePropagation();
      notify('Google Maps verification is not configured yet. The pickup location can still be saved for admin review.');
      return;
    }
    if(target.closest('#ffVerifyPayoutProvider')&&!payout.verification_supported){
      event.preventDefault();event.stopImmediatePropagation();
      notify('Bank verification provider is not configured in the live Seller runtime yet.');
      return;
    }
    if(target.closest('#ffLinkPayoutProvider')&&!payout.payout_configured){
      event.preventDefault();event.stopImmediatePropagation();
      notify('Payout account linking is not configured yet. Bank verification remains a separate step.');
    }
  },true);

  document.addEventListener('invalid',event=>{
    const field=event.target;
    if(!(field instanceof HTMLInputElement||field instanceof HTMLSelectElement||field instanceof HTMLTextAreaElement))return;
    const form=field.closest('form');
    if(form?.id==='ffPickupForm') notify('Complete the required pickup fields before saving the pickup location.');
    if(form?.id==='ffComplianceForm') notify('Complete the required verification fields before saving the setup.');
  },true);

  const observer=new MutationObserver(()=>syncUi());
  const start=()=>{
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
    refreshReadiness().catch(()=>syncUi());
    setTimeout(()=>refreshReadiness().catch(()=>syncUi()),1500);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
