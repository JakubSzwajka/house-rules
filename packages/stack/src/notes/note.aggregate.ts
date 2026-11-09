import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { requirePermission } from "../access/require-permission.ts";
import { attributionOf } from "../actor/actor.ts";
import {
  AddNote,
  MAX_NOTE_LENGTH,
  NoteAdded,
  NoteExists,
  NoteTooLong,
} from "./add-note.command.ts";
import { NoteId } from "./note.id.ts";
import { NotesPermissions } from "./permissions.ts";
import { Target } from "../target/target.ts";

export const NoteState = Schema.Union([
  Schema.TaggedStruct("None", {}),
  Schema.TaggedStruct("Added", { target: Target, by: Schema.String, body: Schema.String }),
]);
export type NoteState = typeof NoteState.Type;

export class Note extends Domain.Aggregate("Note", {
  id: NoteId,
  state: NoteState,
  initial: { _tag: "None" },
  commands: [AddNote],
  decide: {
    AddNote: Effect.fn(function* (s, cmd) {
      const actor = yield* requirePermission(NotesPermissions.write);
      if (s._tag !== "None") return yield* new NoteExists();
      if (cmd.body.length > MAX_NOTE_LENGTH)
        return yield* new NoteTooLong({ max: MAX_NOTE_LENGTH, length: cmd.body.length });
      return [new NoteAdded({ target: cmd.target, ...attributionOf(actor), body: cmd.body })];
    }),
  },
  evolve: {
    NoteAdded: (_, e) => ({ _tag: "Added" as const, target: e.target, by: e.by, body: e.body }),
  },
}) {}
