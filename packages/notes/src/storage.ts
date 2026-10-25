import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { Note, NoteCursor, NoteStoreUnavailable, NoteTarget } from "./note/note.js";
export class NoteStore extends Context.Service<
  NoteStore,
  {
    readonly list: (
      ref: NoteTarget,
      page: { readonly size: number; readonly after?: NoteCursor },
    ) => Effect.Effect<ReadonlyArray<Note>, NoteStoreUnavailable>;
    readonly insert: (note: Note) => Effect.Effect<void, NoteStoreUnavailable | NoOpenUnit>;
    readonly removeTarget: (
      ref: NoteTarget,
    ) => Effect.Effect<void, NoteStoreUnavailable | NoOpenUnit>;
    readonly erase: (authorId: string) => Effect.Effect<void, NoteStoreUnavailable | NoOpenUnit>;
  }
>()("@house-rules/notes/NoteStore") {}
