export {
  Note,
  NoteCursor,
  NoteInputInvalid,
  NoteList,
  NotePage,
  NoteStoreUnavailable,
  NoteTarget,
  NoteTargetNotFound,
  NoteTargetsUnavailable,
} from "./note/note.js";
export { type NotePermission, NotePermissions } from "./note/permissions.js";
export { NotesOperations } from "./note/operations.js";
import { Note, NoteCursor, NoteList, NotePage, NoteTarget } from "./note/note.js";
export const NoteSchemas = { Note, NoteCursor, NoteList, NotePage, NoteTarget } as const;
