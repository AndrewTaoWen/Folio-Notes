import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as diskTurn } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App.js';
import { createNoteStore } from '../server/store.js';
import { documentText } from '../src/model.js';
const directories: string[] = [];
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.location.hash = '';
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function setup(dropSaveResponse = false, dropCommandResponse = false) {
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-workflow-'));
  directories.push(directory);
  const store = createNoteStore(directory);
  const bodies: string[] = [];
  let dropped = false;
  let commandDropped = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/ai/status')
        return Response.json({ configured: false, model: 'gpt-6-luna' });
      if (url === '/api/workspace/memory') return Response.json(await store.memory());
      if (url === '/api/notes') return Response.json(await store.list());
      const body = JSON.parse(options!.body as string);
      if (url === '/api/workspace/commands') {
        const result = await store.command(body.command, body.mutationId);
        if (dropCommandResponse && !commandDropped) {
          commandDropped = true;
          throw new Error('Lost command response');
        }
        return Response.json(result);
      }
      bodies.push(options!.body as string);
      const result = await store.save(
        body.note.id,
        body.note,
        body.revision,
        body.intents,
        body.mutationId,
      );
      if (dropSaveResponse && !dropped) {
        dropped = true;
        throw new Error('Connection lost after save');
      }
      return Response.json(result);
    }),
  );
  await act(async () => {
    render(<App />);
  });
  await settle(() => !!screen.queryByRole('textbox', { name: 'Page title' }));
  if (!screen.queryByRole('button', { name: 'Find the next steps' }))
    fireEvent.click(screen.getByRole('button', { name: 'Perspective' }));
  return { store, bodies };
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  // Real disk I/O is intentionally not advanced by fake timers.
  await act(async () => {
    await diskTurn(5);
  });
}
async function settle(predicate: () => boolean) {
  for (let tries = 0; tries < 100 && !predicate(); tries++) {
    await act(async () => {
      await diskTurn(5);
    });
  }
  expect(predicate()).toBe(true);
}
it('accepts insights, reviews selected next tasks, applies and undoes through the durable store', async () => {
  vi.useFakeTimers();
  const { store } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Find the next steps' }));
  await advance(600);
  expect(screen.queryByRole('button', { name: /Review 3 task additions/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected (3)' }));
  await advance(1000);
  await settle(() => !!screen.queryByRole('button', { name: 'Review 3 task additions' }));
  expect((await store.memory()).events.some((event) => event.type === 'insights.accepted')).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review 3 task additions' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Sam/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add selected tasks (2)' }));
  });
  await settle(
    () =>
      !!screen.queryByRole('button', { name: 'Undo task additions to A small launch checklist' }),
  );
  const target = (await store.list()).find((note) => note.id === 'launch')!;
  expect(documentText(target.doc)).toContain('Maya');
  expect(documentText(target.doc)).not.toContain('Sam');
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Undo task additions to A small launch checklist' }),
    );
  });
  await settle(
    () =>
      !screen.queryByRole('button', { name: 'Undo task additions to A small launch checklist' }),
  );
  expect(
    documentText((await store.list()).find((note) => note.id === 'launch')!.doc),
  ).not.toContain('Maya');
  expect((await store.memory()).events[0].type).toBe('move.undone');
});
it('retries an ambiguously successful save with the same mutation while preserving later typing', async () => {
  vi.useFakeTimers();
  const { store, bodies } = await setup(true);
  fireEvent.change(screen.getByRole('textbox', { name: 'Page title' }), {
    target: { value: 'First edit' },
  });
  await advance(1000);
  await settle(() => !!screen.queryByText(/Connection lost after save/));
  fireEvent.change(screen.getByRole('textbox', { name: 'Page title' }), {
    target: { value: 'Newer typing' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  });
  await settle(() => bodies.length === 2 && !!screen.queryByText('Unsaved changes'));
  expect(bodies[0]).toBe(bodies[1]);
  expect((screen.getByRole('textbox', { name: 'Page title' }) as HTMLTextAreaElement).value).toBe(
    'Newer typing',
  );
  await advance(1000);
  await settle(() => !!screen.queryByText('All changes saved'));
  expect((await store.list())[0]).toMatchObject({
    properties: { title: 'Newer typing' },
    revision: 3,
  });
  expect(
    (await store.memory()).events.filter((event) => event.type === 'note.updated'),
  ).toHaveLength(2);
});

it('reconciles a committed move after a lost response without showing stale checklist content', async () => {
  vi.useFakeTimers();
  const { store } = await setup(false, true);
  fireEvent.click(screen.getByRole('button', { name: 'Find the next steps' }));
  await advance(600);
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected (3)' }));
  await advance(1000);
  await settle(() => !!screen.queryByRole('button', { name: 'Review 3 task additions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review 3 task additions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add selected tasks (3)' }));
  await settle(() => !!screen.queryByText('Lost command response'));
  const nav = screen.getByRole('navigation');
  fireEvent.click(within(nav).getByRole('button', { name: 'A small launch checklist' }));
  expect(screen.getByRole('textbox', { name: 'Note editor' }).textContent).toContain('Maya');
  expect(
    (await store.memory()).events.filter((event) => event.type === 'move.applied'),
  ).toHaveLength(1);
});
