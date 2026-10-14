/* Fashion Fussion seller GST readiness helpers. No regulatory eligibility is granted by this module. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FFSellerGSTReadiness=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const GSTIN=/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  const STATES=Object.freeze({'01':'Jammu and Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh','05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh','10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur','15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal','20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh','24':'Gujarat','26':'Dadra and Nagar Haveli and Daman and Diu','27':'Maharashtra','29':'Karnataka','30':'Goa','31':'Lakshadweep','32':'Kerala','33':'Tamil Nadu','34':'Puducherry','35':'Andaman and Nicobar Islands','36':'Telangana','37':'Andhra Pradesh','38':'Ladakh'});
  function parseGSTIN(value){
    const gstin=String(value||'').trim().toUpperCase();
    if(!GSTIN.test(gstin)||!STATES[gstin.slice(0,2)])return {valid:false,stateCode:null,stateName:null};
    return {valid:true,stateCode:gstin.slice(0,2),stateName:STATES[gstin.slice(0,2)]};
  }
  function checkAdditionalRegistration(input){
    const home=parseGSTIN(input&&input.homeGSTIN);
    const additional=parseGSTIN(input&&input.additionalGSTIN);
    if(!home.valid)return {ok:false,reason:'A valid home-state GSTIN is required.'};
    if(!additional.valid)return {ok:false,reason:'A valid additional GSTIN is required.'};
    if(home.stateCode===additional.stateCode)return {ok:false,reason:'Additional GSTIN must belong to a different state.'};
    if(homeGSTPan(input.homeGSTIN)!==homeGSTPan(input.additionalGSTIN))return {ok:false,reason:'Both GSTINs must share the same PAN.'};
    return {ok:true,homeState:home.stateName,additionalState:additional.stateName,requiresManualReview:true};
  }
  function homeGSTPan(gstin){return String(gstin||'').trim().toUpperCase().slice(2,12)}
  function warehouseReadiness(input){
    if(!input||!input.warehouseId)return {ready:false,reason:'Warehouse location not selected.'};
    if(input.consent!==true)return {ready:false,reason:'Explicit warehouse consent is required.'};
    if(input.officialSchemeConfirmed!==true)return {ready:false,reason:'Wait for officially notified effective rules.'};
    if(input.complianceApproved!==true)return {ready:false,reason:'Compliance approval is required.'};
    return {ready:true,reason:'Prerequisites recorded; final GST eligibility is not established.'};
  }
  return Object.freeze({parseGSTIN,checkAdditionalRegistration,warehouseReadiness});
});
