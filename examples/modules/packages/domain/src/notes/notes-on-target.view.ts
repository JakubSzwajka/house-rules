import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  ActedFor,
  Forbidden,
  requirePermission,
  Session,
  targetKey,
  TargetKey,
} from "@house-rules/stack";
import { Note } from "./note.aggregate.ts";
import { NoteId } from "./note.id.ts";
import { NotesPermissions } from "./permissions.ts";

export const NoteItem = Schema.Struct({
  id: NoteId,
  by: Schema.String,
  for: ActedFor,
  body: Schema.String,
  addedAt: Schema.Int,
});
export type NoteItem = typeof NoteItem.Type;

const oldestFirst = (a: NoteItem, b: NoteItem) =>
  a.addedAt - b.addedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class NotesOnTarget extends Domain.View("NotesOnTarget", {
  from: [Note],
  key: TargetKey,
  middleware: [Session],
  rejects: [Forbidden],
  state: Schema.Struct({ notes: Schema.Array(NoteItem) }),
  initial: { notes: [] },
  keyOf: { NoteAdded: ({ event }) => targetKey(event.target) },
  evolve: {
    NoteAdded: (v, e, { source, at }) => ({
      notes: [
        ...v.notes,
        { id: source.id, by: e.by, for: e.for, body: e.body, addedAt: DateTime.toEpochMillis(at) },
      ].sort(oldestFirst),
    }),
  },
  validate: () => Effect.asVoid(requirePermission(NotesPermissions.read)),
}) {}
