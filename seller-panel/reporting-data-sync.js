'use strict';

(() => {
  const SESSION_KEY='ff_seller_session_v1';
  const RETURN_STORE='ff_seller_returns_v2';
  const QUOTE_STORE='ff_seller_b2b_quotes_v1';
  function session(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
  function sellerKey(){const s=session();return s?.sellerId||s?.email||'seller'}
  function seed(key,value){let root={};try{root=JSON.parse(localStorage.getItem(key)||'{}')||{}}catch{}const scoped=sellerKey();if(Object.prototype.hasOwnProperty.call(root,scoped))return false;root[scoped]=value;localStorage.setItem(key,JSON.stringify(root));return true}
  function loadModule(src){const script=document.createElement('script');script.src=src;script.async=false;document.body.appendChild(script)}
  const returns=[
    {id:'RET-1048',order:'FFO-240918-1042',customer:'Aarav Mehta',product:'Premium Cotton Oversized T-Shirt',sku:'FF-TSH-104',qty:1,amount:799,reason:'Size did not fit',requested:'2026-09-18T10:05:00+05:30',status:'requested',resolution:'',note:''},
    {id:'RET-1039',order:'FFO-240918-1038',customer:'Neha Verma',product:'Minimal Desk Organizer Set',sku:'FF-DSK-011',qty:1,amount:899,reason:'Received damaged',requested:'2026-09-16T12:10:00+05:30',status:'pickup_scheduled',resolution:'refund',note:'Demo pickup scheduled.'},
    {id:'RET-1024',order:'FFO-240915-0962',customer:'Kabir Singh',product:'Women Ribbed Everyday Top',sku:'FF-WRT-203',qty:1,amount:649,reason:'Changed mind',requested:'2026-09-10T09:20:00+05:30',status:'refunded',resolution:'refund',note:'Demo refund completed.'}
  ];
  const quotes=[
    {id:'RFQ-240918-31',buyer:'Jaipur Retail Hub',companyType:'Retailer',product:'Premium Cotton Oversized T-Shirt',sku:'FF-TSH-104',qty:120,targetPrice:620,requested:'2026-09-18T13:20:00+05:30',status:'new',offerPrice:null,moq:null,validUntil:'',note:'Need mixed sizes. Demo request only.'},
    {id:'RFQ-240917-22',buyer:'Metro Lifestyle Stores',companyType:'Multi-store buyer',product:'Minimal Desk Organizer Set',sku:'FF-DSK-011',qty:80,targetPrice:690,requested:'2026-09-17T16:05:00+05:30',status:'quoted',offerPrice:735,moq:50,validUntil:'2026-09-25',note:'Quoted locally; no customer notification sent.'},
    {id:'RFQ-240915-09',buyer:'OfficeMart Demo',companyType:'Business buyer',product:'Minimal Desk Organizer Set',sku:'FF-DSK-011',qty:40,targetPrice:720,requested:'2026-09-15T12:00:00+05:30',status:'accepted',offerPrice:750,moq:25,validUntil:'2026-09-22',note:'Demo quote accepted.'}
  ];
  const changed=seed(RETURN_STORE,returns)|seed(QUOTE_STORE,quotes);
  if(changed)window.dispatchEvent(new Event('storage'));
  loadModule('plans-fees-compliance-help.js');
  loadModule('plans-compliance-open-fix.js');
})();
