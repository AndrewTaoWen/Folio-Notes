// @vitest-environment node
import { expect, it } from 'vitest';
import { workspaceMemory } from '../server/anticipation.js';
import { seedNotes } from '../src/seed.js';
import type { WorkspaceEvent } from '../src/workspace-memory.js';
import { createAIMemory } from '@ai-components/react/memory';
import { prepareAIRequest } from '@ai-components/react/context';
import { noteRecipe } from '../src/ai.js';

it('keeps accepted note facts available beyond bounded recent history and explains selected policy context', () => {
  const notes = seedNotes();
  notes[0].properties.actions = 'Call Maya';
  const events: WorkspaceEvent[] = [
    {
      id: 'accepted',
      type: 'insights.accepted',
      noteId: notes[0].id,
      revision: 1,
      at: '2026-10-21T12:00:00Z',
      actions: 'Call Maya',
    },
    ...Array.from({ length: 210 }, (_, index): WorkspaceEvent => ({
      id: `other-${index}`,
      type: 'note.updated',
      noteId: 'research',
      revision: index + 1,
      at: '2026-10-21T12:01:00Z',
    })),
  ];
  const result = workspaceMemory(notes, events);
  expect(result.checkpoint!.actions).toHaveLength(200);
  expect(result.moves).toHaveLength(1);
  expect(result.moves[0].prediction!.inspection.sources).toMatchObject({
    accepted: 'Latest accepted note actions, excluding undone insights',
  });
  expect(JSON.stringify(result.moves[0].prediction!.inspection)).not.toContain('PRODUCT SYNC');
  const restored = createAIMemory({ snapshot: result.checkpoint });
  const request = prepareAIRequest(
    { action: 'extract', text: '' },
    {
      basePrompt: '',
      context: {},
      memoryScope: 'note:weekly-sync',
      snapshot: restored.getSnapshot(),
    },
    { recipe: noteRecipe },
  );
  expect(JSON.stringify(request.context)).toContain('Call Maya');
  events.push({
    id: 'undo',
    type: 'insights.undone',
    noteId: notes[0].id,
    revision: 2,
    at: '2026-10-21T12:02:00Z',
  });
  expect(workspaceMemory(notes, events).moves).toHaveLength(0);
});
it('projects original event timestamps consistently and only exposes approved context fields', () => {
  const notes = seedNotes();
  const event: WorkspaceEvent = {
    id: 'accepted',
    type: 'insights.accepted',
    noteId: 'weekly-sync',
    revision: 1,
    at: '2026-10-21T12:00:00Z',
    actions: 'Call Maya',
  };
  const a = workspaceMemory(notes, [event]).checkpoint!;
  const b = workspaceMemory(notes, [event]).checkpoint!;
  expect(a).toEqual(b);
  expect(a.actions[0].timestamp).toBe(event.at);
  expect(JSON.stringify(a)).not.toContain('PRODUCT SYNC');
});
