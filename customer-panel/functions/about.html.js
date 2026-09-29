export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = '/about';
  const assetRequest = new Request(url.toString(), context.request);
  return context.env.ASSETS.fetch(assetRequest);
}
