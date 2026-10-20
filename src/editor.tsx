import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { AIRewriteMenu, useAITask, useAIMemory } from '@ai-components/react';
import { writingRecipe } from './ai.js';
import { Icon } from './icons.js';
import type { DocNode } from './model.js';

export function NoteEditor({
  doc,
  onChange,
  context,
}: {
  doc: DocNode;
  onChange(doc: DocNode): void;
  context: Record<string, unknown>;
}) {
  const { recordAction } = useAIMemory();
  const [selection, setSelection] = useState<{
    from: number;
    to: number;
    text: string;
    signature: string;
  } | null>(null);
  const [continuation, setContinuation] = useState<{
    text: string;
    position: number;
    signature: string;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [, setEditorVersion] = useState(0);
  const task = useAITask({ recipe: writingRecipe, context });
  const taskRef = useRef(task);
  taskRef.current = task;
  const continuationRef = useRef(continuation);
  continuationRef.current = continuation;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: doc as JSONContent,
    editorProps: {
      attributes: {
        'aria-label': 'Note editor',
        role: 'textbox',
        'aria-multiline': 'true',
        spellcheck: 'true',
      },
      handleKeyDown(view, event) {
        if (event.key === 'Escape') {
          setContinuation(null);
          taskRef.current.cancel();
          return false;
        }
        const suggestion = continuationRef.current;
        if (event.key === 'Tab' && !event.isComposing && suggestion && !event.shiftKey) {
          if (
            JSON.stringify(view.state.doc.toJSON()) !== suggestion.signature ||
            view.state.selection.to !== suggestion.position
          ) {
            setContinuation(null);
            return false;
          }
          event.preventDefault();
          view.dispatch(view.state.tr.insertText(suggestion.text, suggestion.position));
          setContinuation(null);
          recordAction({
            type: 'note.continuation.accepted',
            source: 'note-editor',
            data: { length: suggestion.text.length },
          });
          return true;
        }
        return false;
      },
    },
    onTransaction() {
      setEditorVersion((version) => version + 1);
    },
    onUpdate({ editor }) {
      onChange(editor.getJSON() as DocNode);
      setSelection(null);
      setContinuation(null);
      taskRef.current.cancel();
    },
    onSelectionUpdate({ editor }) {
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, '\n');
      setSelection(
        text.trim() ? { from, to, text, signature: JSON.stringify(editor.getJSON()) } : null,
      );
      setContinuation(null);
      taskRef.current.cancel();
    },
  });
  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(doc)) {
      editor.commands.setContent(doc as JSONContent, { emitUpdate: false });
      setSelection(null);
      setContinuation(null);
      taskRef.current.cancel();
    }
  }, [doc, editor]);
  useEffect(() => {
    setContinuation(null);
  }, [context, task.contextVersion]);

  async function continueWriting() {
    if (!editor || !task.enabled) return;
    setNotice('');
    setContinuation(null);
    const position = editor.state.selection.to;
    const signature = JSON.stringify(editor.getJSON());
    const text = editor.state.doc.textBetween(0, position, '\n').slice(-8000);
    if (!text.trim()) {
      setNotice('Write a little first, then place the cursor where you want to continue.');
      return;
    }
    const result = await task.run({
      action: 'complete',
      text,
      instruction: 'Continue at the cursor with one short sentence. Return only the suffix.',
    });
    if (
      !result ||
      !result.text.trim() ||
      JSON.stringify(editor.getJSON()) !== signature ||
      editor.state.selection.to !== position
    )
      return;
    setContinuation({ text: result.text, position, signature });
  }
  function insertContinuation() {
    if (!editor || !continuation) return;
    if (JSON.stringify(editor.getJSON()) !== continuation.signature) {
      setContinuation(null);
      return;
    }
    editor
      .chain()
      .focus()
      .insertContentAt(continuation.position, { type: 'text', text: continuation.text })
      .run();
    recordAction({
      type: 'note.continuation.accepted',
      source: 'note-editor',
      data: { length: continuation.text.length },
    });
    setContinuation(null);
  }
  if (!editor) return null;
  const tools = [
    {
      label: 'Bold',
      text: 'B',
      run: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive('bold'),
    },
    {
      label: 'Italic',
      text: 'I',
      run: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive('italic'),
    },
    {
      label: 'Heading',
      text: 'H₂',
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive('heading'),
    },
    {
      label: 'Bullet list',
      text: '≡',
      run: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive('bulletList'),
    },
    {
      label: 'Checklist',
      text: '☑',
      run: () => editor.chain().focus().toggleTaskList().run(),
      active: editor.isActive('taskList'),
    },
    {
      label: 'Undo edit',
      text: '↶',
      run: () => editor.chain().focus().undo().run(),
      active: false,
    },
    {
      label: 'Redo edit',
      text: '↷',
      run: () => editor.chain().focus().redo().run(),
      active: false,
    },
  ];
  return (
    <>
      <div className="editor-toolbar" aria-label="Formatting tools">
        {tools.map((tool) => (
          <button
            key={tool.label}
            type="button"
            aria-label={tool.label}
            title={tool.label}
            aria-pressed={['Undo edit', 'Redo edit'].includes(tool.label) ? undefined : tool.active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={tool.run}
          >
            {tool.text}
          </button>
        ))}
        <span className="toolbar-divider" />
        <button
          type="button"
          className="continue-tool"
          onMouseDown={(event) => event.preventDefault()}
          onClick={continueWriting}
          disabled={!task.enabled || task.status === 'loading'}
        >
          <Icon name="spark" size={15} />
          {task.status === 'loading' ? 'Thinking…' : 'Continue'}
        </button>
      </div>
      {selection && (
        <section className="selection-tools" aria-label="Selection assistance">
          <span>Rewrite selected text</span>
          <AIRewriteMenu
            value={selection.text}
            ai={{ recipe: writingRecipe, context }}
            onValueChange={(value) => {
              if (JSON.stringify(editor.getJSON()) !== selection.signature) return;
              editor
                .chain()
                .focus()
                .insertContentAt(
                  { from: selection.from, to: selection.to },
                  { type: 'text', text: value },
                )
                .run();
              recordAction({
                type: 'note.rewrite.accepted',
                source: 'note-editor',
                data: { length: value.length },
              });
              setSelection(null);
            }}
          />
        </section>
      )}
      <EditorContent editor={editor} />
      {continuation && (
        <div className="continuation" role="status">
          <Icon name="spark" />
          <p>{continuation.text}</p>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={insertContinuation}
          >
            Insert <kbd>Tab</kbd>
          </button>
          <button
            type="button"
            aria-label="Discard continuation"
            onClick={() => setContinuation(null)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {(task.error || notice) && (
        <p className="inline-error" role="status">
          {task.error?.message || notice}
        </p>
      )}
      <p className="editor-hint">
        A space for the messy first draft. Select text to rewrite, or use Continue for a small
        nudge.
      </p>
    </>
  );
}
