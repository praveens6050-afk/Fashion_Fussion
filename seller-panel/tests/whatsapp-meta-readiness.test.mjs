import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestGet,onRequestPost} from '../functions/api/outreach/whatsapp-meta-readiness.js';

globalThis.crypto ||= webcrypto;
const operator='operator-test-only-never-a-real-token';
const env={
  OUTREACH_API_TOKEN:operator,
  WHATSAPP_GRAPH_VERSION:'v26.0',
  WHATSAPP_BUSINESS_ACCOUNT_ID:'123456789012345',
  WHATSAPP_PHONE_NUMBER_ID:'987654321098765',
  WHATSAPP_ACCESS_TOKEN:'synthetic-test-meta-access-token',
  WHATSAPP_ALLOWED_TEMPLATES:'order_status_update,seller_invitation'
};
const EXPECTED_BODY='Hi {{1}}, your Fashion Fussion order {{2}} status has been updated to {{3}}. Please check your account for the latest order details.';
const template={
 name:'order_status_update',status:'APPROVED',language:'en',
 category:'UTILITY',components:[{type:'BODY',text:EXPECTED_BODY},{type:'FOOTER',text:'Fashion Fussion'}]
};
const url='https://seller.fashionfussion.in/api/outreach/whatsapp-meta-readiness';
const request=(token=operator)=>new Request(url,{headers:{Authorization:'Bearer '+token}});
function mockedMeta(t,{templates=[template],numbers=[{id:env.WHATSAPP_PHONE_NUMBER_ID}],status=200,paginated=false}={}) {
  const previous=globalThis.fetch;const calls=[];
  globalThis.fetch=async (resource,options)=>{
    const u=new URL(resource);calls.push({u,options});
    assert.equal(u.origin,'https://graph.facebook.com');
    assert.equal(options.method,'GET','Meta preflight may NOT submit messages');
    assert.equal(options.redirect,'error','No redirect to untrusted host');
    assert.equal(options.headers.Authorization,'Bearer synthetic-test-meta-access-token');
    assert.ok(!u.pathname.endsWith('/messages'));
    if(u.pathname.endsWith('/message_templates')){
      assert.equal(u.searchParams.get('name'),'order_status_update');
      assert.equal(u.searchParams.get('limit'),'100');
      return new Response(JSON.stringify({data:templates,
        ...(paginated?{paging:{next:'https://graph.facebook.com/other-page'}}:{})}),
        {status});
    }
    if(u.pathname.endsWith('/phone_numbers'))
      return new Response(JSON.stringify({data:numbers}),{status});
    throw Error('Unexpected Meta endpoint '+u.pathname);
  };
  t.after(()=>{globalThis.fetch=previous});
  return calls;
}
test('unauthorized request never contacts Meta',async t=>{
  const prior=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('No fetch allowed');};
  t.after(()=>{globalThis.fetch=prior});
  const r=await onRequestGet({request:request('wrong'),env});
  assert.equal(r.status,401);
  assert.equal(calls,0);
});
test('missing or invalid WABA ID returns configuration block without contacting Meta',async t=>{
  const prior=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('No fetch allowed')};
  t.after(()=>{globalThis.fetch=prior});
  const r=await onRequestGet({request:request(),env:{...env,WHATSAPP_BUSINESS_ACCOUNT_ID:''}});
  assert.equal(r.status,200);
  const d=await r.json();
  assert.equal(d.ready,false);
  assert.equal(d.issue,'CONFIGURATION_INCOMPLETE');
  assert.ok(d.missing.includes('WHATSAPP_BUSINESS_ACCOUNT_ID'));
  assert.equal(d.messagesSent,0);
  assert.equal(calls,0);
});
test('approved utility template with 3 correct variables and matching phone passes GET-only checks',async t=>{
  const calls=mockedMeta(t);
  const r=await onRequestGet({request:request(),env});
  const d=await r.json();
  assert.equal(r.status,200);
  assert.equal(d.dryRun,true);
  assert.equal(d.messagesSent,0);
  assert.equal(d.ready,true);
  assert.equal(d.phoneNumberInBusiness,true);
  assert.equal(d.checks.exactBodyMatches,true);
  assert.deepEqual(d.issues,[]);
  assert.equal(calls.length,2);
  assert.ok(!JSON.stringify(d).includes(env.WHATSAPP_PHONE_NUMBER_ID));
  assert.ok(!JSON.stringify(d).includes(env.WHATSAPP_BUSINESS_ACCOUNT_ID));
  assert.ok(!JSON.stringify(d).includes(env.WHATSAPP_ACCESS_TOKEN));
});
test('approved screenshot-style static Fashion Fussion HEADER, body, and footer pass',async t=>{
  mockedMeta(t,{templates:[{...template,components:[
    {type:'HEADER',format:'TEXT',text:'Fashion Fussion'},
    {type:'BODY',text:EXPECTED_BODY},
    {type:'FOOTER',text:'Fashion Fussion'}
  ]}]});
  const d=await (await onRequestGet({request:request(),env})).json();
  assert.equal(d.ready,true);
  assert.equal(d.messagesSent,0);
  assert.equal(d.checks.noUnexpectedDynamicComponents,true);
  assert.deepEqual(d.issues,[]);
});
test('dynamic variable header must fail even when body matches',async t=>{
  mockedMeta(t,{templates:[{...template,components:[
    {type:'HEADER',format:'TEXT',text:'Fashion Fussion {{1}}'},
    {type:'BODY',text:EXPECTED_BODY}
  ]}]});
  const d=await (await onRequestGet({request:request(),env})).json();
  assert.equal(d.ready,false);
  assert.ok(d.issues.includes('TEMPLATE_PARAMETER_MAPPING_MISMATCH'));
});
test('media header must fail even with Fashion Fussion static text',async t=>{
  mockedMeta(t,{templates:[{...template,components:[
    {type:'HEADER',format:'IMAGE',text:'Fashion Fussion'},
    {type:'BODY',text:EXPECTED_BODY}
  ]}]});
  const d=await (await onRequestGet({request:request(),env})).json();
  assert.equal(d.ready,false);
  assert.ok(d.issues.includes('TEMPLATE_PARAMETER_MAPPING_MISMATCH'));
});
test('unexpected buttons must fail even with matching static header',async t=>{
  mockedMeta(t,{templates:[{...template,components:[
    {type:'HEADER',format:'TEXT',text:'Fashion Fussion'},
    {type:'BODY',text:EXPECTED_BODY},
    {type:'BUTTONS',buttons:[{type:'URL',text:'Shop',url:'https://fashionfussion.in'}]}
  ]}]});
  const d=await (await onRequestGet({request:request(),env})).json();
  assert.equal(d.ready,false);
  assert.ok(d.issues.includes('TEMPLATE_PARAMETER_MAPPING_MISMATCH'));
});
test('unapproved header text must fail despite static format',async t=>{
  mockedMeta(t,{templates:[{...template,components:[
    {type:'HEADER',format:'TEXT',text:'Unexpected Brand'},
    {type:'BODY',text:EXPECTED_BODY}
  ]}]});
  const d=await (await onRequestGet({request:request(),env})).json();
  assert.equal(d.ready,false);
  assert.ok(d.issues.includes('TEMPLATE_PARAMETER_MAPPING_MISMATCH'));
});
test('approved template with unexpected payload text is NOT ready',async t=>{
  mockedMeta(t,{templates:[{...template,components:[{type:'BODY',text:'Hi {{1}}, your order {{2}} is shipped.'}]}]});
  const d=await (await onRequestGet({request:request(),env})).json();
  assert.equal(d.ready,false);
  assert.ok(d.issues.includes('TEMPLATE_PARAMETER_MAPPING_MISMATCH'));
});
test('pending/paused template is blocked even if the mapped body is correct',async t=>{
  mockedMeta(t,{templates:[{...template,status:'PAUSED'}]});
  const d=await (await onRequestGet({request:request(),env})).json();
  assert.equal(d.ready,false);
  assert.ok(d.issues.includes('TEMPLATE_NOT_APPROVED'));
});
test('marketing-category template cannot silently be used as utility',async t=>{
  mockedMeta(t,{templates:[{...template,category:'MARKETING'}]});
  const d=await (await onRequestGet({request:request(),env})).json();
  assert.equal(d.ready,false);
  assert.ok(d.issues.includes('TEMPLATE_NOT_UTILITY'));
});
test('phone membership mismatch prevents readiness',async t=>{
  mockedMeta(t,{numbers:[{id:'999999999999999'}]});
  const d=await (await onRequestGet({request:request(),env})).json();
  assert.equal(d.ready,false);
  assert.ok(d.issues.includes('PHONE_NUMBER_NOT_VERIFIED_IN_BUSINESS'));
});
test('paginated results never produce a false ready result and links are NOT followed',async t=>{
  const calls=mockedMeta(t,{paginated:true});
  const d=await (await onRequestGet({request:request(),env})).json();
  assert.equal(d.ready,false);
  assert.equal(d.paginationComplete,false);
  assert.equal(calls.length,2);
});
test('Meta API errors fail closed without forwarding provider secrets or raw errors',async t=>{
  mockedMeta(t,{status:403});
  const r=await onRequestGet({request:request(),env});
  assert.equal(r.status,503);
  const d=await r.json();
  assert.equal(d.ready,false);
  assert.equal(d.issue,'META_READ_UNAVAILABLE');
  assert.equal(d.messagesSent,0);
});
test('POST cannot trigger a send, even with a valid operator token',async()=>{
  const r=onRequestPost();
  assert.equal(r.status,405);
  assert.equal((await r.json()).error,'Read-only GET required');
});
