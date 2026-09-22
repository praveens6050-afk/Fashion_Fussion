import handler from '../../api/admin-order-action.js';
import { runVercelHandler } from '../_vercel-adapter.js';

export function onRequest(context) {
  return runVercelHandler(handler, context);
}
