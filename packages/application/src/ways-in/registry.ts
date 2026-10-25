import { mapRegistry } from "../registry/app-map.ts";
import { Effect, Exit, type Cause } from "effect";
import type { RegistrySnapshot, RegistryWay } from "../registry/registry.ts";
import { type Composition, resolvedMounts, resolvedPlugs, serveIn } from "./composition.ts";
import { Mean } from "../socket/mean.ts";
import { CompositionClosed } from "./composition-closed.ts";
import { GraphInvalid } from "../runtime/graph-invalid.ts";
import { mergePlugs } from "../registry/plugs.ts";

export const appMap = <A, E>(app: Composition<A, E>) =>
  registry(app).pipe(
    Effect.flatMap((data) => {
      // Declared plugs are review facts; fail closed on ones that name no real way or slot.
      const issue = mergePlugs(data.ways, data.plugs ?? []).issues[0];
      return issue === undefined
        ? Effect.succeed(mapRegistry(data))
        : Effect.fail(new GraphInvalid({ reason: `${issue.path}: ${issue.reason}` }));
    }),
  );

const registry = <A, E>(
  app: Composition<A, E>,
): Effect.Effect<RegistrySnapshot, E | CompositionClosed> =>
  serveIn<A, Exit.Exit<RegistrySnapshot, E | CompositionClosed>>(app, {
    ready: () =>
      Effect.succeed(
        Exit.succeed({
          mounts: (resolvedMounts.get(app) ?? []).map((mount) => ({
            service: mount.service.key,
            ...(mount.map === undefined ? {} : { map: mount.map }),
            operations: mount.operations,
          })),
          features: app.features,
          plugs: resolvedPlugs.get(app) ?? [],
          ways: app.ways.map(
            (way): RegistryWay => ({
              name: way.name,
              ...(way.mean === Mean.allow
                ? { mean: "allow" }
                : way.mean === Mean.no
                  ? { mean: "no" }
                  : way.mean === Mean.elicitation
                    ? { mean: "elicitation" }
                    : {}),
              ...(way.protocol === "hook"
                ? { protocol: way.protocol, slot: way.slot.key }
                : way.protocol === "schedule"
                  ? { protocol: way.protocol, clock: way.clock }
                  : way.protocol === "event"
                    ? { protocol: way.protocol, on: way.on }
                    : { protocol: way.protocol, path: way.path }),
              features: way.features,
              ...(way.protocol === "http" ? { public: way.public } : {}),
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
