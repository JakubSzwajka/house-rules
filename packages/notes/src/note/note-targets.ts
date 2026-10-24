import type { Actor } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { NoteTarget, NoteTargetsUnavailable } from "./note.js";
export type NoteRelation = "owner" | "member" | "none";
export class NoteTargets extends Context.Service<
  NoteTargets,
  {
    readonly relation: (
      actor: Actor,
      ref: NoteTarget,
    ) => Effect.Effect<NoteRelation, NoteTargetsUnavailable>;
  }
>()("@house-rules/notes/NoteTargets") {}
