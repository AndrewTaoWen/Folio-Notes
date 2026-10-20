import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { seedNotes } from '../src/seed.js';
import { plainDocument, type DocNode, type Note, type NoteDraft } from '../src/model.js';

export class StoreError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function validateDocument(value: unknown, depth = 0): asserts value is DocNode {
  if (depth > 30 || !value || typeof value !== 'object')
    throw new StoreError(400, 'Invalid document.');
  const node = value as DocNode;
  const allowed = [
    'doc',
    'paragraph',
    'text',
    'heading',
    'bulletList',
    'orderedList',
    'listItem',
    'blockquote',
    'codeBlock',
    'horizontalRule',
    'hardBreak',
    'taskList',
    'taskItem',
  ];
  if (!allowed.includes(node.type) || (node.text !== undefined && typeof node.text !== 'string'))
    throw new StoreError(400, 'Unsupported document block.');
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) throw new StoreError(400, 'Invalid document content.');
    node.content.forEach((child) => validateDocument(child, depth + 1));
  }
  if (node.type === 'doc' && depth !== 0)
    throw new StoreError(400, 'Nested documents are not supported.');
}
function validateDraft(value: unknown): asserts value is NoteDraft {
  if (!value || typeof value !== 'object') throw new StoreError(400, 'Invalid note.');
  const draft = value as NoteDraft;
  if (
    typeof draft.id !== 'string' ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(draft.id) ||
    !draft.properties ||
    ['title', 'summary', 'decisions', 'actions'].some(
      (key) => typeof Reflect.get(draft.properties, key) !== 'string',
    ) ||
    !Array.isArray(draft.tags) ||
    draft.tags.length > 30 ||
    draft.tags.some((v) => typeof v !== 'string' || v.length > 80) ||
    !Array.isArray(draft.linkedIds) ||
    draft.linkedIds.length > 30 ||
    draft.linkedIds.some((v) => typeof v !== 'string') ||
    typeof draft.favorite !== 'boolean'
  )
    throw new StoreError(400, 'Invalid note fields.');
  validateDocument(draft.doc);
  if (draft.doc.type !== 'doc') throw new StoreError(400, 'Expected a document root.');
}

/** A serialized, atomic disk store for one local server process. Revision checks protect stale tabs. */
export function createNoteStore(directory: string) {
  const filename = path.join(directory, 'notes.json');
  let queue: Promise<unknown> = Promise.resolve();
  async function persist(notes: Note[]) {
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({ version: 1, notes }, null, 2), { mode: 0o600 });
    await rename(temporary, filename);
  }
  async function read(): Promise<Note[]> {
    try {
      const data = JSON.parse(await readFile(filename, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.notes))
        throw new Error('Invalid note storage format.');
      return data.notes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const notes = seedNotes();
      await persist(notes);
      return notes;
    }
  }
  function transaction<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }
  return {
    list: () => transaction(read),
    create: () =>
      transaction(async () => {
        const notes = await read();
        const note: Note = {
          id: randomUUID(),
          properties: { title: 'Untitled', summary: '', decisions: '', actions: '' },
          doc: plainDocument(''),
          tags: [],
          linkedIds: [],
          favorite: false,
          revision: 1,
          updatedAt: new Date().toISOString(),
        };
        await persist([...notes, note]);
        return note;
      }),
    save: (id: string, value: unknown, revision: unknown) =>
      transaction(async () => {
        validateDraft(value);
        if (value.id !== id) throw new StoreError(400, 'Note ID mismatch.');
        const notes = await read();
        const index = notes.findIndex((note) => note.id === id);
        if (index < 0) throw new StoreError(404, 'Note not found.');
        if (notes[index].revision !== revision)
          throw new StoreError(
            409,
            'This note changed in another tab. Export your draft before reloading.',
          );
        const { properties, doc, tags, linkedIds, favorite } = value;
        const updated: Note = {
          id,
          properties,
          doc,
          tags,
          linkedIds: linkedIds.filter(
            (linkedId) => linkedId !== id && notes.some((note) => note.id === linkedId),
          ),
          favorite,
          revision: notes[index].revision + 1,
          updatedAt: new Date().toISOString(),
        };
        notes[index] = updated;
        await persist(notes);
        return updated;
      }),
  };
}
