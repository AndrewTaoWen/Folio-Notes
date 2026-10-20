export interface DocNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocNode[];
}
export type NoteProperties = { title: string; summary: string; decisions: string; actions: string };
export interface Note {
  id: string;
  properties: NoteProperties;
  doc: DocNode;
  tags: string[];
  linkedIds: string[];
  favorite: boolean;
  revision: number;
  updatedAt: string;
}
export type NoteDraft = Omit<Note, 'revision' | 'updatedAt'>;
export function documentText(doc: DocNode): string {
  if (doc.type === 'text') return doc.text ?? '';
  if (doc.type === 'hardBreak') return '\n';
  const parts = (doc.content ?? []).map(documentText);
  return parts.join(['paragraph', 'heading'].includes(doc.type) ? '' : '\n');
}
export function paragraph(text: string): DocNode {
  return { type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) };
}
export function plainDocument(text: string): DocNode {
  return { type: 'doc', content: text.split('\n').map(paragraph) };
}
export function noteDraft(note: Note): NoteDraft {
  const { revision: _revision, updatedAt: _updatedAt, ...draft } = note;
  return draft;
}
export function exportMarkdown(note: Note): string {
  function render(node: DocNode): string {
    if (node.type === 'text') {
      let result = node.text ?? '';
      for (const mark of node.marks ?? []) {
        if (mark.type === 'bold') result = `**${result}**`;
        if (mark.type === 'italic') result = `*${result}*`;
        if (mark.type === 'strike') result = `~~${result}~~`;
        if (mark.type === 'code') result = '`' + result + '`';
        if (mark.type === 'link' && typeof mark.attrs?.href === 'string')
          result = `[${result}](${mark.attrs.href})`;
      }
      return result;
    }
    if (node.type === 'hardBreak') return '\n';
    const children = node.content ?? [];
    if (node.type === 'heading')
      return (
        '#'.repeat(Math.max(1, Math.min(3, Number(node.attrs?.level) || 2))) +
        ' ' +
        children.map(render).join('')
      );
    if (node.type === 'taskItem')
      return `- [${node.attrs?.checked ? 'x' : ' '}] ${children.map(render).join(' ')}`;
    if (node.type === 'listItem') return '- ' + children.map(render).join(' ');
    if (node.type === 'orderedList')
      return children
        .map((child, index) => `${index + 1}. ${render(child).replace(/^- /, '')}`)
        .join('\n');
    if (node.type === 'blockquote')
      return children
        .map(render)
        .join('\n')
        .split('\n')
        .map((line) => '> ' + line)
        .join('\n');
    if (node.type === 'paragraph') return children.map(render).join('');
    if (node.type === 'codeBlock') return '```\n' + children.map(render).join('') + '\n```';
    if (node.type === 'horizontalRule') return '---';
    return children.map(render).join('\n\n');
  }
  const { title, summary, decisions, actions } = note.properties;
  return `# ${title || 'Untitled'}\n\n${render(note.doc)}${summary ? `\n\n## Summary\n${summary}` : ''}${decisions ? `\n\n## Decisions\n${decisions}` : ''}${actions ? `\n\n## Action items\n${actions}` : ''}\n`;
}
