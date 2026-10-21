import { useEffect, useMemo, useRef, useState } from 'react';
import { AIProvider } from '@ai-components/react';
import { mockTransport, liveTransport } from './ai.js';
import { Icon } from './icons.js';
import { NextMoves } from './next-moves.js';
import { NotePage } from './note-page.js';
import { documentText, exportMarkdown, type Note } from './model.js';
import { useWorkspace } from './use-workspace.js';
import '@ai-components/react/styles.css';
import './styles.css';

export default function App() {
  const workspace = useWorkspace();
  const [selected, setSelected] = useState(() => window.location.hash.slice(1) || 'weekly-sync');
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showAssistant, setShowAssistant] = useState(() => window.innerWidth >= 1001);
  const [mobileNav, setMobileNav] = useState(false);
  const [smallScreen, setSmallScreen] = useState(() => window.innerWidth <= 650);
  const [settings, setSettings] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<'mock' | 'live'>('mock');
  const [prompt, setPrompt] = useState(
    'Be clear, thoughtful, and brief. Preserve the author’s voice. Suggest useful next steps without inventing facts.',
  );
  const [backend, setBackend] = useState({ configured: false, model: 'gpt-6-luna' });
  const search = useRef<HTMLInputElement>(null);
  const settingsClose = useRef<HTMLButtonElement>(null);
  const settingsPanel = useRef<HTMLElement>(null);
  const page = workspace.notes.find((note) => note.id === selected) ?? workspace.notes[0];
  const filtered = useMemo(
    () =>
      workspace.notes.filter(
        (note) =>
          (!favoritesOnly || note.favorite) &&
          `${note.properties.title} ${note.tags.join(' ')} ${documentText(note.doc)} ${note.properties.summary}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [workspace.notes, favoritesOnly, query],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/ai/status', { signal: controller.signal })
      .then((response) => response.json())
      .then((status) => {
        if (!controller.signal.aborted && typeof status.configured === 'boolean')
          setBackend(status);
      })
      .catch(() => {});
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setMobileNav(true);
        search.current?.focus();
      }
      if (event.key === 'Escape') {
        setSettings(false);
        setMobileNav(false);
      }
    };
    const onHash = () => setSelected(window.location.hash.slice(1));
    const onResize = () => setSmallScreen(window.innerWidth <= 650);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    return () => {
      controller.abort();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  useEffect(() => {
    if (!settings) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = settingsPanel.current;
    settingsClose.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel) return;
      const controls = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select, textarea, input, [tabindex="0"]',
        ),
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    panel?.addEventListener('keydown', trap);
    return () => {
      panel?.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [settings]);
  useEffect(() => {
    if (mobileNav) search.current?.focus();
  }, [mobileNav]);
  function open(id: string) {
    setSelected(id);
    window.location.hash = id;
    setMobileNav(false);
  }
  async function create() {
    if (creating) return;
    setCreating(true);
    const note = await workspace.create();
    if (note) {
      setQuery('');
      setFavoritesOnly(false);
      open(note.id);
    }
    setCreating(false);
  }
  function download(note: Note) {
    const url = URL.createObjectURL(
      new Blob([exportMarkdown(note)], { type: 'text/markdown;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${note.properties.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Untitled'}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <AIProvider transport={mode === 'live' ? liveTransport : mockTransport} basePrompt={prompt}>
      <div className="app-shell">
        {mobileNav && (
          <button
            className="nav-scrim"
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          />
        )}
        <nav
          className={`sidebar ${mobileNav ? 'is-open' : ''}`}
          aria-label="Workspace navigation"
          inert={smallScreen && !mobileNav}
        >
          <div className="brand">
            <span className="brand-mark">
              <Icon name="leaf" size={23} />
            </span>
            <span>
              folio<span className="brand-dot">.</span>
            </span>
            <span className="early-label">EARLY</span>
          </div>
          <button type="button" className="workspace-switch" onClick={() => setSettings(true)}>
            <span className="avatar">A</span>
            <span>
              Personal workspace<small>A little room to think</small>
            </span>
            <Icon name="chevron" size={13} />
          </button>
          <label className="search-box">
            <Icon name="search" size={16} />
            <input
              ref={search}
              aria-label="Search notes"
              placeholder="Find a thought…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="nav-filters">
            <button
              type="button"
              className={!favoritesOnly ? 'active' : ''}
              onClick={() => {
                setFavoritesOnly(false);
                setQuery('');
              }}
            >
              <Icon name="note" size={16} />
              All notes<span>{workspace.notes.length}</span>
            </button>
            <button
              type="button"
              className={favoritesOnly ? 'active' : ''}
              onClick={() => setFavoritesOnly(true)}
            >
              <Icon name="star" size={16} />
              Favorites<span>{workspace.notes.filter((note) => note.favorite).length}</span>
            </button>
          </div>
          <div className="sidebar-section-title">
            <span>
              {query ? 'SEARCH RESULTS' : favoritesOnly ? 'FAVORITE PAGES' : 'YOUR PAGES'}
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="New note"
              onClick={create}
              disabled={creating}
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          <div className="page-list">
            {filtered.map((note) => (
              <button
                type="button"
                className={`page-link ${page?.id === note.id ? 'selected' : ''}`}
                key={note.id}
                onClick={() => open(note.id)}
              >
                <Icon name="note" size={16} />
                <span>{note.properties.title || 'Untitled'}</span>
                {note.favorite && <Icon name="star" size={11} />}
              </button>
            ))}
            {!filtered.length && !workspace.loading && (
              <p className="no-results">No notes here yet.{query && ' Try another word.'}</p>
            )}
          </div>
          <button type="button" className="new-page" onClick={create} disabled={creating}>
            <Icon name="plus" size={17} />
            {creating ? 'Creating…' : 'A new page'}
          </button>
          <div className="sidebar-bottom">
            <div className="local-note">
              <span className="status-dot" />
              Your space. On your computer.
            </div>
            <button type="button" className="settings-button" onClick={() => setSettings(true)}>
              <span className="avatar small">A</span>Workspace settings
              <Icon name="chevron" size={13} />
            </button>
          </div>
        </nav>
        <div className="main-shell">
          <header className="topbar">
            <button
              type="button"
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Icon name="menu" />
            </button>
            <div className="breadcrumbs">
              <span>Workspace</span>
              <Icon name="chevron" size={12} />
              <Icon name="note" size={14} />
              <span>{page?.properties.title || 'Notes'}</span>
            </div>
            <div className="topbar-actions">
              <span
                title={workspace.saveState}
                className={`save-status ${workspace.error ? 'has-error' : ''}`}
              >
                <Icon name={workspace.error ? 'clock' : 'check'} size={13} />
                {workspace.saveState}
              </span>
              {page && (
                <>
                  <button
                    type="button"
                    className={`icon-button ${page.favorite ? 'is-favorite' : ''}`}
                    aria-label={page.favorite ? 'Remove from favorites' : 'Add to favorites'}
                    onClick={() =>
                      workspace.update(page.id, (current) => ({
                        ...current,
                        favorite: !current.favorite,
                      }))
                    }
                  >
                    <Icon name="star" size={17} />
                  </button>
                  <button
                    type="button"
                    className="export-button"
                    aria-label="Export"
                    onClick={() => download(page)}
                  >
                    <Icon name="download" size={15} />
                    <span>Export</span>
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label="Perspective"
                className={`assistant-toggle ${showAssistant ? 'active' : ''}`}
                aria-pressed={showAssistant}
                onClick={() => setShowAssistant(!showAssistant)}
              >
                <Icon name="spark" size={16} />
                <span>Perspective</span>
              </button>
            </div>
          </header>
          {workspace.error && (
            <div className="save-error" role="alert">
              <span>
                {workspace.error} {page && 'Export keeps a copy of your open draft.'}
              </span>
              <button type="button" onClick={workspace.retry}>
                Retry save
              </button>
            </div>
          )}
          {workspace.loading ? (
            <main className="empty-state">
              <span className="brand-mark">
                <Icon name="leaf" size={28} />
              </span>
              <h1>Making a little room…</h1>
              <p>Opening your workspace.</p>
            </main>
          ) : page ? (
            <AIProvider memoryScope={`note:${page.id}`}>
              <NotePage
                key={page.id}
                note={page}
                notes={workspace.notes}
                update={workspace.update}
                nextMoves={
                  <NextMoves
                    noteId={page.id}
                    memory={workspace.memory}
                    error={workspace.memoryError}
                    disabled={workspace.moving || workspace.saveState !== 'All changes saved'}
                    perform={workspace.perform}
                    refresh={workspace.refreshMemory}
                    onOpen={open}
                  />
                }
                mode={mode}
                backend={backend.model}
                showAssistant={showAssistant}
                onOpen={open}
                onCloseAssistant={() => setShowAssistant(false)}
              />
            </AIProvider>
          ) : (
            <main className="empty-state">
              <h1>Your next thought starts here.</h1>
              <button className="primary" type="button" onClick={create}>
                Create a note
              </button>
            </main>
          )}
        </div>
        {settings && (
          <div
            className="modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSettings(false);
            }}
          >
            <section
              ref={settingsPanel}
              className="settings-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-title"
            >
              <button
                ref={settingsClose}
                className="modal-close icon-button"
                type="button"
                aria-label="Close settings"
                onClick={() => setSettings(false)}
              >
                <Icon name="close" />
              </button>
              <div className="section-eyebrow">YOUR WORKSPACE</div>
              <h2 id="settings-title">A little more personal.</h2>
              <p>Choose how AI fits into your writing. Notes are saved locally either way.</p>
              <label className="setting-label">
                AI mode
                <select
                  aria-label="AI mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as 'mock' | 'live')}
                >
                  <option value="mock">Mock — explore without API calls</option>
                  <option value="live">Live — {backend.model}</option>
                </select>
              </label>
              <div className="key-status">
                <span className={`status-dot ${backend.configured ? 'live' : ''}`} />
                {backend.configured
                  ? 'API key configured on the local server.'
                  : 'Add OPENAI_API_KEY to .env.local and restart the app.'}
              </div>
              {mode === 'live' && (
                <p className="small-note">
                  Live actions send selected note context to OpenAI and incur API charges. Your key
                  stays on the server.
                </p>
              )}
              <label className="setting-label">
                Writing instructions
                <textarea
                  rows={5}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
              <p className="small-note">
                Applies to suggestions and rewrites. Page-specific instructions and context are
                added separately.
              </p>
              <div className="settings-storage">
                <Icon name="note" />
                <span>
                  Notes live in <code>.data/notes.json</code>.
                  <small>Single-user local preview. No accounts or collaboration yet.</small>
                </span>
              </div>
              <button type="button" className="primary" onClick={() => setSettings(false)}>
                Back to your notes
                <Icon name="arrow" size={16} />
              </button>
            </section>
          </div>
        )}
      </div>
    </AIProvider>
  );
}
