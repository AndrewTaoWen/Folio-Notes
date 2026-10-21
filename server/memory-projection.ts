import { createAIMemory } from '@ai-components/react/memory';
import type { Note } from '../src/model.js';
import type { WorkspaceEvent } from '../src/workspace-memory.js';

/** Durable domain history stays atomic with notes. This is its approved library context projection. */
export function projectMemory(notes: Note[], events: WorkspaceEvent[]) {
  let timestamp = '2026-01-01T00:00:00.000Z';
  const memory = createAIMemory({ maxActions: 200, clock: () => timestamp });
  for (const note of notes)
    memory.update(`note:${note.id}`, { noteId: note.id, title: note.properties.title });
  for (const event of events) {
    timestamp = event.at;
    let type: string = event.type;
    if (type === 'insights.accepted') type = 'note.properties.accepted';
    if (type === 'insights.undone') type = 'note.properties.accepted.undone';
    if (type === 'move.applied') type = 'folio.checklist.accepted';
    if (type === 'move.dismissed') type = 'folio.checklist.dismissed';
    if (type === 'move.undone') type = 'folio.checklist.undone';
    const data = {
      eventId: event.id,
      ...(event.actions !== undefined ? { actions: event.actions } : {}),
      ...(event.proposalId ? { proposalId: event.proposalId } : {}),
      ...(event.mutationId ? { mutationId: event.mutationId } : {}),
    };
    const scope = `note:${event.sourceNoteId ?? event.noteId}`;
    memory.recordAction(scope, { type, source: 'folio-domain-ledger', data });
    if (event.type === 'insights.accepted' || event.type === 'insights.undone')
      memory.update(scope, {
        acceptedInsight:
          event.type === 'insights.accepted' && event.actions ? { type, data, timestamp } : null,
      });
  }
  return memory.getSnapshot();
}
