const assert=require('assert');
const p=require('./seller-return-protection.js');
let r=p.assessReturnRisk({customerReturnRate:55,recentClaims:5,serialOrSealMismatch:true,orderValue:6000});
assert.strictEqual(r.level,'high');assert.strictEqual(r.manualReview,true);assert(r.reasons.includes('serial_or_seal_mismatch'));
let d=p.protectionDecision({returnReason:'wrong item',customerEvidence:['photo'],qcRequired:true,qcOutcome:'customer_fault',customerReturnRate:10});
assert.strictEqual(d.decision,'seller_protection_review');
d=p.protectionDecision({returnReason:'damaged',customerEvidence:['photo'],qcRequired:true,qcOutcome:'seller_fault'});assert.strictEqual(d.decision,'customer_refund');
d=p.protectionDecision({returnReason:'damaged',customerEvidence:[],qcRequired:true});assert.strictEqual(d.decision,'needs_evidence');
console.log('seller return protection tests passed');
