// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createNoteStore } from '../server/store.js';
import { noteDraft, paragraph } from '../src/model.js';
const directories: string[] = [];
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-test-'));
  directories.push(directory);
  return { directory, store: createNoteStore(directory) };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
it('seeds once and persists notes across independent store instances', async () => {
  const { store, directory } = await setup();
  const initial = await store.list();
  expect(initial).toHaveLength(4);
  const draft = noteDraft(initial[0]);
  draft.properties.title = 'A persisted title';
  draft.doc.content!.push(paragraph('A new observation.'));
  const saved = await store.save(draft.id, draft, initial[0].revision);
  expect(saved.revision).toBe(2);
  const reopened = await createNoteStore(directory).list();
  expect(reopened[0].properties.title).toBe('A persisted title');
  expect(reopened[0].doc.content?.at(-1)).toEqual(paragraph('A new observation.'));
});
it('rejects concurrent stale writes without replacing the successful change', async () => {
  const { store } = await setup();
  const note = (await store.list())[0];
  const first = { ...noteDraft(note), properties: { ...note.properties, title: 'First update' } };
  const second = { ...noteDraft(note), properties: { ...note.properties, title: 'Stale update' } };
  const result = await Promise.allSettled([
    store.save(note.id, first, 1),
    store.save(note.id, second, 1),
  ]);
  expect(result[0].status).toBe('fulfilled');
  expect(result[1].status).toBe('rejected');
  expect((await store.list())[0].properties.title).toBe('First update');
});
it('does not reset corrupted storage to sample data', async () => {
  const { store, directory } = await setup();
  await store.list();
  await writeFile(path.join(directory, 'notes.json'), '{broken');
  await expect(store.list()).rejects.toThrow();
  expect(await readFile(path.join(directory, 'notes.json'), 'utf8')).toBe('{broken');
});
it('validates document blocks, IDs, and field types without partial saves', async () => {
  const { store } = await setup();
  const note = (await store.list())[0];
  await expect(
    store.save(note.id, { ...noteDraft(note), doc: { type: 'script', text: 'bad' } }, 1),
  ).rejects.toMatchObject({ status: 400 });
  await expect(store.save(note.id, { ...noteDraft(note), id: '../bad' }, 1)).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    store.save(note.id, { ...noteDraft(note), properties: { title: 4 } }, 1),
  ).rejects.toMatchObject({ status: 400 });
  expect((await store.list())[0].revision).toBe(1);
});
it('creates notes and removes broken or self-referential links', async () => {
  const { store } = await setup();
  const created = await store.create();
  expect(await store.list()).toHaveLength(5);
  const saved = await store.save(
    created.id,
    { ...noteDraft(created), linkedIds: [created.id, 'missing', 'weekly-sync'] },
    1,
  );
  expect(saved.linkedIds).toEqual(['weekly-sync']);
});
