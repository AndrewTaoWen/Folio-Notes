import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { seedNotes } from '../src/seed.js';
import { moveProposalId } from '../src/workspace-policy.js';
import { workspaceMemory } from './anticipation.js';
import { type NoteIntent, type MoveCommand, type WorkspaceEvent } from '../src/workspace-memory.js';
import { paragraph, plainDocument, type DocNode, type Note, type NoteDraft } from '../src/model.js';

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
  interface WorkspaceData {
    version: 2;
    notes: Note[];
    events: WorkspaceEvent[];
    receipts: Record<string, { signature: string; result: Note }>;
  }
  async function persist(data: WorkspaceData) {
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(temporary, filename);
  }
  async function read(): Promise<WorkspaceData> {
    try {
      const data = JSON.parse(await readFile(filename, 'utf8'));
      if (!Array.isArray(data.notes)) throw new Error('Invalid note storage format.');
      if (data.version === 1) {
        // Migration preserves every existing note and revision. No history is invented.
        const migrated: WorkspaceData = { version: 2, notes: data.notes, events: [], receipts: {} };
        await persist(migrated);
        return migrated;
      }
      if (
        data.version !== 2 ||
        !Array.isArray(data.events) ||
        !data.receipts ||
        typeof data.receipts !== 'object'
      )
        throw new Error('Invalid workspace storage format.');
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const data: WorkspaceData = { version: 2, notes: seedNotes(), events: [], receipts: {} };
      await persist(data);
      return data;
    }
  }
  function event(
    data: WorkspaceData,
    note: Note,
    details: Pick<WorkspaceEvent, 'type'> & Partial<WorkspaceEvent>,
  ) {
    data.events.push({
      id: randomUUID(),
      noteId: note.id,
      revision: note.revision,
      at: new Date().toISOString(),
      ...details,
    });
  }
  function receipt(data: WorkspaceData, key: unknown, signature: string): Note | undefined {
    if (key === undefined) return;
    if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(key))
      throw new StoreError(400, 'Invalid mutation ID.');
    const existing = data.receipts[key];
    if (existing && existing.signature !== signature)
      throw new StoreError(409, 'Mutation ID already used for a different command.');
    return existing?.result;
  }
  function remember(data: WorkspaceData, key: unknown, signature: string, result: Note) {
    if (typeof key === 'string') {
      data.receipts[key] = { signature, result };
      // Bound full-note retry receipts; older retries still fail safely on revision checks.
      for (const expired of Object.keys(data.receipts).slice(0, -100))
        delete data.receipts[expired];
    }
  }
  function transaction<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }
  return {
    list: () => transaction(async () => (await read()).notes),
    memory: () =>
      transaction(async () => {
        const data = await read();
        return workspaceMemory(data.notes, data.events);
      }),
    create: () =>
      transaction(async () => {
        const data = await read();
        const { notes } = data;
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
        notes.push(note);
        event(data, note, { type: 'note.created' });
        await persist(data);
        return note;
      }),
    save: (
      id: string,
      value: unknown,
      revision: unknown,
      intents: unknown = [],
      mutationId?: unknown,
    ) =>
      transaction(async () => {
        validateDraft(value);
        if (value.id !== id) throw new StoreError(400, 'Note ID mismatch.');
        const data = await read();
        const { notes } = data;
        if (
          !Array.isArray(intents) ||
          intents.length > 100 ||
          intents.some(
            (intent) =>
              !intent ||
              typeof intent !== 'object' ||
              !['insights.accepted', 'insights.undone'].includes(intent.type) ||
              (intent.actions !== undefined &&
                (typeof intent.actions !== 'string' || intent.actions.length > 32000)),
          )
        )
          throw new StoreError(400, 'Invalid workspace actions.');
        const signature = createHash('sha256')
          .update(JSON.stringify([id, value, revision, intents]))
          .digest('hex');
        const repeated = receipt(data, mutationId, signature);
        if (repeated) return repeated;
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
        const previous = notes[index];
        const changedFields = ['properties', 'doc', 'tags', 'linkedIds', 'favorite'].filter(
          (key) =>
            JSON.stringify(Reflect.get(previous, key)) !==
            JSON.stringify(Reflect.get(updated, key)),
        );
        notes[index] = updated;
        event(data, updated, { type: 'note.updated', changedFields });
        for (const intent of intents as NoteIntent[])
          event(data, updated, {
            type: intent.type,
            ...(intent.type === 'insights.accepted' && intent.actions !== undefined
              ? { actions: intent.actions }
              : {}),
          });
        remember(data, mutationId, signature, updated);
        await persist(data);
        return updated;
      }),
    command: (input: unknown, mutationId: unknown) =>
      transaction(async () => {
        if (!input || typeof input !== 'object') throw new StoreError(400, 'Invalid move.');
        const command = input as MoveCommand;
        if (!['apply', 'dismiss', 'undo'].includes(command.type))
          throw new StoreError(400, 'Unknown move.');
        const data = await read();
        const signature = createHash('sha256').update(JSON.stringify(command)).digest('hex');
        if (mutationId === undefined) throw new StoreError(400, 'A mutation ID is required.');
        const repeated = receipt(data, mutationId, signature);
        if (repeated) return data.notes.find((note) => note.id === repeated.id) ?? repeated;
        if (command.type === 'undo') {
          const applied = data.events.find(
            (entry) => entry.id === command.eventId && entry.type === 'move.applied',
          );
          const target = data.notes.find((note) => note.id === applied?.noteId);
          if (!applied?.previousDoc || !target || target.revision !== applied.revision)
            throw new StoreError(409, 'This checklist changed. Undo would overwrite newer work.');
          target.doc = applied.previousDoc;
          target.revision++;
          target.updatedAt = new Date().toISOString();
          event(data, target, {
            type: 'move.undone',
            sourceEventId: applied.id,
            candidateId: applied.candidateId,
            sourceNoteId: applied.sourceNoteId,
            proposalId: applied.proposalId,
            mutationId: mutationId as string,
          });
          remember(data, mutationId, signature, target);
          await persist(data);
          return target;
        }
        const requested = command.candidate;
        const move =
          requested &&
          workspaceMemory(data.notes, data.events).moves.find((entry) => entry.id === requested.id);
        if (
          !move ||
          move.sourceRevision !== requested.sourceRevision ||
          move.targetRevision !== requested.targetRevision
        )
          throw new StoreError(
            409,
            'This suggestion changed. Review the current version before continuing.',
          );
        const target = data.notes.find((note) => note.id === move.targetId)!;
        if (command.type === 'dismiss') {
          event(data, target, {
            type: 'move.dismissed',
            candidateId: move.id,
            sourceNoteId: move.sourceId,
            proposalId: moveProposalId(move),
            mutationId: mutationId as string,
            sourceEventId: move.sourceEventId,
          });
        } else {
          if (
            !Array.isArray(command.selected) ||
            !command.selected.length ||
            new Set(command.selected).size !== command.selected.length ||
            command.selected.some((text) => !move.additions.includes(text))
          )
            throw new StoreError(400, 'Select valid task additions.');
          const selected = command.selected;
          const previousDoc = structuredClone(target.doc);
          const doc = structuredClone(target.doc);
          function append(node: DocNode): boolean {
            if (node.type === 'taskList') {
              node.content = [
                ...(node.content ?? []),
                ...selected.map((text) => ({
                  type: 'taskItem',
                  attrs: { checked: false },
                  content: [paragraph(text)],
                })),
              ];
              return true;
            }
            return node.content?.some(append) ?? false;
          }
          if (!append(doc)) throw new StoreError(409, 'The target no longer has a checklist.');
          target.doc = doc;
          target.revision++;
          target.updatedAt = new Date().toISOString();
          event(data, target, {
            type: 'move.applied',
            candidateId: move.id,
            sourceNoteId: move.sourceId,
            proposalId: moveProposalId(move),
            mutationId: mutationId as string,
            sourceEventId: move.sourceEventId,
            previousDoc,
          });
        }
        remember(data, mutationId, signature, target);
        await persist(data);
        return target;
      }),
  };
}
