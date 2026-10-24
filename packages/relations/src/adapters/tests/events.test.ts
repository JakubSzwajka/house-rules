import { expect, layer } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { RelationEvents, RelationsOperations } from "../../contract.js";
import { Relations } from "../../index.js";
import { stores } from "./stores.js";

const node = (id: string) => ({ kind: "item", id });
for (const { name, layer: storage } of stores) {
  const world = Relations.layer({
    nodeKinds: ["item"],
    maxPageSize: 10,
    maxGraphSize: 10,
    relationTypes: [
      {
        name: "link",
        source: ["item"],
        target: ["item"],
        directed: false,
        acyclic: false,
        unique: true,
      },
    ],
  }).pipe(Layer.provideMerge(storage));
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Relation events on ${name}`,
    (it) => {
      it.effect("returns stored endpoint facts on relate and unrelate, without an envelope", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          const result = yield* UnitOfWork.atomic(
            service.relate({
              type: "link",
              source: node("z"),
              target: node("a"),
            }),
          );
          const endpoints = { type: "link", source: node("a"), target: node("z") };
          const related = { kind: "Related" as const, ...endpoints };
          expect(result.relation).toMatchObject(endpoints);
          expect(result.events).toEqual([related]);
          expect(yield* Schema.decodeEffect(RelationEvents.Related)(related)).toEqual(related);
          expect(yield* Schema.decodeEffect(RelationsOperations.relate.output)(result)).toEqual(
            result,
          );
          expect(yield* service.listRelations({ node: node("a"), direction: "both" })).toEqual({
            edges: [result.relation],
          });
          Object.assign(result.events[0]?.source ?? {}, { id: "changed" });
          const removed = yield* UnitOfWork.atomic(service.unrelate(result.relation.id));
          const unrelated = { kind: "Unrelated" as const, ...endpoints };
          expect(removed).toEqual({ events: [unrelated] });
          expect(yield* Schema.decodeEffect(RelationEvents.Unrelated)(unrelated)).toEqual(
            unrelated,
          );
          expect(yield* Schema.decodeEffect(RelationsOperations.unrelate.output)(removed)).toEqual(
            removed,
          );
          expect(yield* service.listRelations({ node: node("a"), direction: "both" })).toEqual({
            edges: [],
          });
          yield* UnitOfWork.atomic(
            service.relate({ type: "link", source: node("a"), target: node("z") }),
          );
          expect(yield* UnitOfWork.atomic(service.removeNode(node("a")))).toBeUndefined();
        }),
      );
    },
  );
}
