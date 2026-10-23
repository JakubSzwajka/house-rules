import { Cause, Context, Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect";
import type { Permission, UnitOfWork } from "@house-rules/domain";
import type { AnyFeature } from "../feature/feature.ts";
import type { FeatureRequirements } from "../execution/run-feature.ts";
import type { CurrentActor } from "../actor/current-actor.ts";
import type { CallPermissions } from "../socket/permission-lists.ts";
import { type MaySocket, normalizeMay } from "../socket/may.ts";
import type { MayUnavailable } from "../socket/may-unavailable.ts";
import type { Approval } from "../gates/approval.ts";
import { Runtime, validateExposures } from "../runtime/runtime.ts";
import {
  type Mounts,
  type ModulePlan,
  type MissingMountServices,
  type CheckedMounts,
  planLayer,
  validateMounts,
} from "../runtime/mount.ts";
import { PermissionCatalogue } from "../registry/catalogue.ts";
import { ResolvedMay } from "../socket/resolved-may.ts";
import { GraphInvalid } from "../runtime/graph-invalid.ts";
import type { ServicesCheck } from "./mount-check.ts";
import {
  validateWays,
  type AnyWay,
  type HookServices,
  type WhoServices,
} from "./way-validation.ts";
import { systemWays } from "./system-ways.ts";

export type Composition<A, E = never> = Readonly<{
  _tag: "Composition";
  runtime: ManagedRuntime.ManagedRuntime<A, E>;
  features: readonly AnyFeature[];
  ways: readonly AnyWay<A>[];
  may: Effect.Effect<MaySocket<MayUnavailable>, never, A>;
  system: readonly Permission[];
  dispose: () => Promise<void>;
}>;

type BuildError = NonNullable<unknown> | null | undefined;

type AnyRuntime = ManagedRuntime.ManagedRuntime<never, BuildError>;

type Lifecycle = Readonly<{
  closed: () => boolean;
  runtime: () => AnyRuntime;
  peek: () => AnyRuntime;
  start: <X>(runtime: AnyRuntime, effect: Effect.Effect<X>) => Fiber.Fiber<X> | undefined;
}>;

const lifecycles = new WeakMap<object, Lifecycle>();

type SystemRequirements<W> = W extends { protocol: "hook" | "schedule" } ? UnitOfWork : never;
type Outputs<M extends Mounts, A> = A | Layer.Success<M[number]["layer"]>;
type Errors<M extends Mounts, E> = E | Layer.Error<M[number]["layer"]> | GraphInvalid;

export const composition = <
  const M extends Mounts,
  A,
  E,
  R,
  MayError,
  const Features extends readonly AnyFeature[],
  const Ways extends readonly AnyWay<R>[],
>(
  options: Readonly<{
    modules: ModulePlan<M, A, E, PermissionCatalogue> & { readonly mounts: CheckedMounts<M> };
    features: Features;
    ways: Ways;
    may: Effect.Effect<MaySocket<MayError>, never, NoInfer<Outputs<M, A>>>;
    system: readonly Permission[];
  }> &
    ServicesCheck<
      | Exclude<
          FeatureRequirements<Features[number]>,
          CurrentActor | CallPermissions | Approval | Runtime
        >
      | WhoServices<Ways[number]>
      | SystemRequirements<Ways[number]>,
      Outputs<M, A> | HookServices<Ways[number]>
    > &
    ServicesCheck<Exclude<Layer.Services<M[number]["layer"]>, PermissionCatalogue>, A> &
    ([MissingMountServices<M>] extends [never]
      ? unknown
      : { readonly mountLayerMissingServices: MissingMountServices<M> }),
): Composition<
  Outputs<M, A> | HookServices<Ways[number]> | Runtime | ResolvedMay,
  Errors<M, E>
> => {
  const modules = planLayer<M, A, E, PermissionCatalogue>(options.modules);
  const linked = Runtime.layer<M>({
    mounts: options.modules.mounts,
    features: options.features,
    ways: options.ways,
  }).pipe(Layer.provideMerge(modules));
  const validated = linked.pipe(
    Layer.tap(() =>
      Effect.gen(function* () {
        const invalid =
          validateMounts(options.modules.mounts) ?? validateWays(options.features, options.ways);
        if (invalid !== undefined) return yield* new GraphInvalid({ reason: invalid });
      }),
    ),
  );
  const withMay = Layer.effect(ResolvedMay, options.may.pipe(Effect.map(normalizeMay))).pipe(
    Layer.provideMerge(validated),
  );
  const layer = systemWays(options.ways, options.system).pipe(
    Layer.provideMerge(withMay),
  ) as unknown as Layer.Layer<
    Outputs<M, A> | HookServices<Ways[number]> | Runtime | ResolvedMay,
    Errors<M, E>
  >;
  const app = compositionFromLayer({ ...options, layer });
  resolvedMounts.set(app, options.modules.mounts);
  return app;
};

export const resolvedMounts = new WeakMap<object, Mounts>();

const compositionFromLayer = <A, E>(
  options: Readonly<{
    layer: Layer.Layer<A, E>;
    features: readonly AnyFeature[];
    ways: readonly AnyWay<any>[];
    system: readonly Permission[];
  }>,
): Composition<A, E | GraphInvalid> => {
  let closed = false;
  let generation = 0;
  let failed = false;
  const retired: Array<Promise<void>> = [];
  const inflight = new Set<Fiber.Fiber<unknown, unknown>>();
  const fresh = (): ManagedRuntime.ManagedRuntime<A, E | GraphInvalid> => {
    generation += 1;
    const mine = generation;
    const layer = options.layer.pipe(
      Layer.tap((context) =>
        Effect.gen(function* () {
          const runtime = Context.get(context as Context.Context<Runtime>, Runtime);
          const invalid =
            validateWays(options.features, options.ways) ??
            validateExposures(runtime, options.features, options.ways);
          if (invalid !== undefined) return yield* new GraphInvalid({ reason: invalid });
        }),
      ),
      Layer.tapCause(() =>
        Effect.sync(() => {
          if (generation === mine) failed = true;
        }),
      ),
    );
    return ManagedRuntime.make(layer);
  };
  // One runtime builds the layer once, on first use, so every adapter shares its pools.
  let current = fresh();
  const runtime = (): ManagedRuntime.ManagedRuntime<A, E | GraphInvalid> => {
    if (failed && !closed) {
      // A failed build is not kept: the next use builds again, so a database that comes back is found.
      failed = false;
      const stale = current;
      current = fresh();
      retired.push(stale.dispose().catch(() => undefined));
    }
    return current;
  };
  let disposing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (disposing === undefined) {
      // Closed first and for good: no request starts and no build begins after this line.
      closed = true;
      const running = [...inflight];
      // Requests stop before the layer's resources close, so none of them runs on a closed pool.
      disposing = Effect.runPromise(Fiber.interruptAll(running))
        .then(() => Promise.all([current.dispose(), ...retired]))
        .then(() => undefined);
    }
    return disposing;
  };
  const app: Composition<A, E | GraphInvalid> = {
    _tag: "Composition",
    get runtime() {
      return runtime();
    },
    features: options.features,
    ways: options.ways as unknown as readonly AnyWay<A>[],
    may: ResolvedMay as unknown as Effect.Effect<MaySocket<MayUnavailable>, never, A>,
    system: options.system,
    dispose,
  };
  lifecycles.set(app, {
    closed: () => closed,
    runtime: () => runtime() as unknown as AnyRuntime,
    peek: () => current as unknown as AnyRuntime,
    start: <X>(built: AnyRuntime, effect: Effect.Effect<X>): Fiber.Fiber<X> | undefined => {
      if (closed) return undefined;
      // The effect runs on the built context, so the runtime's own build error cannot reach it.
      const fiber = built.runFork(effect) as Fiber.Fiber<X>;
      inflight.add(fiber);
      fiber.addObserver(() => inflight.delete(fiber));
      return fiber;
    },
  });
  return app;
};

