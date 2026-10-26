import { evaluateAIPolicies } from '@ai-components/react/prediction';
import type { Note } from '../src/model.js';
import { checklistPolicy } from '../src/workspace-policy.js';
import {
  hasChecklist,
  taskTexts,
  type NextMove,
  type WorkspaceEvent,
  type WorkspaceMemory,
} from '../src/workspace-memory.js';
import { projectMemory } from './memory-projection.js';

/** Folio supplies note/checklist rules; the library supplies selection, prediction and inspection. */
export function workspaceMemory(notes: Note[], events: WorkspaceEvent[]): WorkspaceMemory {
  const checkpoint = projectMemory(notes, events);
  const moves: NextMove[] = [];
  for (const source of notes) {
    const result = evaluateAIPolicies({
      policies: [checklistPolicy],
      snapshot: checkpoint,
      scope: `note:${source.id}`,
      context: {
        source: {
          id: source.id,
          title: source.properties.title,
          revision: source.revision,
          actions: source.properties.actions,
        },
        linkedChecklists: notes
          .filter(
            (target) =>
              source.linkedIds.includes(target.id) &&
              source.id !== target.id &&
              hasChecklist(target.doc),
          )
          .map((target) => ({
            id: target.id,
            title: target.properties.title,
            revision: target.revision,
            tasks: taskTexts(target.doc),
          })),
        completedCandidates: events.flatMap((event) =>
          event.candidateId ? [event.candidateId] : [],
        ),
      },
    });
    if (result.errors.length) throw new Error(result.errors[0].message);
    for (const prediction of result.predictions)
      moves.push({ ...prediction.proposal.steps[0].payload.candidate, prediction });
  }
  return {
    checkpoint,
    moves: moves.slice(0, 20),
    events: events
      .slice(-100)
      .reverse()
      .map(({ previousDoc: _previousDoc, ...event }) => event),
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
