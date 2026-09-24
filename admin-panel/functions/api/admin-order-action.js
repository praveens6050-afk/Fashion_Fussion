import handler from '../../api/admin-order-action.js';
import { runNodeHandler } from '../_node-handler-bridge.js';

export function onRequest(context) {
  return runNodeHandler(handler, context);
}
