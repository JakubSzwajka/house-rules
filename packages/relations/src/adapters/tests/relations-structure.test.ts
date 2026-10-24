import { expect, layer } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  RelationCycle,
  RelationEndpointInvalid,
  Relations,
  type RelationsOptions,
} from "../../index.js";
import { stores } from "./stores.js";

const node = (id: string, kind = "item") => ({ kind, id });
const base = {
  source: ["item", "folder"],
  target: ["item", "folder"],
  directed: true,
  acyclic: false,
  unique: true,
};
const options: RelationsOptions = {
  nodeKinds: ["item", "folder"],
  maxPageSize: 10,
  maxGraphSize: 5,
  relationTypes: [
    { ...base, name: "dag", acyclic: true },
    { ...base, name: "limited", maxOutPerSource: 1, maxInPerTarget: 1 },
  ],
};
for (const { name, layer: storage } of stores) {
  const world = Relations.layer(options).pipe(Layer.provideMerge(storage));
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Relations structure on ${name}`,
    (it) => {
      it.effect("does not count incoming edges toward the outgoing cap", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          const add = (source: string, target: string) =>
            UnitOfWork.atomic(
              service.relate({ type: "limited", source: node(source), target: node(target) }),
            );
          yield* add("out-cap-before", "out-cap-middle");
          expect(yield* add("out-cap-middle", "out-cap-after")).toMatchObject({
            source: node("out-cap-middle"),
            target: node("out-cap-after"),
          });
        }),
      );
      it.effect("does not count outgoing edges toward the incoming cap", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          const add = (source: string, target: string) =>
            UnitOfWork.atomic(
              service.relate({ type: "limited", source: node(source), target: node(target) }),
            );
          yield* add("in-cap-middle", "in-cap-after");
          expect(yield* add("in-cap-before", "in-cap-middle")).toMatchObject({
            source: node("in-cap-before"),
            target: node("in-cap-middle"),
          });
        }),
      );
      it.effect("accepts a directed diamond and rejects its back edge", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          const add = (source: string, target: string) =>
            UnitOfWork.atomic(
              service.relate({ type: "dag", source: node(source), target: node(target) }),
            );
          yield* add("diamond-a", "diamond-b");
          yield* add("diamond-a", "diamond-c");
          yield* add("diamond-b", "diamond-d");
          expect(yield* add("diamond-c", "diamond-d")).toMatchObject({
            source: node("diamond-c"),
            target: node("diamond-d"),
          });
          expect(yield* Effect.flip(add("diamond-d", "diamond-a"))).toBeInstanceOf(RelationCycle);
        }),
      );
      it.effect("removes leftover edges after their node kind is removed from config", () =>
        Effect.gen(function* () {
          const service = yield* Relations;
          const removed = node("retired", "folder");
          for (const input of [
            { type: "dag", source: removed, target: node("retired-out") },
            { type: "limited", source: node("retired-in"), target: removed },
          ])
            yield* UnitOfWork.atomic(service.relate(input));
          const reconfigured = yield* Relations.pipe(
            Effect.provide(
              Relations.layer({
                ...options,
                nodeKinds: ["item"],
                relationTypes: [{ ...base, name: "dag", source: ["item"], target: ["item"] }],
              }),
            ),
          );
          yield* UnitOfWork.atomic(reconfigured.removeNode(removed));
          yield* UnitOfWork.atomic(reconfigured.removeNode(removed));
          expect(
            (yield* service.listRelations({ node: removed, direction: "both" })).edges,
          ).toEqual([]);
          for (const ref of [node("", "folder"), node("retired", "")])
            expect(
              yield* Effect.flip(UnitOfWork.atomic(reconfigured.removeNode(ref))),
            ).toBeInstanceOf(RelationEndpointInvalid);
        }),
      );
    },
  );
}
