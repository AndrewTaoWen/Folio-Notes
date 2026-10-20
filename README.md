# Folio

A small, local notes workspace built around ordinary writing and reviewable AI assistance.
Built with React, TypeScript, Tiptap, and the packaged [AI Components library](https://github.com/AndrewTaoWen/AI-Components).

## Run

Requires Node 22.12+.

```sh
npm ci
npm run dev
```

Open [localhost:5190](http://127.0.0.1:5190). The first launch creates four sample notes.
**Mock mode is the default**, so you can try every review interaction without an API key.

## What works

- Rich-text notes: headings, bold, italic, bullet lists, checklists, blockquotes, and editor undo/redo.
- Create pages, edit titles, add/remove tags, favorite pages, and search note text locally.
- Automatic server-side saving, with atomic file replacement and revision checks to protect stale tabs.
- Select a passage to use `AIRewriteMenu`; review before replacing the selection. Editing invalidates stale drafts.
- **Continue** proposes a short suffix at the cursor. Click Insert or press Tab in the editor to accept it.
- **Perspective → Find the next steps** uses `useAISuggestion` and `AIChangePreview` to propose a title,
  summary, decisions, and action items. Select which fields to apply and undo the accepted batch.
- Accepted insights stay editable beneath the document; they are page properties, not automatically created tasks.
- Link up to three notes as explicit AI context. Inspect the selected context and recent accepted actions.
- Export a note and its insights to Markdown.
- Workspace settings control inherited writing instructions and mock/live mode.

### Try the main workflow

1. Open **A little less friction**, a sample product-sync note.
2. Open **Perspective** if the assistant is hidden on a smaller screen.
3. Inspect the linked product-principles note. Add or remove context as needed.
4. Click **Find the next steps**. The original document and page properties stay unchanged during review.
5. Uncheck Decisions and apply the remaining fields. Summary and action items appear below the editor.
6. Click **Undo AI changes** to restore the previous properties. Manually changing an affected field disables that undo.
7. Select text in the editor to reveal rewrite actions, or place the cursor after some text and click Continue.

Mock responses are deterministic examples, not model reasoning. Use live mode to test prompt engineering.

## GPT-6 Luna

```sh
cp .env.example .env.local
```

Set these server-only variables, then restart the development server:

```env
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-6-luna
```

Open **Workspace settings** and switch AI mode to **Live**. The key remains on the server;
only its configured status and the model name are sent to the browser. `.env.local` is ignored by Git.
Live actions send the selected note context to OpenAI and incur API charges. The built-in adapter
uses the Responses API, strict JSON schemas for structured suggestions, reasoning effort `none`,
`store: false`, a 2,048-output-token cap, cancellation, and a 45-second timeout.

The current document is limited to its first 16,000 characters in recipe context. Up to three linked
notes contribute 2,000 characters each. Continue also uses up to 8,000 characters before the cursor.
The context inspector shows what was selected. Editing source text or linked context clears old proposals.
Accepted-action memory lasts for the session; the notes and accepted page properties persist on disk.

## Storage and current boundaries

Notes are stored in **`.data/notes.json`**, outside Git, using one local server process. Keep a backup
of this directory. Never run two app server processes against the same data directory. A note over
512 KB is rejected, leaving its open draft available to export. AI requests have a smaller 32 KB limit.

Conflicting saves return a visible error; they do not silently replace another tab's newer revision.
Export any unsaved draft before reloading a conflicting tab. Background save retries pause on an error
until you use Retry save. Editing, navigating between notes, and saving normal notes do not call a model.

This is a **single-user local MVP**, not a hosted Notion replacement. Accounts, permissions, real-time
collaboration, semantic/vector search, nested pages, persistent user preferences, file uploads, and
cross-document AI transactions are future work. Related notes use shared tags and explicit links;
search is literal text matching. AI extraction edits flat page properties; arbitrary block reordering
and multi-page task creation are intentionally outside the first version.

Both `npm run dev` and `npm run preview` provide the local APIs. A static-only deployment does not.
The server accepts only localhost/same-origin requests; add authentication and deployment-specific
storage before hosting this for other people.

## Development

```sh
npm test
npm run build
npm run format:check
```

The component library is installed from `vendor/ai-components-react-045ec1b.tgz`, a built snapshot
of the shared-memory and change-preview stack. Its source is independent of this app, and no source
aliases or symlinks are needed. The tarball includes the library's MIT license.

- `src/editor.tsx`: Tiptap adapter, selection rewrites, cursor continuations.
- `src/note-page.tsx`: page properties, prompt recipe inputs, review UI, explicit linked context.
- `src/use-workspace.ts`: autosaving controlled note drafts without overwriting newer local edits.
- `server/store.ts`: serialized disk persistence and optimistic revision checks.
- `server/openai.ts`: server-only OpenAI adapter.
- `server/notes-api.ts`: local note API.

Documentation: [Tiptap React](https://tiptap.dev/docs/editor/getting-started/install/react),
[OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Screenshots

The screenshots use the agent-authored sample notes. The review screenshot shows a live Luna response;
no user-provided private notes were included.

![Folio workspace](docs/folio-workspace.png)

![Reviewing proposed page insights](docs/folio-review.png)
