const LOGIN_CSP="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; style-src-attr 'none'; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' https://gmdevprqtvoshbbytsxf.supabase.co wss://gmdevprqtvoshbbytsxf.supabase.co; upgrade-insecure-requests";
const PROTECTED_PATHS=new Set(['/','/login','/login.html']);

export async function onRequest(context){
  const response=await context.next();
  const url=new URL(context.request.url);
  if(!PROTECTED_PATHS.has(url.pathname))return response;
  const headers=new Headers(response.headers);
  headers.set('Content-Security-Policy',LOGIN_CSP);
  headers.set('Cache-Control','no-store, max-age=0, no-transform');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('X-Frame-Options','DENY');
  headers.set('Referrer-Policy','no-referrer');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Opener-Policy','same-origin');
  headers.set('Cross-Origin-Resource-Policy','same-origin');
  headers.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  return new Response(response.body,{
    status:response.status,
    statusText:response.statusText,
    headers
  });
}
