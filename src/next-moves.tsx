import { useState } from 'react';
import type { MoveCommand, NextMove, WorkspaceMemory } from './workspace-memory.js';

function MoveCard({
  move,
  disabled,
  perform,
  onOpen,
}: {
  move: NextMove;
  disabled: boolean;
  perform(command: MoveCommand): Promise<boolean>;
  onOpen(id: string): void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [selected, setSelected] = useState(move.additions);
  return (
    <article className="next-move-card">
      <h3>Bring the follow-through into “{move.targetTitle}”</h3>
      <p>
        You accepted action items in{' '}
        <button className="text-link" onClick={() => onOpen(move.sourceId)}>
          {move.sourceTitle}
        </button>
        , which explicitly links to this checklist.
      </p>
      {!reviewing ? (
        <button type="button" className="secondary" onClick={() => setReviewing(true)}>
          Review {move.additions.length} task additions
        </button>
      ) : (
        <>
          <p className="small-note">
            Append to the first checklist. Existing tasks and checked states stay as they are.
          </p>
          <fieldset disabled={disabled}>
            <legend>New tasks for {move.targetTitle}</legend>
            {move.additions.map((text) => (
              <label key={text}>
                <input
                  type="checkbox"
                  checked={selected.includes(text)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, text]
                        : selected.filter((item) => item !== text),
                    )
                  }
                />
                <span>{text}</span>
              </label>
            ))}
          </fieldset>
          <div className="move-buttons">
            <button
              type="button"
              className="primary"
              disabled={disabled || !selected.length}
              onClick={() => void perform({ type: 'apply', candidate: move, selected })}
            >
              Add selected tasks ({selected.length})
            </button>
            <button type="button" className="secondary" onClick={() => setReviewing(false)}>
              Close preview
            </button>
          </div>
          <p className="small-note">
            Source revision {move.sourceRevision} · Checklist revision {move.targetRevision}. Both
            are checked again when you apply.
          </p>
        </>
      )}
      <button
        type="button"
        className="text-link dismiss-move"
        disabled={disabled}
        onClick={() => void perform({ type: 'dismiss', candidate: move })}
      >
        Dismiss this next move
      </button>
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
  refresh,
  onOpen,
}: {
  noteId: string;
  memory: WorkspaceMemory;
  error: string;
  disabled: boolean;
  perform(command: MoveCommand): Promise<boolean>;
  refresh(): Promise<void>;
  onOpen(id: string): void;
}) {
  const moves = memory.moves.filter((move) => move.sourceId === noteId || move.targetId === noteId);
  return (
    <section className="next-moves" aria-label="Workspace memory and next moves">
      <div className="section-eyebrow">WORKSPACE MEMORY</div>
      <h2>Next moves</h2>
      <p className="small-note">
        A quiet connection between what you kept and what comes next. Suggestions run locally and
        wait for your review.
      </p>
      {error && <p role="alert">{error}</p>}
      {moves.map((move) => (
        <MoveCard
          key={`${move.id}:${move.sourceRevision}:${move.targetRevision}`}
          move={move}
          disabled={disabled}
          perform={perform}
          onOpen={onOpen}
        />
      ))}
      {!moves.length && (
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
      {memory.undoable.map((item) => (
        <button
          type="button"
          className="secondary"
          key={item.eventId}
          disabled={disabled}
          onClick={() => void perform({ type: 'undo', eventId: item.eventId })}
        >
          Undo task additions to {item.title}
        </button>
      ))}
      <details className="workspace-history">
        <summary>Recent workspace activity ({memory.events.length})</summary>
        <p className="small-note">
          Saved across restarts. Includes note changes, accepted insights, and next move outcomes.
          The model does not receive this history automatically.
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
