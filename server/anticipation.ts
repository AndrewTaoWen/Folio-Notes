import type { Note } from '../src/model.js';
import {
  actionLines,
  hasChecklist,
  normalizeTask,
  taskTexts,
  type NextMove,
  type WorkspaceEvent,
  type WorkspaceMemory,
} from '../src/workspace-memory.js';

/** A deterministic first policy: accepted actions may be copied to explicit checklist links. */
export function workspaceMemory(notes: Note[], events: WorkspaceEvent[]): WorkspaceMemory {
  const moves: NextMove[] = [];
  for (const source of notes) {
    const accepted = [...events]
      .reverse()
      .find(
        (event) =>
          event.noteId === source.id &&
          (event.type === 'insights.accepted' || event.type === 'insights.undone'),
      );
    if (
      accepted?.type !== 'insights.accepted' ||
      !accepted.actions ||
      accepted.actions !== source.properties.actions
    )
      continue;
    for (const target of notes) {
      if (
        !source.linkedIds.includes(target.id) ||
        source.id === target.id ||
        !hasChecklist(target.doc)
      )
        continue;
      const id = `${accepted.id}:${target.id}`;
      if (events.some((event) => event.candidateId === id)) continue;
      const existing = new Set(taskTexts(target.doc).map(normalizeTask));
      const additions = actionLines(accepted.actions).filter((text) => {
        const key = normalizeTask(text);
        if (!key || existing.has(key)) return false;
        existing.add(key);
        return true;
      });
      if (!additions.length) continue;
      moves.push({
        id,
        sourceId: source.id,
        sourceTitle: source.properties.title,
        sourceRevision: source.revision,
        sourceEventId: accepted.id,
        targetId: target.id,
        targetTitle: target.properties.title,
        targetRevision: target.revision,
        additions,
      });
    }
  }
  return {
    events: events
      .slice(-100)
      .reverse()
      .map(({ previousDoc: _previousDoc, ...event }) => event),
    moves: moves.slice(0, 20),
    undoable: events
      .filter(
        (event) =>
          event.type === 'move.applied' &&
          notes.some((note) => note.id === event.noteId && note.revision === event.revision) &&
          !events.some((later) => later.type === 'move.undone' && later.sourceEventId === event.id),
      )
      .map((event) => ({
        eventId: event.id,
        noteId: event.noteId,
        title: notes.find((note) => note.id === event.noteId)!.properties.title,
      })),
  };
}
