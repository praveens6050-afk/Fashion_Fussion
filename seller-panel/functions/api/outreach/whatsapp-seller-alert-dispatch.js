import {dispatchRoleAlert} from '../../_shared/whatsapp-role-alert-dispatch-core.js';
export function onRequestPost({request,env}) { return dispatchRoleAlert(request,env,'seller'); }
export function onRequestGet() { return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','allow':'POST'}}); }
