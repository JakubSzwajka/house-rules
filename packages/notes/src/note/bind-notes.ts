import { type Binding, bindOperation } from "@house-rules/application";
import type { Actor, NoOpenUnit } from "@house-rules/domain";
import { Effect } from "effect";
import type { AddNoteResult } from "./events.js";
import {
  type NoteInputInvalid,
  type NoteList,
  type NotePage,
  type NoteStoreUnavailable,
  type NoteTarget,
  NoteTargetNotFound,
  type NoteTargetsUnavailable,
} from "./note.js";
import { NotesOperations } from "./operations.js";
type Failure =
  | NoteInputInvalid
  | NoteStoreUnavailable
  | NoteTargetsUnavailable
  | NoteTargetNotFound;
type Service = {
  readonly list: (
    actor: Actor,
    ref: NoteTarget,
    page?: NotePage,
  ) => Effect.Effect<NoteList, Failure>;
  readonly add: (
    actor: Actor,
    ref: NoteTarget,
    body: string,
  ) => Effect.Effect<AddNoteResult, Failure | NoOpenUnit>;
  readonly removeTarget: (
    ref: NoteTarget,
  ) => Effect.Effect<void, NoteInputInvalid | NoteStoreUnavailable | NoOpenUnit>;
  readonly erase: (authorId: string) => Effect.Effect<void, NoteStoreUnavailable | NoOpenUnit>;
};
export const bindNotes = (service: Service): readonly Binding[] => [
  bindOperation(NotesOperations.listNotes, ({ target, page }, { caller }) =>
    caller.kind === "person"
      ? service.list(caller.actor, target, page)
      : Effect.fail(new NoteTargetNotFound()),
  ),
  bindOperation(NotesOperations.addNote, ({ target, body }, { caller }) =>
    caller.kind === "person"
      ? service.add(caller.actor, target, body)
      : Effect.fail(new NoteTargetNotFound()),
  ),
];
