import { Cause, Context, Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect";
import type { Caller } from "./caller.ts";
import type { ViewsCheck, ViewTable } from "./views.ts";

export type Composition<A, C, Views extends ViewTable<C> = ViewTable<C>, E = never> = Readonly<{
  _tag: "Composition";
  runtime: ManagedRuntime.ManagedRuntime<A, E>;
  caller: Caller<C, A>;
  views: Views;
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

export const composition = <A, E, C, const Views extends ViewTable<C> = Record<never, never>>(
  options: Readonly<{
    layer: Layer.Layer<A, E>;
    caller: Caller<C, A>;
    views?: Views;
  }> &
    ViewsCheck<E, Views>,
): Composition<A, C, Views, E> => {
  let closed = false;
  let generation = 0;
  let failed = false;
  const retired: Array<Promise<void>> = [];
  const inflight = new Set<Fiber.Fiber<unknown, unknown>>();
  const fresh = (): ManagedRuntime.ManagedRuntime<A, E> => {
    generation += 1;
    const mine = generation;
    const layer = options.layer.pipe(
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
  const runtime = (): ManagedRuntime.ManagedRuntime<A, E> => {
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
  const app: Composition<A, C, Views, E> = {
    _tag: "Composition",
    get runtime() {
      return runtime();
    },
    caller: options.caller,
    views: options.views ?? ({} as Views),
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
