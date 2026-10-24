# @house-rules/notes

Notes owns immutable plain-text notes on app targets. It exposes `listNotes` and `addNote`. Both take an explicit Actor through the service, and writes join an open unit of work.

Import `NotesMount` from the package main and add `{ ...NotesMount, layer: chosenNotesLayer }` to the module plan in `composition/modules.ts`. Use `Notes.layerPostgres(options)` with a `NoteTargets` host port and the shared SQL client, or `Notes.layerMemory(options)` in tests. Options name allowed target kinds and set positive body and page limits. `Notes.presets.default` supplies a 4000 UTF-16-unit body limit and 100-item page limit, but never chooses target kinds. Register `{ "workspace": "packages/notes" }` in `migrations.json`.

`NotesMount` holds the service key, operation descriptors and `bindNotes` binder. Composition calls the binder once when building Runtime. Features call the descriptors through declared edges. The browser-safe `./contract` door contains schemas, errors, permissions, `NotesOperations` and `NoteEvents`, not services or bindings.

```text
listNotes  notes:read   readOnly
addNote    notes:write  transactional
```

`addNote` and the facade's `notes.add(actor, target, body)` return `{ note, events: [NoteAdded] }`. `NoteEvents.NoteAdded` declares `{ kind: "NoteAdded", noteId, target: { kind, id }, authorId, createdAt }`. The fact uses the stored note's id, author and timestamp. `listNotes` still returns `{ notes, next? }`.

Events are plain data. The module never emits, depends on event-log or reads `CurrentActor`. A feature chooses whether to record returned facts through an explicit event-log edge; event-log supplies the actor/request/time envelope.

The app fills `NoteTargets` in composition. Unknown target kinds fail decoding before the port runs. Missing rows, denied access and missing relations all fail with `NoteTargetNotFound`. Target deletion calls `notes.removeTarget(ref)` and account deletion calls `notes.erase(authorId)` inside their deletion units. These are facade cascade hooks, not operations.

A note is write-once. No edit or remove operation exists. `createdAt` and cursor timestamps use epoch milliseconds. Lists sort oldest-first by createdAt then id, with exclusive cursors. Note bodies are plain text; rendering, including Markdown, belongs to consumers. Errors use fixed kinds. Unavailable messages hide driver details.
