import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  CurrentActor,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId, memoryUnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  bindNotes,
  NoteTargetNotFound,
  NoteTargets,
  Notes,
  NotesMount,
  NotesOperations,
} from "../index.js";

expectTypeOf<Parameters<typeof bindNotes>[0]>().toExtend<Notes["Service"]>();
expectTypeOf<Notes["Service"]>().toExtend<Parameters<typeof bindNotes>[0]>();

const actor = Actor.make({ id: ActorId.make("owner") });
const { listNotes, addNote } = NotesOperations;
const list = defineFeature("test_listNotes", {
  ...listNotes,
  permission: null,
  flags: { readOnly: listNotes.readOnly },
  edges: [listNotes],
  handler: (input, { call }) => call(listNotes, input),
});
const system = defineFeature("test_systemListNotes", {
  ...listNotes,
  permission: null,
  flags: { readOnly: listNotes.readOnly },
  edges: [listNotes],
  start: { kind: "system", reason: "test", startedBy: "hook:test" },
  handler: (input, { call }) => call(listNotes, input),
});
const add = defineFeature("test_addNote", {
  ...addNote,
  permission: null,
  flags: { readOnly: addNote.readOnly },
  edges: [addNote],
  handler: (input, { call }) => call(addNote, input),
});
const features = [list, system, add];
const permissions = ["notes:read", "notes:write"] as const;
const targets = Layer.succeed(NoteTargets, {
  relation: () => Effect.succeed("owner"),
});
const module = Notes.layerMemory({
  targets: ["booking"],
  maxBodyLength: 100,
  maxPageSize: 250,
}).pipe(Layer.provide(targets));
const world = Layer.unwrap(
  Effect.gen(function* () {
    return Runtime.layer({ mounts: [NotesMount], features, ways: [] });
  }),
).pipe(
  Layer.provideMerge(module),
  Layer.provideMerge(memoryUnitOfWork),
  Layer.provideMerge(StepTrace.layer()),
);
const caller = Layer.merge(
  Layer.succeed(CurrentActor, actor),
  Layer.succeedContext(
    May.context(May.fixed(permissions), { features, system: permissions, via: "test" }),
  ),
);

it.layer(world)("Notes operation bindings", (test) => {
  test.effect("NotesMount binds operations through Runtime.layer", () =>
    Effect.gen(function* () {
      expect(NotesMount.service).toBe(Notes);
      expect(NotesMount.operations).toEqual(Object.values(NotesOperations));
      expect(NotesMount.bind).toBe(bindNotes);
      expect(
        yield* runFeature(list, { target: { kind: "booking", id: "page" } }).pipe(
          Effect.provide(caller),
        ),
      ).toEqual({ notes: [] });
    }),
  );
  test.effect("uses configured page size when the operation omits a page", () =>
    Effect.gen(function* () {
      const target = { kind: "booking", id: "page-size" };
      for (const body of ["one", "two", "three"]) {
        yield* runFeature(add, { target, body }).pipe(Effect.provide(caller));
      }
      expect((yield* runFeature(list, { target }).pipe(Effect.provide(caller))).notes).toHaveLength(
        3,
      );
    }),
  );
  test.effect("system callers cannot access target notes", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(
          runFeature(system, { target: { kind: "booking", id: "hidden" } }).pipe(
            Effect.provide(caller),
          ),
        ),
      ).toBeInstanceOf(NoteTargetNotFound);
    }),
  );
});
