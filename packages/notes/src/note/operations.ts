import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { AddNoteResult } from "./events.js";
import {
  NoteInputInvalid,
  NoteList,
  NotePage,
  NoteStoreUnavailable,
  NoteTarget,
  NoteTargetNotFound,
  NoteTargetsUnavailable,
} from "./note.js";
import { NotePermissions } from "./permissions.js";
const failure = Schema.Union([
  NoteInputInvalid,
  NoteTargetNotFound,
  NoteStoreUnavailable,
  NoteTargetsUnavailable,
]);
const listNotes = defineOperation("Notes.listNotes", {
  description: "List notes on one target, oldest first.",
  input: Schema.Struct({ target: NoteTarget, page: Schema.optionalKey(NotePage) }),
  output: NoteList,
  failure,
  permission: NotePermissions.read,
  edges: [],
  readOnly: true,
});
const addNote = defineOperation("Notes.addNote", {
  description: "Append a plain-text note to one target.",
  input: Schema.Struct({ target: NoteTarget, body: Schema.String }),
  output: AddNoteResult,
  failure,
  permission: NotePermissions.write,
  edges: [],
  transactional: true,
});
export const NotesOperations = { listNotes, addNote } as const;