export type AnyComposition = Readonly<{ runtime: AnyRuntime }>;

const lifecycleOf = (app: AnyComposition): Lifecycle =>
  lifecycles.get(app) ?? {
    // A Composition built by hand has no lifecycle: it runs on its runtime and is never closed here.
    closed: () => false,
    runtime: () => app.runtime,
    peek: () => app.runtime,
    start: <X>(built: AnyRuntime, effect: Effect.Effect<X>) =>
      built.runFork(effect) as Fiber.Fiber<X>,
  };

export type Served<A, X> = Readonly<{
  ready: (context: Context.Context<A>) => Effect.Effect<X>;
  failed: (cause: Cause.Cause<BuildError>) => Effect.Effect<X>;
  closed: Effect.Effect<X>;
}>;

export const serveIn = <A, X>(app: AnyComposition, served: Served<A, X>): Effect.Effect<X> =>
  Effect.gen(function* serveInApp() {
    const life = lifecycleOf(app);
    if (life.closed()) return yield* served.closed;
    const runtime = life.runtime();
    // The build runs outside the app's scope, so a layer that fails still gets an answer.
    const built = yield* Effect.exit(runtime.contextEffect);
    if (life.closed()) return yield* served.closed;
    if (Exit.isFailure(built)) return yield* served.failed(built.cause);
    const context = built.value as Context.Context<A>;
    const outer = yield* Effect.context<never>();
    // The request is a fiber of the app runtime, so dispose interrupts it; the app's services win over the adapter's.
    const fiber = life.start(
      runtime,
      Effect.suspend(() => served.ready(context)).pipe(
        Effect.provideContext(Context.merge(outer, context)),
      ),
    );
    if (fiber === undefined) return yield* served.closed;
    const exit = yield* Fiber.await(fiber).pipe(Effect.onInterrupt(() => Fiber.interrupt(fiber)));
    if (Exit.isSuccess(exit)) return exit.value;
    if (life.closed() && Cause.hasInterruptsOnly(exit.cause)) return yield* served.closed;
    return yield* Effect.failCause(exit.cause);
  });

export const builtContext = (app: AnyComposition): Context.Context<never> | undefined =>
  // Read without building, so logging a defect never starts a layer build.
  lifecycleOf(app).closed() ? undefined : lifecycleOf(app).peek().cachedContext;

export const once = <T>(key: string, make: () => T): T => {
  const slot = Symbol.for(`@house-rules/application/once/${key}`);
  const store = globalThis as unknown as Record<symbol, { value: T } | undefined>;
  // The slot lives on globalThis so a module reload, such as Next dev, finds the first value.
  const held = store[slot] ?? { value: make() };
  store[slot] = held;
  return held.value;
};
