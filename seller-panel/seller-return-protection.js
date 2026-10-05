(function(global){
'use strict';
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));
function assessReturnRisk(input){
 const x=input||{};let score=0;const reasons=[];
 const returnRate=clamp(x.customerReturnRate,0,100),claims=Math.max(0,Number(x.recentClaims)||0),value=Math.max(0,Number(x.orderValue)||0);
 if(returnRate>=50){score+=35;reasons.push('high_customer_return_rate')}else if(returnRate>=30){score+=20;reasons.push('elevated_customer_return_rate')}
 if(claims>=5){score+=25;reasons.push('repeated_recent_claims')}else if(claims>=3){score+=15;reasons.push('multiple_recent_claims')}
 if(x.serialOrSealMismatch){score+=35;reasons.push('serial_or_seal_mismatch')}
 if(x.itemConditionMismatch){score+=30;reasons.push('item_condition_mismatch')}
 if(x.packageWeightMismatch){score+=20;reasons.push('package_weight_mismatch')}
 if(value>=5000){score+=10;reasons.push('high_value_order')}
 score=clamp(score,0,100);
 return Object.freeze({score,level:score>=70?'high':score>=40?'medium':'low',manualReview:score>=40,reasons});
}
function validateEvidence(input){const x=input||{},missing=[];if(!x.returnReason)missing.push('return_reason');if(!Array.isArray(x.customerEvidence)||!x.customerEvidence.length)missing.push('customer_evidence');if(x.qcRequired&&!x.qcOutcome)missing.push('qc_outcome');return {complete:missing.length===0,missing};}
function protectionDecision(input){const risk=assessReturnRisk(input),evidence=validateEvidence(input);if(!evidence.complete)return {decision:'needs_evidence',risk,evidence};if(risk.level==='high')return {decision:'manual_review',risk,evidence};if(input?.qcOutcome==='seller_fault')return {decision:'customer_refund',risk,evidence};if(input?.qcOutcome==='customer_fault'||input?.serialOrSealMismatch)return {decision:'seller_protection_review',risk,evidence};return {decision:'standard_return_flow',risk,evidence};}
const api=Object.freeze({assessReturnRisk,validateEvidence,protectionDecision});global.FashionFussionReturnProtection=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
