import { Schema } from "effect";
import { Note, NoteTarget } from "./note.js";

export const NoteEvents = {
  NoteAdded: Schema.Struct({
    kind: Schema.Literal("NoteAdded"),
    noteId: Schema.NonEmptyString,
    target: NoteTarget,
    authorId: Schema.NonEmptyString,
    createdAt: Schema.Int,
  }),
} as const;
export const AddNoteResult = Schema.Struct({
  note: Note,
  events: Schema.Array(NoteEvents.NoteAdded),
});
export type AddNoteResult = typeof AddNoteResult.Type;
