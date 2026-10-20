import { useEffect, useMemo, useRef, useState } from 'react';
import { AIChangePreview, useAISuggestion, useAIMemory } from '@ai-components/react';
import { propertiesConfig } from './ai.js';
import { NoteEditor } from './editor.js';
import { Icon } from './icons.js';
import { documentText, type Note } from './model.js';

const fields = [
  { key: 'title', label: 'Page title' },
  { key: 'summary', label: 'Summary' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'actions', label: 'Action items' },
] as const;
const defaultInstruction =
  'Summarize this note, capture decisions, and list concrete action items with owners and dates when stated. Leave absent details out. Keep a useful existing title.';

export function NotePage({
  note,
  notes,
  update,
  mode,
  backend,
  showAssistant,
  onOpen,
  onCloseAssistant,
}: {
  note: Note;
  notes: Note[];
  update(id: string, change: (note: Note) => Note): void;
  mode: string;
  backend: string;
  showAssistant: boolean;
  onOpen(id: string): void;
  onCloseAssistant(): void;
}) {
  const [instruction, setInstruction] = useState(defaultInstruction);
  const [tag, setTag] = useState('');
  const title = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const resize = () => {
      if (!title.current) return;
      title.current.style.height = 'auto';
      title.current.style.height = `${Math.min(180, Math.max(60, title.current.scrollHeight))}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [note.properties.title]);
  const { actions } = useAIMemory();
  const text = documentText(note.doc);
  const linked = notes.filter((entry) => note.linkedIds.includes(entry.id));
  const context = useMemo(
    () => ({
      document: text.slice(0, 16_000),
      linkedNotes: linked.slice(0, 3).map((entry) => ({
        id: entry.id,
        title: entry.properties.title,
        text: documentText(entry.doc).slice(0, 2_000),
      })),
    }),
    [
      text,
      JSON.stringify(
        linked.map((entry) => ({ id: entry.id, title: entry.properties.title, doc: entry.doc })),
      ),
    ],
  );
  const ai = useMemo(() => propertiesConfig(context), [context]);
  const suggestion = useAISuggestion({
    value: note.properties,
    fields,
    ai,
    onValueChange: (properties) => update(note.id, (current) => ({ ...current, properties })),
  });
  const related = notes
    .filter((entry) => entry.id !== note.id && !note.linkedIds.includes(entry.id))
    .sort(
      (a, b) =>
        b.tags.filter((tag) => note.tags.includes(tag)).length -
        a.tags.filter((tag) => note.tags.includes(tag)).length,
    )
    .slice(0, 3);
  const inspected = suggestion.prepare({ action: 'extract', text: '', instruction }).context?._ai;
  function toggleLink(id: string) {
    if (!note.linkedIds.includes(id) && note.linkedIds.length >= 3) return;
    update(note.id, (current) => ({
      ...current,
      linkedIds: current.linkedIds.includes(id)
        ? current.linkedIds.filter((key) => key !== id)
        : [...current.linkedIds, id],
    }));
  }
  return (
    <div className={`workspace-content ${showAssistant ? '' : 'assistant-hidden'}`}>
      <main className="document-pane">
        <div className="document-inner">
          <div className="page-kicker">
            <span className="page-symbol">
              <Icon name="note" size={24} />
            </span>
            <span>YOUR THOUGHTS, WITH A LITTLE MOMENTUM</span>
          </div>
          <textarea
            ref={title}
            className="page-title"
            aria-label="Page title"
            rows={1}
            value={note.properties.title}
            placeholder="Untitled"
            onChange={(event) =>
              update(note.id, (current) => ({
                ...current,
                properties: { ...current.properties, title: event.target.value.replace(/\n/g, '') },
              }))
            }
          />
          <div className="page-meta">
            <span className="meta-label">Filed under</span>
            <div className="tags">
              {note.tags.map((name) => (
                <button
                  className="tag"
                  type="button"
                  key={name}
                  title={`Remove ${name}`}
                  aria-label={`Remove tag ${name}`}
                  onClick={() =>
                    update(note.id, (current) => ({
                      ...current,
                      tags: current.tags.filter((value) => value !== name),
                    }))
                  }
                >
                  {name}
                  <span>×</span>
                </button>
              ))}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = tag.trim();
                  if (value && !note.tags.includes(value) && note.tags.length < 30)
                    update(note.id, (current) => ({ ...current, tags: [...current.tags, value] }));
                  setTag('');
                }}
              >
                <input
                  aria-label="Add tag"
                  value={tag}
                  maxLength={80}
                  placeholder="+ Add tag"
                  onChange={(event) => setTag(event.target.value)}
                />
              </form>
            </div>
          </div>
          <NoteEditor
            doc={note.doc}
            context={context}
            onChange={(doc) => update(note.id, (current) => ({ ...current, doc }))}
          />
          {(note.properties.summary || note.properties.decisions || note.properties.actions) && (
            <section className="insights" aria-label="Accepted page insights">
              <div className="section-eyebrow">
                <Icon name="check" size={15} /> KEPT FROM THIS NOTE
              </div>
              {(['summary', 'decisions', 'actions'] as const).map(
                (field) =>
                  note.properties[field] && (
                    <label key={field}>
                      <span>
                        {field === 'actions'
                          ? 'Action items'
                          : field[0].toUpperCase() + field.slice(1)}
                      </span>
                      <textarea
                        aria-label={`Edit ${field}`}
                        value={note.properties[field]}
                        rows={field === 'summary' ? 3 : 4}
                        onChange={(event) =>
                          update(note.id, (current) => ({
                            ...current,
                            properties: { ...current.properties, [field]: event.target.value },
                          }))
                        }
                      />
                    </label>
                  ),
              )}
            </section>
          )}
          <footer className="document-footer">
            <span>{text.trim() ? text.trim().split(/\s+/).length : 0} words</span>
            <span>Personal workspace · stored on this computer</span>
          </footer>
        </div>
      </main>
      {showAssistant && (
        <aside className="assistant-pane" aria-label="Note assistance">
          <div className="assistant-header">
            <span className="spark-badge">
              <Icon name="spark" size={19} />
            </span>
            <div>
              <h2>A little perspective</h2>
              <p>Useful context. Your next move.</p>
            </div>
            <button
              className="icon-button close-assistant"
              type="button"
              aria-label="Close perspective"
              onClick={onCloseAssistant}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="mode-badge">
            <span className={`status-dot ${mode === 'live' ? 'live' : ''}`} />
            {mode === 'live' ? backend : 'Mock mode · no API calls'}
          </div>
          <section className="assistant-section">
            <div className="section-eyebrow">FROM THOUGHTS TO NEXT STEPS</div>
            <h3>Keep the useful parts.</h3>
            <p>
              Find the summary, decisions, and things to do. Review every change before it becomes
              part of your page.
            </p>
            <label className="instruction-label" htmlFor="instruction">
              What should I look for?
            </label>
            <textarea
              id="instruction"
              className="instruction"
              value={instruction}
              onChange={(event) => {
                suggestion.dismiss();
                setInstruction(event.target.value);
              }}
              rows={4}
            />
            <button
              className="primary extract-button"
              type="button"
              disabled={!suggestion.enabled || !text.trim() || suggestion.status === 'loading'}
              onClick={() => suggestion.suggest(instruction)}
            >
              <Icon name="spark" size={16} />
              {suggestion.status === 'loading' ? 'Reading your note…' : 'Find the next steps'}
              {suggestion.status !== 'loading' && <Icon name="arrow" size={16} />}
            </button>
            {text.length > 16_000 && (
              <p className="small-note">
                This request uses the first 16,000 characters of this note.
              </p>
            )}
            <AIChangePreview
              changes={suggestion.changes}
              sources={suggestion.sources}
              onAccept={suggestion.accept}
              onDismiss={suggestion.dismiss}
              onUndo={suggestion.undo}
              canUndo={suggestion.canUndo}
            />
            <p role="status" className="inline-error">
              {suggestion.error}
            </p>
          </section>
          <section className="assistant-section">
            <div className="section-heading">
              <div className="section-eyebrow">
                <Icon name="link" size={14} /> LINKED CONTEXT
              </div>
              <span>{linked.length}/3</span>
            </div>
            <p className="small-note">
              Only this page and the notes you include below are supplied as document context.
            </p>
            {linked.map((entry) => (
              <div key={entry.id} className="context-card">
                <div>
                  <button type="button" className="context-title" onClick={() => onOpen(entry.id)}>
                    <Icon name="note" size={15} />
                    {entry.properties.title}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove context ${entry.properties.title}`}
                    onClick={() => toggleLink(entry.id)}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
                <p>{documentText(entry.doc).slice(0, 130)}…</p>
                <span className="context-included">
                  <Icon name="check" size={12} /> Included in suggestions
                </span>
              </div>
            ))}
            <details className="context-picker">
              <summary>
                <Icon name="plus" size={14} /> Include another note
              </summary>
              {notes
                .filter((entry) => entry.id !== note.id)
                .map((entry) => (
                  <label key={entry.id}>
                    <input
                      type="checkbox"
                      checked={note.linkedIds.includes(entry.id)}
                      disabled={!note.linkedIds.includes(entry.id) && linked.length >= 3}
                      onChange={() => toggleLink(entry.id)}
                    />
                    {entry.properties.title}
                  </label>
                ))}
            </details>
          </section>
          <section className="assistant-section related-section">
            <div className="section-eyebrow">ELSEWHERE IN YOUR WORKSPACE</div>
            {related.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="related-note"
                onClick={() => onOpen(entry.id)}
              >
                <Icon name="note" size={16} />
                <span>
                  {entry.properties.title}
                  <small>{entry.tags.join(' · ') || 'Note'}</small>
                </span>
                <Icon name="chevron" size={13} />
              </button>
            ))}
          </section>
          <details className="context-inspector">
            <summary>
              Inspect AI context <span>↗</span>
            </summary>
            <pre>{JSON.stringify(inspected, null, 2)}</pre>
            <p>
              Linked note excerpts are limited to 2,000 characters each. Recent accepted page
              properties are session memory.
            </p>
          </details>
          <p className="memory-footnote">
            {actions.length
              ? `${actions.length} accepted action${actions.length === 1 ? '' : 's'} in this session`
              : 'Nothing applied yet. You’re in control.'}
          </p>
        </aside>
      )}
    </div>
  );
}
