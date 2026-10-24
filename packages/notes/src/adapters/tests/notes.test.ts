import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { NoteEvents, NotesOperations } from "../../contract.js";
import { Notes, NoteTargets } from "../../index.js";
import { stores } from "./stores.js";

const actor = Actor.make({ id: ActorId.make("note-author") });
const targets = Layer.succeed(NoteTargets, { relation: () => Effect.succeed("member") });
for (const { name, layer: storage } of stores) {
  const world = Notes.layer({ targets: ["booking"], maxBodyLength: 100, maxPageSize: 10 }).pipe(
    Layer.provide(targets),
    Layer.provideMerge(storage),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Notes events on ${name}`,
    (it) => {
      it.effect("returns the stored note's fact as plain data without an envelope", () =>
        Effect.gen(function* () {
          const notes = yield* Notes;
          const target = { kind: "booking", id: "events" };
          const result = yield* UnitOfWork.atomic(notes.add(actor, target, "plain text"));
          expect(result.note).toMatchObject({ target, authorId: actor.id, body: "plain text" });
          const fact = {
            kind: "NoteAdded" as const,
            noteId: result.note.id,
            target,
            authorId: actor.id,
            createdAt: result.note.createdAt,
          };
          expect(result.events).toEqual([fact]);
          expect(yield* Schema.decodeEffect(NoteEvents.NoteAdded)(fact)).toEqual(fact);
          expect(yield* Schema.decodeEffect(NotesOperations.addNote.output)(result)).toEqual(
            result,
          );
          expect(yield* notes.list(actor, target)).toEqual({ notes: [result.note] });
          Object.assign(result.events[0]?.target ?? {}, { id: "changed" });
          expect(yield* notes.list(actor, target)).toEqual({ notes: [result.note] });
        }),
      );
    },
  );
}
