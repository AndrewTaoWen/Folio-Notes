import { createAIHandler } from '@ai-components/react/server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createOpenAIGenerator, type OpenAIOptions } from './openai.js';

export function isLocalRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    (!request.headers.has('origin') || request.headers.get('origin') === url.origin) &&
    request.headers.get('sec-fetch-site') !== 'cross-site'
  );
}

export function createLocalHandler(options: OpenAIOptions) {
  const model = options.model || 'gpt-6-luna';
  const generate = createOpenAIGenerator({ ...options, model });
  const handler = createAIHandler({ authorize: isLocalRequest, generate });
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (!isLocalRequest(request))
      return json({ error: 'Only same-origin localhost requests are allowed.' }, 403);
    if (new URL(request.url).pathname === '/api/ai/status') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      return json({ configured: !!options.apiKey.trim(), model });
    }
    if (request.method !== 'POST') return json({ error: 'Use POST /api/ai.' }, 405);
    if (!options.apiKey.trim())
      return json({ error: 'Add OPENAI_API_KEY to .env.local, then restart npm run dev.' }, 503);
    return handler(request);
  };
}

/** Local testing only. No credentials are exposed through Vite's client environment. */
export function localAIPlugin(options: OpenAIOptions): Plugin {
  const handler = createLocalHandler(options);
  let active = 0;
  async function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const pathname = req.url?.split('?')[0];
    if (pathname !== '/api/ai' && pathname !== '/api/ai/status') return next();
    const controller = new AbortController();
    const abort = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', abort);
    const send = (status: number, error: string) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error }));
    };
    if (active >= 4) {
      send(429, 'Too many active requests. Try again shortly.');
      return;
    }
    active++;
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const url = `http://${req.headers.host ?? 'localhost:5180'}${req.url}`;
      const initial = new Request(url, { headers });
      if (!isLocalRequest(initial)) {
        send(403, 'Only same-origin localhost requests are allowed.');
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 32_768) {
          send(413, 'Request too large.');
          return;
        }
        chunks.push(bytes);
      }
      const method = req.method ?? 'GET';
      const request = new Request(url, {
        method,
        headers,
        signal: controller.signal,
        ...(method === 'GET' || method === 'HEAD'
          ? {}
          : { body: Buffer.concat(chunks).toString('utf8') }),
      });
      const response = await handler(request);
      if (controller.signal.aborted) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      if (!res.headersSent && !controller.signal.aborted) send(500, 'Local AI request failed.');
    } finally {
      active--;
      res.off('close', abort);
    }
  }
  return {
    name: 'local-ai-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
