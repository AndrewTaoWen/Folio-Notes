import { useEffect, useRef, useState } from 'react';
import {
  AIActionReview,
  AIContextInspector,
  AIActionRejectedError,
  useAIAction,
} from '@ai-components/react';
import { moveProposal } from './workspace-policy.js';
import type {
  FolioStep,
  MoveCommand,
  MoveReceipt,
  NextMove,
  WorkspaceMemory,
} from './workspace-memory.js';

type Execute = (command: MoveCommand, mutationId: string) => Promise<MoveReceipt>;
function ReviewMove({
  move,
  disabled,
  execute,
  validate,
  onReceipt,
  onClose,
}: {
  move: NextMove;
  disabled: boolean;
  execute: Execute;
  validate(): void;
  onReceipt(eventId: string): void;
  onClose(): void;
}) {
  const dismissId = useRef(crypto.randomUUID());
  const [dismissError, setDismissError] = useState('');
  const [dismissing, setDismissing] = useState(false);
  const action = useAIAction<FolioStep, MoveReceipt>({
    type: 'folio.checklist',
    scope: `note:${move.sourceId}`,
    source: 'folio-domain-ledger',
    enabled: !disabled,
    validate() {
      validate();
    },
    async execute(proposal, selected, { mutationId }) {
      const candidate = proposal.steps[0].payload.candidate;
      const receipt = await execute(
        {
          type: 'apply',
          candidate,
          selected: proposal.steps
            .filter((step) => selected.includes(step.id))
            .map((step) => step.payload.text),
        },
        mutationId,
      );
      onReceipt(receipt.eventId);
      return receipt;
    },
    async undo(receipt, { mutationId }) {
      validate();
      await execute({ type: 'undo', eventId: receipt.eventId }, mutationId);
      onClose();
    },
  });
  useEffect(() => {
    action.review(move.prediction?.proposal ?? moveProposal(move));
  }, []);
  const busy = dismissing || ['validating', 'executing', 'undoing'].includes(action.status);
  async function dismiss() {
    setDismissing(true);
    setDismissError('');
    try {
      await execute({ type: 'dismiss', candidate: move }, dismissId.current);
      action.dismiss();
      onClose();
    } catch (cause) {
      setDismissError(cause instanceof Error ? cause.message : 'Could not dismiss this move.');
      if (cause instanceof AIActionRejectedError) dismissId.current = crypto.randomUUID();
    } finally {
      setDismissing(false);
    }
  }
  return (
    <article className="next-move-card">
      {!action.proposal && action.status !== 'applied' && !action.canUndo && (
        <>
          <h3>Bring the follow-through into “{move.targetTitle}”</h3>
          <p>Accepted actions from {move.sourceTitle} link directly to this checklist.</p>
          <button
            type="button"
            className="secondary"
            disabled={disabled || busy}
            onClick={() => action.review(move.prediction?.proposal ?? moveProposal(move))}
          >
            Review {move.additions.length} task additions
          </button>
        </>
      )}
      <AIActionReview
        proposal={action.proposal}
        onAccept={action.accept}
        onDismiss={dismiss}
        onUndo={action.undo}
        canUndo={action.canUndo}
        busy={busy || disabled}
        retryPending={action.retryPending}
        error={dismissError || action.error}
      />
      <AIContextInspector inspection={move.prediction?.inspection ?? null} />
      {!action.proposal && !busy && !action.retryPending && (
        <button type="button" className="text-link dismiss-move" onClick={onClose}>
          Close next move
        </button>
      )}
    </article>
  );
}
const labels = {
  'note.created': 'Created a note',
  'note.updated': 'Saved changes',
  'insights.accepted': 'Accepted AI insights',
  'insights.undone': 'Undid AI insights',
  'move.applied': 'Added reviewed checklist tasks',
  'move.dismissed': 'Dismissed a next move',
  'move.undone': 'Undid checklist additions',
};
export function NextMoves({
  noteId,
  memory,
  error,
  disabled,
  perform,
  execute,
  validate,
  refresh,
}: {
  noteId: string;
  memory: WorkspaceMemory;
  error: string;
  disabled: boolean;
  perform(command: MoveCommand): Promise<boolean>;
  execute: Execute;
  validate(): void;
  refresh(): Promise<unknown>;
  onOpen(id: string): void;
}) {
  const moves = memory.moves.filter((move) => move.sourceId === noteId || move.targetId === noteId);
  const [active, setActive] = useState<NextMove | null>(null);
  const [liveReceipt, setLiveReceipt] = useState('');
  const shown = active ? [active] : moves;
  return (
    <section className="next-moves" aria-label="Workspace memory and next moves">
      <div className="section-eyebrow">WORKSPACE MEMORY</div>
      <h2>Next moves</h2>
      <p className="small-note">
        A quiet connection between what you kept and what comes next. Suggestions run locally and
        wait for your review.
      </p>
      {error && <p role="alert">{error}</p>}
      {shown.map((move) => (
        <div
          key={
            active ? 'active-review' : `${move.id}:${move.sourceRevision}:${move.targetRevision}`
          }
        >
          {active ? (
            <ReviewMove
              move={move}
              disabled={disabled}
              execute={execute}
              validate={validate}
              onReceipt={setLiveReceipt}
              onClose={() => {
                setActive(null);
                setLiveReceipt('');
              }}
            />
          ) : (
            <article className="next-move-card">
              <h3>Bring the follow-through into “{move.targetTitle}”</h3>
              <p>Accepted actions from {move.sourceTitle} link directly to this checklist.</p>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => setActive(move)}
              >
                Review {move.additions.length} task additions
              </button>
              <AIContextInspector inspection={move.prediction?.inspection ?? null} />
            </article>
          )}
        </div>
      ))}
      {!shown.length && (
        <p className="small-note">
          No pending next moves. Accept action items and link a note containing a checklist to try
          this workflow.
        </p>
      )}
      {disabled && (
        <p className="small-note" role="status">
          Finish saving before applying a next move.
        </p>
      )}
      {memory.undoable
        .filter((item) => !active || item.eventId !== liveReceipt)
        .map((item) => (
          <button
            type="button"
            className="secondary"
            key={item.eventId}
            disabled={disabled}
            onClick={async () => {
              if (await perform({ type: 'undo', eventId: item.eventId })) {
                setActive(null);
                setLiveReceipt('');
              }
            }}
          >
            Undo task additions to {item.title}
          </button>
        ))}
      <details className="workspace-history">
        <summary>Recent workspace activity ({memory.events.length})</summary>
        <p className="small-note">
          Persisted domain activity supplies approved context to the shared library. Raw note
          history is not automatically sent to a model.
        </p>
        <button type="button" className="secondary" onClick={() => void refresh()}>
          Refresh workspace memory
        </button>
        <ol>
          {memory.events.slice(0, 15).map((event) => (
            <li key={event.id}>
              <span>
                {labels[event.type]} · {event.noteId} · revision {event.revision}
              </span>
              <small>
                {new Date(event.at).toLocaleString()}
                {event.changedFields?.length ? ` · ${event.changedFields.join(', ')}` : ''}
              </small>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
