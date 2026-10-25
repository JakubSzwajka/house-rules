import type { MountDefinition } from "@house-rules/application";
import { Notes } from "./facade.js";
import { NotesOperations } from "./contract.js";
import { bindNotes } from "./note/bind-notes.js";
export const NotesMount = {
  map: { name: "notes", kind: "package", package: "@house-rules/notes" },
  service: Notes,
  operations: Object.values(NotesOperations),
  bind: bindNotes,
} satisfies MountDefinition<Notes, Notes["Service"]>;
export { bindNotes } from "./note/bind-notes.js";
export { Notes, type NoteFailure } from "./facade.js";
export { NoteStore } from "./storage.js";
export { NoteTargets, type NoteRelation } from "./note/note-targets.js";
export { NotesOptions } from "./note/options.js";
export { notePolicy } from "./note/policy.js";
export { memoryNoteStore } from "./adapters/memory/note.js";
export { postgresNoteStore } from "./adapters/postgres/note.js";
export {
  AddNoteResult,
  NoteEvents,
  NotesOperations,
  NoteSchemas,
  Note,
  NoteCursor,
  NoteInputInvalid,
  NoteList,
  NotePage,
  type NotePermission,
  NotePermissions,
  NoteStoreUnavailable,
  NoteTarget,
  NoteTargetNotFound,
  NoteTargetsUnavailable,
} from "./contract.js";
