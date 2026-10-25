import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { NoteStore } from "../../storage.js";
import { type Note, NoteStoreUnavailable, type NoteTarget } from "../../note/note.js";
const copy = (note: Note): Note => ({ ...note, target: { ...note.target } });
const sameTarget = (note: Note, ref: NoteTarget) =>
  note.target.kind === ref.kind && note.target.id === ref.id;
export const memoryNoteStore = (): Layer.Layer<NoteStore> =>
  Layer.sync(NoteStore, () => {
    const rows = new Map<string, Note>();
    const change = Effect.fn("NoteStore.memory.change")(function* (run: () => void) {
      yield* UnitOfWork.required;
      const before = new Map([...rows].map(([id, note]) => [id, copy(note)]));
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          rows.clear();
          for (const [id, note] of before) rows.set(id, note);
        }),
      );
      run();
    });
    return NoteStore.of({
      list: (ref, page) =>
        Effect.sync(() =>
          [...rows.values()]
            .filter(
              (note) =>
                sameTarget(note, ref) &&
                (page.after === undefined ||
                  note.createdAt > page.after.createdAt ||
                  (note.createdAt === page.after.createdAt && note.id > page.after.id)),
            )
            .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id === b.id ? 0 : 1))
            .slice(0, page.size)
            .map(copy),
        ),
      insert: Effect.fn("NoteStore.memory.insert")(function* (note: Note) {
        yield* UnitOfWork.required;
        if (rows.has(note.id))
          return yield* new NoteStoreUnavailable({ cause: "Duplicate note id." });
        yield* change(() => void rows.set(note.id, copy(note)));
      }),
      removeTarget: (ref) =>
        change(() => {
          for (const [id, note] of rows) if (sameTarget(note, ref)) rows.delete(id);
        }),
      erase: (authorId) =>
        change(() => {
          for (const [id, note] of rows) if (note.authorId === authorId) rows.delete(id);
        }),
    });
  });
