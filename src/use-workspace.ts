import { useCallback, useEffect, useRef, useState } from 'react';
import { noteDraft, type Note } from './model.js';

export function useWorkspace() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('All changes saved');
  const current = useRef<Note[]>([]);
  const dirty = useRef(new Map<string, number>());
  const saving = useRef(false);
  const blocked = useRef(false);
  const mounted = useRef(true);
  const publish = useCallback((next: Note[]) => {
    current.current = next;
    if (mounted.current) setNotes(next);
  }, []);
  const flush = useCallback(async () => {
    if (saving.current || blocked.current || !dirty.current.size) return;
    saving.current = true;
    setSaveState('Saving…');
    try {
      for (const [id, version] of [...dirty.current]) {
        const note = current.current.find((entry) => entry.id === id);
        if (!note) continue;
        const response = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: noteDraft(note), revision: note.revision }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || 'Unable to save. Your draft is still open.');
        if (dirty.current.get(id) === version) dirty.current.delete(id);
        publish(
          current.current.map((entry) =>
            entry.id === id
              ? { ...entry, revision: data.revision, updatedAt: data.updatedAt }
              : entry,
          ),
        );
      }
      if (mounted.current) {
        setSaveState(dirty.current.size ? 'Unsaved changes' : 'All changes saved');
        setError('');
      }
    } catch (cause) {
      blocked.current = true;
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Unable to save.');
        setSaveState('Draft not saved');
      }
    } finally {
      saving.current = false;
    }
  }, [publish]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    fetch('/api/notes', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load the workspace.');
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Invalid workspace response.');
        if (!controller.signal.aborted) {
          publish(data);
          setLoading(false);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause.message);
          setLoading(false);
        }
      });
    const timer = setInterval(() => {
      void flush();
    }, 900);
    function beforeUnload(event: BeforeUnloadEvent) {
      if (dirty.current.size) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted.current = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [publish, flush]);
  const update = useCallback(
    (id: string, change: (note: Note) => Note) => {
      const note = current.current.find((entry) => entry.id === id);
      if (!note) return;
      const next = change(note);
      if (JSON.stringify(note) === JSON.stringify(next)) return;
      dirty.current.set(id, (dirty.current.get(id) ?? 0) + 1);
      publish(current.current.map((entry) => (entry.id === id ? next : entry)));
      setSaveState('Unsaved changes');
    },
    [publish],
  );
  async function create(): Promise<Note | null> {
    try {
      const response = await fetch('/api/notes', { method: 'POST' });
      if (!response.ok) throw new Error('Could not create a note.');
      const note = (await response.json()) as Note;
      publish([...current.current, note]);
      return note;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a note.');
      return null;
    }
  }
  function retry() {
    blocked.current = false;
    setError('');
    void flush();
  }
  return { notes, loading, error, saveState, update, create, retry };
}
