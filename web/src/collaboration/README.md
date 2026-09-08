# Native Yjs collaboration binding

`MadiCollaborationProvider` supplies `document: Y.Doc` and standard `awareness`.
The service uses a custom authenticated JSON WebSocket transport, not the
`y-websocket` transport. No external collaboration service is needed.

Editor integration order:

1. Create one provider per mounted document, register events **before** `connect()`.
2. Configure `StarterKit.configure({undoRedo:false})`,
   `Collaboration.configure({document:provider.document,field:'content'})`, and
   `CollaborationCaret.configure({provider,user:{name,color}})`.
3. Do **not** provide initial editor `content`. On `seed`, split and retain YAML
   front matter, set the editor content to the Markdown **body** once, and call
   `provider.seedFromCurrentDocument()`. Editing stays disabled until `synced`.
4. Disable the former REST Markdown autosave while this editor is mounted.
   `provider.flush()` implements an explicit save button. `saved` and `snapshot`
   report the committed document version and Markdown. Title/tags/shares still
   use optimistic REST PATCH/PUT with the latest version.
5. Use `change` to update connection and dirty indicators. On `reset` or `error`,
   offer the current editor Markdown as a downloadable recovery draft. Do not
   destroy/remount without warning while `hasUnsavedChanges` is true. Reloading
   explicitly creates a new provider/epoch and uses server Markdown.
6. On document navigation unmount the editor before `provider.destroy()`.

Two browsers receive each other's block changes and authenticated presence/cursor
positions. The collaboration extension supplies per-author undo/redo. PostgreSQL
commits Yjs state, canonical Markdown, block IDs, and a version snapshot atomically;
acknowledgement is sent only after commit. A lost connection keeps unsent edits in
the in-memory Y.Doc and replays them after reconnect to the same epoch. Browser
tab closure before acknowledgement is not durable local offline editing; prompt
on navigation and offer a recovery download.

REST/import/version restoration changing Markdown invalidates the epoch. A stale
editor never silently overwrites that replacement. Simultaneous first seeds are
serialized; the losing editor receives a reset and retains its recovery draft.

Schema: `madi-tiptap-v1`, root `Y.XmlFragment('content')`. The Go schema-aware
serializer rejects unknown nodes/marks rather than discarding their content.
Add a browser Markdown parser and Go round-trip fixture for each future custom
block before enabling it. YAML front matter stays exact outside the XML body.
