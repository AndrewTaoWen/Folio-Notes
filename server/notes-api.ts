import type { Plugin } from 'vite';
import { createNoteStore, StoreError } from './store.js';
import { isLocalRequest } from './local-api.js';

export function notesAPI(directory: string): Plugin {
  const store = createNoteStore(directory);
  return {
    name: 'notes-store',
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
  async function handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
    next: () => void,
  ) {
    const pathname = req.url?.split('?')[0] ?? '';
    if (
      pathname !== '/api/notes' &&
      !pathname.startsWith('/api/notes/') &&
      pathname !== '/api/workspace/memory' &&
      pathname !== '/api/workspace/commands'
    )
      return next();
    function send(status: number, body: unknown) {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    }
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      if (!isLocalRequest(new Request(`http://${req.headers.host}${req.url}`, { headers }))) {
        send(403, { error: 'Only same-origin localhost requests are allowed.' });
        return;
      }
      if (pathname === '/api/workspace/memory' && req.method === 'GET') {
        send(200, await store.memory());
        return;
      }
      if (pathname === '/api/notes' && req.method === 'GET') {
        send(200, await store.list());
        return;
      }
      if (pathname === '/api/notes' && req.method === 'POST') {
        send(201, await store.create());
        return;
      }
      if (
        !(req.method === 'PUT' && pathname.startsWith('/api/notes/')) &&
        !(req.method === 'POST' && pathname === '/api/workspace/commands')
      ) {
        send(405, { error: 'Method not allowed.' });
        return;
      }
      if (!req.headers['content-type']?.includes('application/json')) {
        send(415, { error: 'Expected JSON.' });
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 512_000) {
          send(413, { error: 'Note exceeds the 512 KB limit.' });
          return;
        }
        chunks.push(bytes);
      }
      let input: {
        note?: unknown;
        revision?: unknown;
        intents?: unknown;
        mutationId?: unknown;
        command?: unknown;
      };
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        send(400, { error: 'Invalid JSON.' });
        return;
      }
      if (pathname === '/api/workspace/commands') {
        send(200, await store.command(input?.command, input?.mutationId));
      } else {
        send(
          200,
          await store.save(
            pathname.slice('/api/notes/'.length),
            input?.note,
            input?.revision,
            input?.intents,
            input?.mutationId,
          ),
        );
      }
    } catch (error) {
      send(error instanceof StoreError ? error.status : 500, {
        error:
          error instanceof StoreError
            ? error.message
            : 'Unable to save notes. Your existing data has not been replaced.',
      });
    }
  }
}
