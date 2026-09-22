import { Buffer } from 'node:buffer';

function headersObject(headers) {
  const out = {};
  for (const [key, value] of headers.entries()) {
    out[key] = value;
    out[key.toLowerCase()] = value;
  }
  if (out.authorization) out.Authorization = out.authorization;
  if (out['content-type']) out['Content-Type'] = out['content-type'];
  return out;
}

async function createNodeRequest(request) {
  const url = new URL(request.url);
  const raw = Buffer.from(await request.arrayBuffer());
  let parsedBody;
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (raw.length && contentType.includes('application/json')) {
    try { parsedBody = JSON.parse(raw.toString('utf8')); } catch { parsedBody = undefined; }
  }

  const listeners = { data: [], end: [], error: [] };
  let scheduled = false;
  let destroyed = false;
  const req = {
    method: request.method,
    url: request.url,
    headers: headersObject(request.headers),
    query: Object.fromEntries(url.searchParams.entries()),
    body: parsedBody,
    on(event, callback) {
      if (listeners[event]) listeners[event].push(callback);
      if (event === 'end' && !scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          if (destroyed) return;
          try {
            for (const callback of listeners.data) callback(raw);
            if (!destroyed) for (const callback of listeners.end) callback();
          } catch (error) {
            for (const callback of listeners.error) callback(error);
          }
        });
      }
      return this;
    },
    destroy() { destroyed = true; }
  };
  return req;
}

function createNodeResponse() {
  const headers = new Headers();
  const chunks = [];
  let response = null;
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader(name, value) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      return this;
    },
    getHeader(name) { return headers.get(name); },
    removeHeader(name) { headers.delete(name); },
    status(code) { this.statusCode = Number(code); return this; },
    write(chunk) {
      if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    json(value) {
      this.setHeader('Content-Type', 'application/json; charset=utf-8');
      return this.end(JSON.stringify(value));
    },
    send(value) { return this.end(value); },
    end(chunk) {
      if (this.headersSent) return response;
      if (chunk != null) this.write(chunk);
      this.headersSent = true;
      const body = chunks.length ? Buffer.concat(chunks) : null;
      response = new Response(body, { status: this.statusCode, headers });
      return response;
    },
    _response() { return response; }
  };
  return res;
}

export async function runVercelHandler(handler, context) {
  const req = await createNodeRequest(context.request);
  const res = createNodeResponse();
  const result = await handler(req, res);
  if (result instanceof Response) return result;
  if (res._response()) return res._response();
  return res.end();
}
