import {
  createFetchTransport,
  defineAIContext,
  fromContext,
  type AITransport,
  type AIConfig,
} from '@ai-components/react';
import { latestAcceptedInsight } from './workspace-policy.js';

export const liveTransport = createFetchTransport('/api/ai', {
  async fetch(input, options) {
    const response = await fetch(input, options);
    if (response.ok) return response;
    if (response.status === 413)
      throw new Error(
        'The selected context is too large. Try a shorter passage or fewer linked notes.',
      );
    if (response.status === 503)
      throw new Error('Add your API key to .env.local and restart the app to use live AI.');
    throw new Error(
      `AI request failed (${response.status}). Check the API key, account balance, and model access.`,
    );
  },
});
export const noteRecipe = defineAIContext({
  name: 'notes.next-steps',
  purpose: 'Help the author turn their note into clear, reviewable next steps.',
  borrow: {
    document: fromContext('document'),
    linkedNotes: fromContext('linkedNotes'),
    lastAccepted: latestAcceptedInsight,
  },
  instructions:
    'Use only the supplied note and deliberately linked references. Keep facts, owners, and dates grounded. Never invent commitments. For action items and decisions, use one item per line. Keep the existing title unless a better title is clearly useful.',
  anticipate: () =>
    'The author will review and selectively apply page properties. No tasks are created, messages sent, or pages changed until accepted.',
});
export const writingRecipe = defineAIContext({
  name: 'notes.writing',
  purpose: 'Help with the selected passage or a short continuation in a note.',
  borrow: { document: fromContext('document'), linkedNotes: fromContext('linkedNotes') },
  instructions:
    'Keep the author’s voice and do not invent names, dates, or decisions. Return plain text only.',
  anticipate: ({ input }) =>
    input.action === 'complete'
      ? 'Return a short suffix. The author may press Tab to insert it at the cursor.'
      : 'The author reviews the proposed replacement before it enters the editor.',
});
export function propertiesConfig(context: Record<string, unknown>): AIConfig {
  return {
    recipe: noteRecipe,
    context,
  };
}

/** Offline fixtures make the full review workflow available without credentials. */
export const mockTransport: AITransport = {
  async generate(request, { signal }) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 450);
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
    if (request.action === 'extract') {
      const borrowed = (request.context?._ai as { borrowed?: { document?: string } })?.borrowed;
      const doc = borrowed?.document ?? '';
      const input = JSON.parse(request.text) as { values: Record<string, string> };
      const seeded = doc.includes('Maya will sketch');
      const values = {
        summary: seeded
          ? 'Make the first five minutes lighter: a calm starting point, one useful example, and AI that helps with the next step. The first release focuses on individual workspaces.'
          : doc
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .slice(0, 3)
              .join(' ')
              .slice(0, 360),
        decisions: seeded
          ? 'Start with a quieter onboarding flow.\nKeep the welcome checklist optional.\nFocus the first release on individual workspaces.'
          : 'Review the note and record the decisions you want to keep.',
        actions: seeded
          ? 'Maya — Sketch the first-run experience by Friday.\nAlex — Test the prototype with three people next week.\nSam — Explain how note context is used.'
          : 'Review the note and identify the next concrete action.',
      };
      return {
        text: '',
        data: {
          changes: Object.entries(values)
            .filter(([field, value]) => input.values[field] !== value)
            .map(([field, value]) => ({
              field,
              value,
              reason: 'Suggested from the current note. Mock mode uses a deterministic example.',
            })),
        },
      };
    }
    if (request.action === 'complete')
      return { text: ' The next step is to try it with a few people and see what feels natural.' };
    const first = request.text.match(/^.+?[.!?](?:\s|$)/)?.[0]?.trim();
    return {
      text:
        first && first.length < request.text.length
          ? first
          : `In other words: ${request.text.replace(/\s+/g, ' ').trim()}`,
    };
  },
};
