import { defineAIPolicy } from '@ai-components/react/prediction';
import { fromContext, type AIContextSource } from '@ai-components/react/context';
import type { AIActionProposal } from '@ai-components/react/actions';
import {
  actionLines,
  normalizeTask,
  type FolioStep,
  type NextMoveBase,
} from './workspace-memory.js';

export const latestAcceptedInsight: AIContextSource = {
  description: 'Latest accepted note actions, excluding undone insights',
  select(view) {
    return view.read('acceptedInsight') ?? undefined;
  },
};
export function moveProposalId(move: NextMoveBase) {
  return `${move.id}:${move.sourceRevision}:${move.targetRevision}`;
}
export function moveProposal(move: NextMoveBase): AIActionProposal<FolioStep> {
  return {
    id: moveProposalId(move),
    title: `Bring the follow-through into “${move.targetTitle}”`,
    description: `You accepted action items in ${move.sourceTitle}, which explicitly links to this checklist. Append selected tasks; existing checked states stay intact.`,
    evidence: [
      { label: move.sourceTitle, reference: move.sourceEventId, revision: move.sourceRevision },
      { label: move.targetTitle, reference: move.targetId, revision: move.targetRevision },
    ],
    steps: move.additions.map((text, index) => ({
      id: `task-${index}`,
      label: text,
      payload: { text, candidate: move },
    })),
  };
}
export const checklistPolicy = defineAIPolicy<FolioStep>({
  name: 'folio.linked-checklist',
  purpose: 'Connect accepted meeting actions to an explicitly linked checklist.',
  actionType: 'folio.checklist',
  borrow: {
    accepted: latestAcceptedInsight,
    source: fromContext('source'),
    targets: fromContext('linkedChecklists'),
    completed: fromContext('completedCandidates'),
  },
  predict({ borrowed }) {
    const accepted = borrowed.accepted as
      { data: { eventId: string; actions?: string } } | undefined;
    const source = borrowed.source as {
      id: string;
      title: string;
      revision: number;
      actions: string;
    };
    if (!accepted?.data.actions || accepted.data.actions !== source.actions) return [];
    const completed = borrowed.completed as readonly string[];
    const targets = borrowed.targets as readonly {
      id: string;
      title: string;
      revision: number;
      tasks: readonly string[];
    }[];
    return targets.flatMap((target) => {
      const id = `${accepted.data.eventId}:${target.id}`;
      if (completed.includes(id)) return [];
      const existing = new Set(target.tasks.map(normalizeTask));
      const additions = actionLines(accepted.data.actions!).filter((text) => {
        const normalized = normalizeTask(text);
        if (!normalized || existing.has(normalized)) return false;
        existing.add(normalized);
        return true;
      });
      if (!additions.length) return [];
      return [
        moveProposal({
          id,
          sourceId: source.id,
          sourceTitle: source.title,
          sourceRevision: source.revision,
          sourceEventId: accepted.data.eventId,
          targetId: target.id,
          targetTitle: target.title,
          targetRevision: target.revision,
          additions,
        }),
      ];
    });
  },
});
