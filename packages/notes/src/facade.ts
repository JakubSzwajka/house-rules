import { type Actor, defineModule, type NoOpenUnit } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { memoryNoteStore } from "./adapters/memory/note.js";
import { postgresNoteStore } from "./adapters/postgres/note.js";
import { NoteTargets } from "./note/note-targets.js";
import {
  type Note,
  NoteInputInvalid,
  type NoteList,
  type NotePage,
  type NoteStoreUnavailable,
  type NoteTarget,
  type NoteTargetNotFound,
  type NoteTargetsUnavailable,
} from "./note/note.js";
import { makeNotes } from "./note/notes.js";
import { NotesOptions } from "./note/options.js";
import { NoteStore } from "./storage.js";
export type NoteFailure =
  | NoteInputInvalid
  | NoteStoreUnavailable
  | NoteTargetsUnavailable
  | NoteTargetNotFound;
export class Notes extends defineModule<
  Notes,
  {
    readonly list: (
      actor: Actor,
      ref: NoteTarget,
      page?: NotePage,
    ) => Effect.Effect<NoteList, NoteFailure>;
    readonly add: (
      actor: Actor,
      ref: NoteTarget,
      body: string,
    ) => Effect.Effect<Note, NoteFailure | NoOpenUnit>;
    readonly removeTarget: (
      ref: NoteTarget,
    ) => Effect.Effect<void, NoteInputInvalid | NoteStoreUnavailable | NoOpenUnit>;
    readonly erase: (authorId: string) => Effect.Effect<void, NoteStoreUnavailable | NoOpenUnit>;
  }
>()("notes", {
  make: (options: NotesOptions) =>
    Effect.gen(function* notesLayer() {
      const settings = yield* Schema.decodeEffect(NotesOptions)(options).pipe(
        Effect.mapError(() => new NoteInputInvalid({ message: "Invalid notes options." })),
      );
      const store = yield* NoteStore;
      const targets = yield* NoteTargets;
      return makeNotes(store, targets, settings);
    }),
}) {
  static readonly presets = { default: { maxBodyLength: 4000, maxPageSize: 100 } } as const;
  static readonly layerMemory = (options: NotesOptions) =>
    this.layer(options).pipe(Layer.provide(memoryNoteStore()));
  static readonly layerPostgres = (options: NotesOptions) =>
    this.layer(options).pipe(Layer.provide(postgresNoteStore));
}
