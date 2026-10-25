import { type Actor, UnitOfWork } from "@house-rules/domain";
import { DateTime, Effect, Random, Schema } from "effect";
import type { NoteStore } from "../storage.js";
import type { AddNoteResult } from "./events.js";
import type { NoteTargets } from "./note-targets.js";
import { type Note, NoteInputInvalid, NotePage, NoteTarget, NoteTargetNotFound } from "./note.js";
import type { NotesOptions } from "./options.js";
import { NotePermissions } from "./permissions.js";
import { notePolicy } from "./policy.js";

export const makeNotes = (
  store: NoteStore["Service"],
  targets: NoteTargets["Service"],
  options: NotesOptions,
) => {
  const decodeTarget = Schema.decodeEffect(
    Schema.Struct({ kind: Schema.Literals(options.targets), id: NoteTarget.fields.id }),
  );
  const decodeBody = Schema.decodeEffect(
    Schema.String.check(Schema.isMaxLength(options.maxBodyLength)),
  );
  const invalid = () => new NoteInputInvalid({ message: "Invalid note input." });
  const requireRelation = Effect.fn("Notes.requireRelation")(function* (
    actor: Actor,
    ref: NoteTarget,
  ) {
    const target = yield* decodeTarget(ref).pipe(Effect.mapError(invalid));
    const relation = yield* targets.relation(actor, target);
    if (!notePolicy.allows(relation, NotePermissions.read)) return yield* new NoteTargetNotFound();
  });
  return {
    list: Effect.fn("Notes.list")(function* (actor: Actor, ref: NoteTarget, page?: NotePage) {
      yield* requireRelation(actor, ref);
      const decoded = yield* Schema.decodeEffect(NotePage)(page ?? {}).pipe(
        Effect.mapError(invalid),
      );
      const size = Math.min(decoded.size ?? options.maxPageSize, options.maxPageSize);
      const rows = yield* store.list(ref, {
        size: size + 1,
        ...(decoded.cursor === undefined ? {} : { after: decoded.cursor }),
      });
      const items = rows.slice(0, size);
      const last = items[items.length - 1];
      return rows.length > size && last !== undefined
        ? { notes: items, next: { createdAt: last.createdAt, id: last.id } }
        : { notes: items };
    }),
    add: Effect.fn("Notes.add")(function* (actor: Actor, ref: NoteTarget, body: string) {
      yield* UnitOfWork.required;
      yield* requireRelation(actor, ref);
      const decoded = yield* decodeBody(body).pipe(Effect.mapError(invalid));
      const note: Note = {
        id: yield* Effect.all(
          Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0xffff_ffff)),
        ).pipe(
          Effect.map((words) => words.map((word) => word.toString(16).padStart(8, "0")).join("")),
        ),
        target: { ...ref },
        authorId: actor.id,
        body: decoded,
        createdAt: DateTime.toEpochMillis(yield* DateTime.now),
      };
      yield* store.insert(note);
      return {
        note,
        events: [
          {
            kind: "NoteAdded",
            noteId: note.id,
            target: { ...note.target },
            authorId: note.authorId,
            createdAt: note.createdAt,
          },
        ],
      } satisfies AddNoteResult;
    }),
    removeTarget: Effect.fn("Notes.removeTarget")(function* (ref: NoteTarget) {
      yield* UnitOfWork.required;
      const target = yield* decodeTarget(ref).pipe(Effect.mapError(invalid));
      yield* store.removeTarget(target);
    }),
    erase: Effect.fn("Notes.erase")(function* (authorId: string) {
      yield* UnitOfWork.required;
      yield* store.erase(authorId);
    }),
  };
};
