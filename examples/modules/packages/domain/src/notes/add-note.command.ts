import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor, Forbidden, Session, Target } from "@house-rules/stack";
import { NoteId } from "./note.id.ts";

export const MAX_NOTE_LENGTH = 4000;

export class NoteTooLong extends Domain.Rejection("NoteTooLong", {
  max: Schema.Int,
  length: Schema.Int,
}) {}

export class NoteExists extends Domain.Rejection("NoteExists", {}, { httpApiStatus: 409 }) {}

export class NoteAdded extends Domain.Event("NoteAdded", {
  target: Target,
  by: Schema.String,
  for: ActedFor,
  body: Schema.String,
}) {}

export class AddNote extends Domain.Command("AddNote", {
  target: NoteId,
  middleware: [Session],
  input: { target: Target, body: Schema.String },
  events: [NoteAdded],
  rejects: [Forbidden, NoteTooLong, NoteExists],
}) {}
