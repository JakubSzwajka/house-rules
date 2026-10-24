# @house-rules/notes: notes for agents

Notes owns immutable, flat plain-text records attached to host-owned targets. Read `README.md` for mounting and options.

## Mount and bind

1. Fill the required `NoteTargets` port in composition. Map host failures to `NoteTargetsUnavailable`; missing, denied and absent targets all fail as `NoteTargetNotFound`.
2. Add `{ ...NotesMount, layer: chosenNotesLayer }` to the module plan. Use `Notes.layerPostgres(options)` with the host port and shared SQL client, or `Notes.layerMemory(options)` in tests. Raw `Notes.layer(options)` also needs `NoteStore`.
3. Register `{ "workspace": "packages/notes" }` in `migrations.json`.
4. Composition captures `Notes` and calls `bindNotes` once to build Runtime. Features call `NotesOperations` through declared edges.
5. Call `notes.removeTarget(ref)` and `notes.erase(authorId)` inside target/account deletion units. These are cascade hooks, not operations.

All options are required. `targets` names allowed target kinds. `maxBodyLength` and `maxPageSize` are positive integers. `Notes.presets.default` supplies 4000 UTF-16 units and 100 items, never target kinds. Lists are oldest-first by createdAt then id; cursors are exclusive epoch milliseconds plus id. There are only list and add operations. Notes have no edit or delete operation.

Writes require an open unit. Memory storage registers rollback undo before changes; Postgres joins the open transaction. The module never opens units. The body stays plain text; rendering is a consumer choice. Error kinds are fixed, and unavailable messages do not expose causes.
