import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App.js';
import { seedNotes } from '../src/seed.js';
import type { Note } from '../src/model.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.location.hash = '';
});
function backend() {
  let notes = structuredClone(seedNotes());
  const requests: { url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({
        url: String(input),
        body: options?.body ? JSON.parse(options.body as string) : undefined,
      });
      if (input === '/api/workspace/memory')
        return Response.json({ events: [], moves: [], undoable: [] });
      if (input.endsWith('/status'))
        return Response.json({ configured: false, model: 'gpt-6-luna' });
      if (!options?.method || options.method === 'GET') return Response.json(notes);
      if (options.method === 'POST') {
        const note = {
          ...notes[0],
          id: 'new-note',
          properties: { title: 'Untitled', summary: '', decisions: '', actions: '' },
          doc: { type: 'doc', content: [{ type: 'paragraph' }] },
          tags: [],
          linkedIds: [],
          favorite: false,
        } as Note;
        notes = [...notes, note];
        return Response.json(note);
      }
      const { note, revision } = JSON.parse(options!.body as string);
      const updated = { ...note, revision: revision + 1, updatedAt: new Date().toISOString() };
      notes = notes.map((entry) => (entry.id === updated.id ? updated : entry));
      return Response.json(updated);
    }),
  );
  return { requests, notes: () => notes };
}
async function open() {
  await act(async () => {
    render(<App />);
  });
  if (!screen.queryByRole('button', { name: 'Find the next steps' }))
    fireEvent.click(screen.getByRole('button', { name: 'Perspective' }));
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it('loads the real editor, searches notes, and creates a new page', async () => {
  backend();
  await open();
  expect(screen.getByRole('textbox', { name: 'Note editor' }).textContent).toContain(
    'Maya will sketch',
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Search notes' }), {
    target: { value: 'research' },
  });
  expect(screen.getByRole('button', { name: 'Things worth paying attention to' })).toBeTruthy();
  expect(
    within(screen.getByRole('navigation')).queryByRole('button', {
      name: 'A small launch checklist',
    }),
  ).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
  });
  expect((screen.getByRole('textbox', { name: 'Page title' }) as HTMLTextAreaElement).value).toBe(
    'Untitled',
  );
});
it('reviews partial page properties, applies them, and undoes without rewriting the document', async () => {
  vi.useFakeTimers();
  backend();
  await open();
  const original = screen.getByRole('textbox', { name: 'Note editor' }).textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Find the next steps' }));
  await advance(600);
  expect(screen.queryByLabelText('Edit summary')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: /^Decisions/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected (2)' }));
  expect(screen.getByRole('textbox', { name: 'Edit summary' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Edit decisions' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Note editor' }).textContent).toBe(original);
  fireEvent.click(screen.getByRole('button', { name: 'Undo AI changes' }));
  expect(screen.queryByRole('textbox', { name: 'Edit summary' })).toBeNull();
});
it('autosaves edits and leaves accepted fields editable', async () => {
  vi.useFakeTimers();
  const api = backend();
  await open();
  fireEvent.change(screen.getByRole('textbox', { name: 'Page title' }), {
    target: { value: 'A better title' },
  });
  await advance(1000);
  expect(api.notes()[0].properties.title).toBe('A better title');
  expect(api.requests.some((request) => request.url === '/api/notes/weekly-sync')).toBe(true);
});
it('removes linked context and invalidates a reviewed proposal', async () => {
  vi.useFakeTimers();
  backend();
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Find the next steps' }));
  await advance(600);
  expect(screen.getByRole('button', { name: 'Apply selected (3)' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove context How we want this to feel' }));
  expect(screen.queryByRole('button', { name: /Apply selected/ })).toBeNull();
});
it('keeps newer local edits when an earlier save finishes', async () => {
  vi.useFakeTimers();
  backend();
  const originalFetch = globalThis.fetch;
  let complete!: (response: Response) => void;
  let firstBody: { note: Note; revision: number };
  let intercepted = false;
  const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    if (options?.method === 'PUT' && !intercepted) {
      intercepted = true;
      firstBody = JSON.parse(options.body as string);
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    }
    return originalFetch(input, options);
  });
  vi.stubGlobal('fetch', fetcher);
  await open();
  fireEvent.change(screen.getByRole('textbox', { name: 'Page title' }), {
    target: { value: 'First edit' },
  });
  await advance(1000);
  fireEvent.change(screen.getByRole('textbox', { name: 'Page title' }), {
    target: { value: 'Newer edit' },
  });
  await act(async () => {
    complete(
      Response.json({ ...firstBody!.note, revision: 2, updatedAt: new Date().toISOString() }),
    );
  });
  expect((screen.getByRole('textbox', { name: 'Page title' }) as HTMLTextAreaElement).value).toBe(
    'Newer edit',
  );
  await advance(1000);
  const puts = fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT');
  expect(JSON.parse(puts[1][1]!.body as string)).toMatchObject({
    revision: 2,
    note: { properties: { title: 'Newer edit' } },
  });
});
it('keeps a conflicting draft visible and pauses automatic retries', async () => {
  vi.useFakeTimers();
  backend();
  const originalFetch = globalThis.fetch;
  const fetcher = vi.fn(async (input: string, options?: RequestInit) =>
    options?.method === 'PUT'
      ? Response.json(
          { error: 'This note changed in another tab. Export your draft before reloading.' },
          { status: 409 },
        )
      : originalFetch(input, options),
  );
  vi.stubGlobal('fetch', fetcher);
  await open();
  fireEvent.change(screen.getByRole('textbox', { name: 'Page title' }), {
    target: { value: 'My open draft' },
  });
  await advance(1000);
  expect(screen.getByRole('alert').textContent).toContain('another tab');
  expect((screen.getByRole('textbox', { name: 'Page title' }) as HTMLTextAreaElement).value).toBe(
    'My open draft',
  );
  await advance(3000);
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
});
