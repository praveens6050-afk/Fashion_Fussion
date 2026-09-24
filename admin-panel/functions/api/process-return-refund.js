import handler from '../../api/process-return-refund.js';
import { runNodeHandler } from '../_node-handler-bridge.js';

export function onRequest(context) {
  return runNodeHandler(handler, context);
}
