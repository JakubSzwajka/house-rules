import { Effect, Exit, type Cause } from "effect";
import type { RegistrySnapshot, RegistryWay } from "../registry/registry.ts";
import { type Composition, resolvedMounts, serveIn } from "./composition.ts";
import { CompositionClosed } from "./composition-closed.ts";

export const registry = <A, E>(
  app: Composition<A, E>,
): Effect.Effect<RegistrySnapshot, E | CompositionClosed> =>
  serveIn<A, Exit.Exit<RegistrySnapshot, E | CompositionClosed>>(app, {
    ready: () =>
      Effect.succeed(
        Exit.succeed({
          mounts: (resolvedMounts.get(app) ?? []).map((mount) => ({
            service: mount.service.key,
            operations: mount.operations,
          })),
          features: app.features,
          ways: app.ways.map(
            (way): RegistryWay => ({
              name: way.name,
              ...(way.protocol === "hook"
                ? { protocol: way.protocol, slot: way.slot.key }
                : way.protocol === "schedule"
                  ? { protocol: way.protocol, clock: way.clock }
                  : { protocol: way.protocol, path: way.path }),
              features: way.features,
            }),
          ),
        }),
      ),
    failed: (cause) => Effect.succeed(Exit.failCause(cause as Cause.Cause<E>)),
    closed: Effect.succeed(Exit.fail(new CompositionClosed())),
  }).pipe(
    Effect.flatMap((exit) =>
      Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause),
    ),
  );
