import {onRequestPost as confirmation} from '../seller-panel/functions/api/outreach/whatsapp-order-confirmation-dispatch.js';
import {onRequestPost as shipping} from '../seller-panel/functions/api/outreach/whatsapp-shipping-dispatch.js';

// No public dispatch endpoint. No scheduler is configured by default.
// Calls the existing handlers locally, preserving DB claims and Meta gates.
export async function runTick(env, handlers = {confirmation, shipping}) {
  if (env.WHATSAPP_AUTOMATION_ENABLED !== 'true') return {state:'disabled'};
  const mode = env.WHATSAPP_AUTOMATION_MODE;
  if (!['preview','dispatch'].includes(mode)) throw Error('AUTOMATION_MODE_INVALID');
  const sending = mode === 'dispatch';
  if (sending && (env.WHATSAPP_AUTOMATION_LAUNCH_ACK !== 'approved_customer_scheduler_v1'
      || env.WHATSAPP_ORDER_GLOBAL_LAUNCH_APPROVED !== 'true')) {
    throw Error('AUTOMATION_NOT_APPROVED');
  }
  const lanes = [
    ['confirmation','WHATSAPP_ORDER_INTERNAL_TOKEN','WHATSAPP_ORDER_CONFIRMATION_SENDING_ENABLED'],
    ['shipping','WHATSAPP_SHIPPING_INTERNAL_TOKEN','WHATSAPP_SHIPPING_SENDING_ENABLED']
  ];
  const results = {};
  for (const [name, tokenKey, flag] of lanes) {
    if (sending && env[flag] !== 'true') { results[name] = 'disabled'; continue; }
    const token = sending ? env[tokenKey] : env.OUTREACH_API_TOKEN;
    if (typeof token !== 'string' || token.length < (sending ? 40 : 1)) {
      throw Error('AUTOMATION_CREDENTIAL_MISSING');
    }
    const request = new Request('https://internal.invalid/'+name, {
      method:'POST', headers:{'content-type':'application/json', authorization:'Bearer '+token},
      body:JSON.stringify(sending ? {dispatch:true} : {dryRun:true})
    });
    let response, body;
    try {
      response = await handlers[name]({request, env});
      body = await response.json();
    } catch { throw Error('AUTOMATION_HANDLER_FAILED'); }
    // Never log raw responses, database records, exception text or secrets.
    if (!response.ok || !body || typeof body !== 'object') throw Error('AUTOMATION_BLOCKED');
    if (!sending && (body.dryRun !== true || body.sent !== 0)) throw Error('AUTOMATION_PREVIEW_INVALID');
    if (sending && (body.armed !== true || body.dryRun !== false || body.autoRetry !== false
        || !Number.isSafeInteger(body.reviewRequired) || body.reviewRequired !== 0)) {
      throw Error('AUTOMATION_REVIEW_REQUIRED');
    }
    results[name] = sending ? 'checked' : 'previewed';
  }
  return {state:mode, ...results};
}

export default {
  fetch() { return new Response('Not found', {status:404}); },
  async scheduled(_controller, env) {
    // Throw only fixed error codes so platform failures remain visible.
    await runTick(env);
  }
};
