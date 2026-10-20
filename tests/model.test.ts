import { expect, it } from 'vitest';
import { documentText, exportMarkdown } from '../src/model.js';
import { seedNotes } from '../src/seed.js';
it('exports headings, marks, checklists, and accepted insights as Markdown', () => {
  const note = seedNotes()[3];
  note.properties.summary = 'A short summary.';
  note.doc.content!.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'Keep writing', marks: [{ type: 'bold' }] }],
  });
  const result = exportMarkdown(note);
  expect(result).toContain('- [x] Check that notes survive a restart');
  expect(result).toContain('**Keep writing**');
  expect(result).toContain('## Summary\nA short summary.');
  expect(documentText(note.doc)).toContain('Keep writing');
});
