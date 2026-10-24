import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const NoteTarget = Schema.Struct({ kind: Schema.NonEmptyString, id: Schema.NonEmptyString });
export type NoteTarget = typeof NoteTarget.Type;
export const NoteCursor = Schema.Struct({ createdAt: Schema.Int, id: Schema.NonEmptyString });
export type NoteCursor = typeof NoteCursor.Type;
export const NotePage = Schema.Struct({
  size: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  cursor: Schema.optionalKey(NoteCursor),
});
export type NotePage = typeof NotePage.Type;
export const Note = Schema.Struct({
  id: Schema.NonEmptyString,
  target: NoteTarget,
  authorId: Schema.NonEmptyString,
  body: Schema.String,
  createdAt: Schema.Int,
});
export type Note = typeof Note.Type;
export const NoteList = Schema.Struct({
  notes: Schema.Array(Note),
  next: Schema.optionalKey(NoteCursor),
});
export type NoteList = typeof NoteList.Type;

export class NoteTargetNotFound extends Schema.TaggedError<NoteTargetNotFound>()(
  "NoteTargetNotFound",
  { kind: errorKind("not_found") },
) {}
export class NoteInputInvalid extends Schema.TaggedError<NoteInputInvalid>()("NoteInputInvalid", {
  kind: errorKind("invalid"),
  message: Schema.String,
}) {}
export class NoteStoreUnavailable extends Schema.TaggedError<NoteStoreUnavailable>()(
  "NoteStoreUnavailable",
  { kind: errorKind("unavailable"), cause: Schema.Defect() },
) {
  override get message(): string {
    return "Notes are unavailable. Try again shortly.";
  }
}
export class NoteTargetsUnavailable extends Schema.TaggedError<NoteTargetsUnavailable>()(
  "NoteTargetsUnavailable",
  { kind: errorKind("unavailable"), cause: Schema.Defect() },
) {
  override get message(): string {
    return "Note targets are unavailable. Try again shortly.";
  }
}
