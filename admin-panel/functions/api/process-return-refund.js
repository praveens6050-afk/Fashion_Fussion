import handler from '../../api/process-return-refund.js';
import { runVercelHandler } from '../_vercel-adapter.js';

export function onRequest(context) {
  return runVercelHandler(handler, context);
}
