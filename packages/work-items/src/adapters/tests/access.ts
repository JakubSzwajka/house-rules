import { Actor, ActorId } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { WorkItemAccess } from "../../index.js";
export const a = Actor.make({ id: ActorId.make("a") });
export const b = Actor.make({ id: ActorId.make("b") });
export const reader = Actor.make({ id: ActorId.make("reader") });
export const project = (id: string) => ({ kind: "project", id });
export const access = Layer.succeed(WorkItemAccess, {
  access: (actor, ref) =>
    Effect.succeed(
      ref === null
        ? actor.id === "a"
          ? "write"
          : "none"
        : ref.id === "shared" || ref.id === actor.id
          ? "write"
          : actor.id === "reader" && ref.id === "a"
            ? "read"
            : "none",
    ),
  visibleContainers: (actor) =>
    Effect.succeed({
      containers: [project(actor.id === "reader" ? "a" : actor.id), project("shared")],
      inbox: actor.id === "a",
    }),
});
