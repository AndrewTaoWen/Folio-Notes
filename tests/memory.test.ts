// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createNoteStore } from '../server/store.js';
import { noteDraft, documentText } from '../src/model.js';
import { seedNotes } from '../src/seed.js';
import type { NextMove } from '../src/workspace-memory.js';
const directories: string[] = [];
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-memory-'));
  directories.push(directory);
  return { directory, store: createNoteStore(directory) };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function accept(
  store: ReturnType<typeof createNoteStore>,
  actions = '- Maya will sketch the first-run experience by Friday.\n- Alex will test the prototype next week.',
) {
  const note = (await store.list())[0];
  return store.save(
    note.id,
    { ...noteDraft(note), properties: { ...note.properties, actions } },
    note.revision,
    [{ type: 'insights.accepted', actions }],
    'accepted-actions',
  );
}
function apply(candidate: NextMove, selected = candidate.additions) {
  return { type: 'apply' as const, candidate, selected };
}
it('migrates v1 notes atomically without inventing acceptance or changing notes', async () => {
  const { store, directory } = await setup();
  const notes = seedNotes();
  notes[0].properties.actions = 'An old action';
  notes[0].revision = 23;
  await writeFile(path.join(directory, 'notes.json'), JSON.stringify({ version: 1, notes }));
  expect(await store.list()).toEqual(notes);
  expect(await store.memory()).toMatchObject({ events: [], moves: [], undoable: [] });
  expect(JSON.parse(await readFile(path.join(directory, 'notes.json'), 'utf8')).version).toBe(2);
});
it('records ordinary edits without treating them as AI acceptance', async () => {
  const { store } = await setup();
  const note = (await store.list())[0];
  await store.save(
    note.id,
    { ...noteDraft(note), properties: { ...note.properties, actions: 'Call Maya' } },
    1,
  );
  expect((await store.memory()).moves).toHaveLength(0);
  expect((await store.memory()).events).toMatchObject([
    { type: 'note.updated', changedFields: ['properties'], revision: 2 },
  ]);
});
it('only offers explicitly linked checklists after accepted actions, across restarts', async () => {
  const { store, directory } = await setup();
  const saved = await accept(store);
  const memory = await createNoteStore(directory).memory();
  expect(memory.moves).toHaveLength(1);
  expect(memory.moves[0]).toMatchObject({
    sourceId: saved.id,
    sourceRevision: saved.revision,
    targetId: 'launch',
    targetRevision: 1,
  });
  expect(memory.moves[0].sourceEventId).toBe(
    memory.events.find((event) => event.type === 'insights.accepted')!.id,
  );
  await store.save(saved.id, { ...noteDraft(saved), linkedIds: [] }, saved.revision);
  expect((await store.memory()).moves).toHaveLength(0);
});
it('does not fabricate a move from summary-only acceptance or a later undo', async () => {
  const { store } = await setup();
  const note = await accept(store);
  await store.save(note.id, noteDraft(note), note.revision, [{ type: 'insights.undone' }]);
  expect((await store.memory()).moves).toHaveLength(0);
  const latest = (await store.list())[0];
  await store.save(latest.id, noteDraft(latest), latest.revision, [{ type: 'insights.accepted' }]);
  expect((await store.memory()).moves).toHaveLength(0);
});
it('appends selected tasks, deduplicates checklist text, and preserves checked states', async () => {
  const { store } = await setup();
  const original = (await store.list()).find((note) => note.id === 'launch')!;
  await accept(store, 'Check that notes survive a restart.\nCall Maya\ncall maya!\nCall Alex');
  const move = (await store.memory()).moves[0];
  expect(move.additions).toEqual(['Call Maya', 'Call Alex']);
  const saved = await store.command(apply(move, ['Call Maya']), 'apply-once');
  expect(saved.doc.content![1]).toBeDefined();
  expect(documentText(saved.doc)).toContain('Call Maya');
  expect(documentText(saved.doc)).not.toContain('Call Alex');
  const oldList = original.doc.content!.find((node) => node.type === 'taskList')!;
  const newList = saved.doc.content!.find((node) => node.type === 'taskList')!;
  expect(newList.content!.slice(0, oldList.content!.length)).toEqual(oldList.content);
  expect(newList.content!.at(-1)!.attrs).toEqual({ checked: false });
});
it('deduplicates exact save retries and refuses mutation ID reuse for another body', async () => {
  const { store } = await setup();
  const original = (await store.list())[0];
  const draft = noteDraft(original);
  const first = await store.save(original.id, draft, 1, [], 'save-retry');
  expect(await store.save(original.id, draft, 1, [], 'save-retry')).toEqual(first);
  expect((await store.memory()).events).toHaveLength(1);
  await expect(store.save(original.id, draft, 2, [], 'save-retry')).rejects.toMatchObject({
    status: 409,
  });
  await accept(store);
  const move = (await store.memory()).moves[0];
  const result = await store.command(apply(move), 'apply-retry');
  const before = await store.memory();
  expect(await store.command(apply(move), 'apply-retry')).toEqual(result);
  expect(await store.memory()).toEqual(before);
});
it.each(['source', 'target'] as const)(
  'rejects a reviewed move after its %s changes',
  async (side) => {
    const { store } = await setup();
    await accept(store);
    const move = (await store.memory()).moves[0];
    const note = (await store.list()).find(
      (entry) => entry.id === (side === 'source' ? move.sourceId : move.targetId),
    )!;
    await store.save(
      note.id,
      { ...noteDraft(note), tags: [...note.tags, 'Edited'] },
      note.revision,
    );
    const before = await store.list();
    await expect(store.command(apply(move), 'stale-review')).rejects.toMatchObject({ status: 409 });
    expect(await store.list()).toEqual(before);
  },
);
it('persists dismissals without resurfacing the same accepted action event', async () => {
  const { store, directory } = await setup();
  await accept(store);
  const move = (await store.memory()).moves[0];
  await store.command({ type: 'dismiss', candidate: move }, 'dismiss');
  expect((await createNoteStore(directory).memory()).moves).toHaveLength(0);
  expect((await store.memory()).events[0].type).toBe('move.dismissed');
});
it('undo restores only an unchanged checklist and records a compensating event', async () => {
  const { store } = await setup();
  const original = (await store.list()).find((note) => note.id === 'launch')!;
  await accept(store);
  await store.command(apply((await store.memory()).moves[0]), 'apply');
  const eventId = (await store.memory()).undoable[0].eventId;
  const restored = await store.command({ type: 'undo', eventId }, 'undo');
  expect(restored.doc).toEqual(original.doc);
  expect(restored.revision).toBe(3);
  expect((await store.memory()).events[0].type).toBe('move.undone');
  expect((await store.memory()).moves).toHaveLength(0);
  expect((await store.memory()).undoable).toHaveLength(0);
  await expect(store.command({ type: 'undo', eventId }, 'another-undo')).rejects.toMatchObject({
    status: 409,
  });
});
it('refuses undo after a newer manual edit and hides full undo documents from memory responses', async () => {
  const { store } = await setup();
  await accept(store);
  const saved = await store.command(apply((await store.memory()).moves[0]), 'apply');
  const memory = await store.memory();
  expect(memory.events.some((event) => 'previousDoc' in event)).toBe(false);
  await store.save(
    saved.id,
    { ...noteDraft(saved), properties: { ...saved.properties, title: 'New work' } },
    saved.revision,
  );
  await expect(
    store.command({ type: 'undo', eventId: memory.undoable[0].eventId }, 'undo'),
  ).rejects.toMatchObject({ status: 409 });
});

it('replays a committed move without replacing newer target edits in the returned view', async () => {
  const { store } = await setup();
  await accept(store);
  const command = apply((await store.memory()).moves[0]);
  const saved = await store.command(command, 'original-command');
  const edited = await store.save(
    saved.id,
    { ...noteDraft(saved), properties: { ...saved.properties, title: 'Newer target work' } },
    saved.revision,
  );
  expect(await store.command(command, 'original-command')).toEqual(edited);
  expect(
    (await store.memory()).events.filter((event) => event.type === 'move.applied'),
  ).toHaveLength(1);
});
