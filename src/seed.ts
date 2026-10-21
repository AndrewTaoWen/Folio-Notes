import { paragraph, type DocNode, type Note } from './model.js';
const heading = (text: string): DocNode => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
});
const bullets = (...items: string[]): DocNode => ({
  type: 'bulletList',
  content: items.map((text) => ({ type: 'listItem', content: [paragraph(text)] })),
});
function note(
  id: string,
  title: string,
  content: DocNode[],
  tags: string[],
  linkedIds: string[] = [],
): Note {
  return {
    id,
    properties: { title, summary: '', decisions: '', actions: '' },
    doc: { type: 'doc', content },
    tags,
    linkedIds,
    favorite: id === 'weekly-sync',
    revision: 1,
    updatedAt: '2026-10-20T14:00:00.000Z',
  };
}
export function seedNotes(): Note[] {
  return [
    note(
      'weekly-sync',
      'A little less friction',
      [
        paragraph('PRODUCT SYNC · OCTOBER 20, 2026'),
        paragraph(
          'A good workspace should get out of the way. Today we talked about making the first five minutes feel a little lighter — fewer decisions, a clearer starting point, and a place to put the messy first draft.',
        ),
        heading('What we heard'),
        bullets(
          'People arrive with thoughts, not perfectly organized documents.',
          'The blank page is still the hardest part. A small nudge is more useful than another dashboard.',
          'AI should help with the next step, without taking over the whole page.',
        ),
        heading('A direction worth exploring'),
        paragraph(
          'We agreed to start with a quieter onboarding flow: one useful example, a simple note, and the option to make it your own. Keep the welcome checklist optional. The first release will focus on individual workspaces.',
        ),
        heading('Before we meet again'),
        bullets(
          'Maya will sketch the first-run experience by Friday.',
          'Alex will test the prototype with three people next week.',
          'Sam will write a short explanation of how note context is used.',
        ),
        {
          type: 'blockquote',
          content: [paragraph('Make the helpful thing feel like the obvious next thing.')],
        },
      ],
      ['Product', 'Meeting'],
      ['product-principles', 'launch'],
    ),
    note(
      'product-principles',
      'How we want this to feel',
      [
        heading('Less ceremony. More thinking.'),
        paragraph(
          'Our notes workspace is for small teams and individual makers. Prioritize a calm reading experience, reliable saving, and clear control over AI suggestions.',
        ),
        bullets(
          'Suggestions are invitations. Always let people review and undo.',
          'Borrow context deliberately. Show which notes were included.',
          'Writing comes first. Everything else should earn its place.',
        ),
      ],
      ['Product', 'Reference'],
    ),
    note(
      'research',
      'Things worth paying attention to',
      [
        paragraph(
          'A running collection of questions, observations, and small things that might turn into something.',
        ),
        heading('Questions for the next research round'),
        bullets(
          'When does an AI suggestion feel helpful rather than distracting?',
          'What do people expect to happen when they link one note to another?',
          'How should unfinished thoughts show up when you return to a page?',
        ),
      ],
      ['Research'],
    ),
    note(
      'launch',
      'A small launch checklist',
      [
        paragraph('A few essentials before we share the first version.'),
        {
          type: 'taskList',
          content: [
            'Check that notes survive a restart',
            'Try a suggestion, edit it, and undo it',
            'Make sure the key stays on the server',
          ].map((text, index) => ({
            type: 'taskItem',
            attrs: { checked: index === 0 },
            content: [paragraph(text)],
          })),
        },
      ],
      ['Planning'],
    ),
  ];
}
