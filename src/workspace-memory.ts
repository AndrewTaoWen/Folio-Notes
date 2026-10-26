import type { AIPrediction } from '@ai-components/react/prediction';
import type { AIMemorySnapshot } from '@ai-components/react/memory';
import { documentText, type DocNode } from './model.js';

/** Semantic actions travel with the note save that made them durable. */
export type NoteIntent =
  { type: 'insights.accepted'; actions?: string } | { type: 'insights.undone' };

export interface WorkspaceEvent {
  id: string;
  type:
    | 'note.created'
    | 'note.updated'
    | NoteIntent['type']
    | 'move.applied'
    | 'move.dismissed'
    | 'move.undone';
  noteId: string;
  revision: number;
  at: string;
  changedFields?: string[];
  actions?: string;
  candidateId?: string;
  sourceEventId?: string;
  previousDoc?: DocNode;
  sourceNoteId?: string;
  proposalId?: string;
  mutationId?: string;
}

export type NextMoveBase = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceRevision: number;
  sourceEventId: string;
  targetId: string;
  targetTitle: string;
  targetRevision: number;
  additions: string[];
};

export type FolioStep = { text: string; candidate: NextMoveBase };
export interface NextMove extends NextMoveBase {
  prediction?: AIPrediction<FolioStep>;
}
export type MoveReceipt = { eventId: string; noteId: string; revision: number };

export interface WorkspaceMemory {
  checkpoint?: AIMemorySnapshot;
  events: Omit<WorkspaceEvent, 'previousDoc'>[];
  moves: NextMove[];
  undoable: { eventId: string; noteId: string; title: string }[];
}

export type MoveCommand =
  | { type: 'apply'; candidate: NextMove; selected: string[] }
  | { type: 'dismiss'; candidate: NextMove }
  | { type: 'undo'; eventId: string };

export function taskTexts(doc: DocNode): string[] {
  if (doc.type === 'taskItem') return [documentText(doc).trim()];
  return doc.content?.flatMap(taskTexts) ?? [];
}

export function hasChecklist(doc: DocNode): boolean {
  return doc.type === 'taskList' || (doc.content?.some(hasChecklist) ?? false);
}

export function actionLines(text: string): string[] {
  return [
    ...new Set(
      text
        .split('\n')
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
        .filter(Boolean),
    ),
  ];
}

export function normalizeTask(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
