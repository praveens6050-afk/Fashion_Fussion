import cancelOrder from '../../api/cancel-order.js';
import createOrder from '../../api/create-order.js';
import createQuoteOrder from '../../api/create-quote-order.js';
import quoteOrder from '../../api/quote-order.js';
import razorpayWebhook from '../../api/razorpay-webhook.js';
import reconcilePayment from '../../api/reconcile-payment.js';
import refundStatus from '../../api/refund-status.js';
import release from '../../api/release.js';
import shippingStatus from '../../api/shipping-status.js';
import verifyPayment from '../../api/verify-payment.js';
import { runNodeHandler } from '../_node-handler-bridge.js';

const handlers = {
  'cancel-order': cancelOrder,
  'create-order': createOrder,
  'create-quote-order': createQuoteOrder,
  'quote-order': quoteOrder,
  'razorpay-webhook': razorpayWebhook,
  'reconcile-payment': reconcilePayment,
  'refund-status': refundStatus,
  'release': release,
  'shipping-status': shippingStatus,
  'verify-payment': verifyPayment
};

export function onRequest(context) {
  const parts = Array.isArray(context.params.path) ? context.params.path : [context.params.path].filter(Boolean);
  const route = parts.join('/');

  if (route === 'return-refund-status') {
    const url = new URL(context.request.url);
    url.pathname = '/api/refund-status';
    url.searchParams.set('mode', 'return-refund');
    const request = new Request(url.toString(), context.request);
    return runNodeHandler(refundStatus, { ...context, request });
  }

  const handler = handlers[route];
  if (!handler) {
    return Response.json({ error: 'API route not found' }, { status: 404 });
  }
  return runNodeHandler(handler, context);
}
