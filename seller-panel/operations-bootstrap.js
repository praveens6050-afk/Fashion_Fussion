'use strict';

(() => {
  const ORDER_KEY='ff_seller_fulfillment_orders_v1';
  const starterOrders=[
    {id:'FFO-240918-1042',date:'2026-09-18T18:10:00+05:30',customer:'Aarav Mehta',total:1598,status:'new',lines:[{sku:'FF-TSH-104',name:'Premium Cotton Oversized T-Shirt',qty:2}]},
    {id:'FFO-240918-1038',date:'2026-09-18T15:42:00+05:30',customer:'Neha Verma',total:899,status:'accepted',lines:[{sku:'FF-DSK-011',name:'Minimal Desk Organizer Set',qty:1}]},
    {id:'FFO-240917-1021',date:'2026-09-17T13:20:00+05:30',customer:'Rohan Gupta',total:2397,status:'packed',lines:[{sku:'FF-TSH-104',name:'Premium Cotton Oversized T-Shirt',qty:3}]},
    {id:'FFO-240916-0994',date:'2026-09-16T11:05:00+05:30',customer:'Simran Kaur',total:799,status:'ready_to_ship',lines:[{sku:'FF-TSH-104',name:'Premium Cotton Oversized T-Shirt',qty:1}]},
    {id:'FFO-240915-0962',date:'2026-09-15T16:31:00+05:30',customer:'Kabir Singh',total:1298,status:'shipped',lines:[{sku:'FF-WRT-203',name:'Women Ribbed Everyday Top',qty:2}]}
  ];
  try{
    const existing=JSON.parse(localStorage.getItem(ORDER_KEY)||'null');
    if(!Array.isArray(existing)||!existing.length)localStorage.setItem(ORDER_KEY,JSON.stringify(starterOrders));
  }catch{localStorage.setItem(ORDER_KEY,JSON.stringify(starterOrders))}
  const style=document.createElement('style');
  style.textContent='#notificationDot{display:none!important}';
  document.head.appendChild(style);
})();