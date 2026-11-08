import { Note } from "./note.aggregate.ts";
import { NotesOnTarget } from "./notes-on-target.view.ts";

export {
  AddNote,
  MAX_NOTE_LENGTH,
  NoteAdded,
  NoteExists,
  NoteTooLong,
} from "./add-note.command.ts";
export { Note, NoteState } from "./note.aggregate.ts";
export { NoteId } from "./note.id.ts";
export { NoteItem, NotesOnTarget } from "./notes-on-target.view.ts";
export { NotesPermissions } from "./permissions.ts";

export const aggregates = [Note] as const;
export const views = [NotesOnTarget] as const;
