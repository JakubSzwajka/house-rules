import { Schema } from "effect";
export const NotesOptions = Schema.Struct({
  targets: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  maxBodyLength: Schema.Int.check(Schema.isGreaterThan(0)),
  maxPageSize: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type NotesOptions = typeof NotesOptions.Type;
