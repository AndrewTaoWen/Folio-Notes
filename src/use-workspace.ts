import { createAIMemory, AIActionRejectedError } from '@ai-components/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { noteDraft, type Note } from './model.js';
import type { MoveCommand, MoveReceipt, NoteIntent, WorkspaceMemory } from './workspace-memory.js';

export function useWorkspace() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('All changes saved');
  const [aiMemory] = useState(() => createAIMemory({ maxActions: 200 }));
  const [memory, setMemory] = useState<WorkspaceMemory>({ events: [], moves: [], undoable: [] });
  const [memoryError, setMemoryError] = useState('');
  const [moving, setMoving] = useState(false);
  const current = useRef<Note[]>([]);
  const intents = useRef(new Map<string, NoteIntent[]>());
  const pending = useRef(new Map<string, { body: string; version: number; intentCount: number }>());
  const commandBusy = useRef(false);
  const commandIds = useRef(new Map<string, string>());
  const memoryRequest = useRef(0);
  const refreshMemory = useCallback(async () => {
    const request = ++memoryRequest.current;
    try {
      const response = await fetch('/api/workspace/memory');
      if (!response.ok) throw new Error('Workspace memory could not be loaded.');
      const data = await response.json();
      if (
        !Array.isArray(data.events) ||
        !Array.isArray(data.moves) ||
        !Array.isArray(data.undoable)
      )
        throw new Error('Invalid workspace memory response.');
      if (mounted.current && request === memoryRequest.current) {
        if (data.checkpoint) aiMemory.replaceSnapshot(data.checkpoint);
        setMemory(data);
        setMemoryError('');
        return data as WorkspaceMemory;
      }
    } catch (cause) {
      if (mounted.current && request === memoryRequest.current)
        setMemoryError(cause instanceof Error ? cause.message : 'Memory is unavailable.');
    }
  }, [aiMemory]);
  const dirty = useRef(new Map<string, number>());
  const saving = useRef(false);
  const blocked = useRef(false);
  const mounted = useRef(true);
  const publish = useCallback((next: Note[]) => {
    current.current = next;
    if (mounted.current) setNotes(next);
  }, []);
  const flush = useCallback(async () => {
    if (saving.current || commandBusy.current || blocked.current || !dirty.current.size) return;
    saving.current = true;
    setSaveState('Saving…');
    try {
      for (const [id, version] of [...dirty.current]) {
        const note = current.current.find((entry) => entry.id === id);
        if (!note) continue;
        let request = pending.current.get(id);
        if (!request) {
          const actions = intents.current.get(id) ?? [];
          request = {
            version,
            intentCount: actions.length,
            body: JSON.stringify({
              note: noteDraft(note),
              revision: note.revision,
              intents: actions,
              mutationId: crypto.randomUUID(),
            }),
          };
          pending.current.set(id, request);
        }
        const response = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: request.body,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || 'Unable to save. Your draft is still open.');
        pending.current.delete(id);
        intents.current.set(id, (intents.current.get(id) ?? []).slice(request.intentCount));
        if (dirty.current.get(id) === request.version) dirty.current.delete(id);
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
        void refreshMemory();
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
  }, [publish, refreshMemory]);
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
          void refreshMemory();
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
  }, [publish, flush, refreshMemory]);
  const update = useCallback(
    (id: string, change: (note: Note) => Note, intent?: NoteIntent) => {
      const note = current.current.find((entry) => entry.id === id);
      if (!note) return;
      const next = change(note);
      if (JSON.stringify(note) === JSON.stringify(next)) return;
      if (intent) intents.current.set(id, [...(intents.current.get(id) ?? []), intent]);
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
      void refreshMemory();
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
  async function executeMove(command: MoveCommand, mutationId: string): Promise<MoveReceipt> {
    if (commandBusy.current || saving.current || dirty.current.size || blocked.current) {
      throw new AIActionRejectedError('Save your open changes before applying a next move.');
    }
    commandBusy.current = true;
    setMoving(true);
    try {
      const response = await fetch('/api/workspace/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, mutationId }),
      });
      const result = await response.json();
      if (!response.ok) {
        if ([400, 403, 404, 409].includes(response.status))
          throw new AIActionRejectedError(result.error || 'This move was rejected.');
        throw new Error(result.error || 'Could not apply this move.');
      }
      // A delayed response must never replace typing that happened during the request.
      if (dirty.current.has(result.id)) {
        blocked.current = true;
        setError(
          'The checklist changed while you were typing. Export your draft before reloading.',
        );
        setSaveState('Draft not saved');
      } else {
        publish(current.current.map((note) => (note.id === result.id ? result : note)));
      }
      const updated = await refreshMemory();
      const event = updated?.events.find((entry) => entry.mutationId === mutationId);
      if (!event)
        throw new Error('The move may have completed. Refresh memory and retry to reconcile it.');
      return { eventId: event.id, noteId: result.id, revision: result.revision };
    } catch (cause) {
      // The server may have committed before the connection failed. Reconcile saved notes
      // alongside outcomes, while preserving any draft typed during the request.
      try {
        const response = await fetch('/api/notes');
        if (response.ok) {
          const saved: Note[] = await response.json();
          if (Array.isArray(saved))
            publish(
              saved.map((note) =>
                dirty.current.has(note.id)
                  ? (current.current.find((draft) => draft.id === note.id) ?? note)
                  : note,
              ),
            );
        }
      } catch {
        /* Keep the open workspace usable if the server is still unreachable. */
      }
      await refreshMemory();
      throw cause;
    } finally {
      commandBusy.current = false;
      setMoving(false);
    }
  }
  async function perform(command: MoveCommand) {
    const signature = JSON.stringify(command);
    const id = commandIds.current.get(signature) ?? crypto.randomUUID();
    commandIds.current.set(signature, id);
    try {
      await executeMove(command, id);
      commandIds.current.delete(signature);
      return true;
    } catch (cause) {
      setMemoryError(cause instanceof Error ? cause.message : 'Could not apply this move.');
      return false;
    }
  }
  function validateMove() {
    if (saving.current || commandBusy.current || dirty.current.size || blocked.current)
      throw new AIActionRejectedError('Save your open changes before applying a next move.');
  }

  return {
    notes,
    aiMemory,
    executeMove,
    validateMove,
    loading,
    error,
    saveState,
    update,
    create,
    retry,
    memory,
    memoryError,
    moving,
    refreshMemory,
    perform,
  };
}
