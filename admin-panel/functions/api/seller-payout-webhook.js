import handler from '../../api/seller-payout-webhook.js';
import { runNodeHandler } from '../_node-handler-bridge.js';

export function onRequest(context) {
  return runNodeHandler(handler, context);
}
