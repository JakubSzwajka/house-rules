import { expect, it } from "@effect/vitest";
import { defineOperation, NoInput } from "@house-rules/domain";
import { Context, Effect, Layer, Schema } from "effect";
import {
  bindOperation,
  composition,
  GraphInvalid,
  May,
  PermissionCatalogue,
  planLayer,
  registry,
  Runtime,
  StepTrace,
  type MountDefinition,
} from "../index.ts";

class Store extends Context.Service<Store, { readonly value: string }>()("test/mounts/Store") {}
class Hook extends Context.Service<Hook, string>()("test/mounts/Hook") {}
const base = {
  description: "Read.",
  input: NoInput,
  output: Schema.String,
  failure: Schema.Never,
  permission: "items:read",
  readOnly: true,
} as const;
const read = defineOperation("mount_read", base);
const extra = defineOperation("mount_extra", base);
const mount = {
  service: Store,
  operations: [read],
  bind: (store) => [bindOperation(read, () => Effect.succeed(store.value))],
} satisfies MountDefinition<Store, Store["Service"]>;
const store = Layer.succeed(Store, { value: "ok" });

it.effect.each(["missing", "extra", "duplicate"] as const)(
  "rejects a %s binder descriptor",
  (kind) =>
    Effect.gen(function* () {
      const bindings = mount.bind({ value: "ok" });
      const bind = () =>
        kind === "missing"
          ? []
          : kind === "extra"
            ? [...bindings, bindOperation(extra, () => Effect.succeed("extra"))]
            : [...bindings, ...bindings];
      const error = yield* Runtime.pipe(
        Effect.provide(
          Runtime.layer({ mounts: [{ ...mount, bind }], features: [], ways: [] }).pipe(
            Layer.provide(store),
          ),
        ),
        Effect.flip,
      );
      expect(error).toBeInstanceOf(GraphInvalid);
      expect(error.reason).toContain("exactly");
    }),
);
it.effect("rejects duplicate service keys before invoking binders", () =>
  Effect.gen(function* () {
    let binds = 0;
    const definition = {
      ...mount,
      operations: [],
      bind: () => {
        binds += 1;
        return [];
      },
    };
    const error = yield* Runtime.pipe(
      Effect.provide(
        Runtime.layer({ mounts: [definition, definition], features: [], ways: [] }).pipe(
          Layer.provide(store),
        ),
      ),
      Effect.flip,
    );
    expect(error.reason).toContain("Duplicate mount service");
    expect(binds).toBe(0);
  }),
);
it.effect("rejects duplicate operation identities and names", () =>
  Effect.gen(function* () {
    for (const operation of [read, defineOperation(read.name, base)]) {
      const error = yield* Runtime.pipe(
        Effect.provide(
          Runtime.layer({
            mounts: [{ ...mount, operations: [read, operation] }],
            features: [],
            ways: [],
          }).pipe(Layer.provide(store)),
        ),
        Effect.flip,
      );
      expect(error).toBeInstanceOf(GraphInvalid);
      expect(error.reason).toContain("Duplicate");
    }
  }),
);
it.effect("supplies the catalogue before building modules and resolves May once", () =>
  Effect.gen(function* () {
    let builds = 0;
    let binds = 0;
    let mays = 0;
    let catalogue: readonly string[] = [];
    const layer = Layer.effect(
      Store,
      Effect.gen(function* () {
        builds += 1;
        catalogue = yield* (yield* PermissionCatalogue).permissions();
        return { value: "fresh" };
      }),
    );
    const app = composition({
      modules: {
        mounts: [
          {
            ...mount,
            layer,
            bind: (service: Store["Service"]) => {
              binds += 1;
              return mount.bind(service);
            },
          },
        ],
        layer: StepTrace.layer(),
      },
      features: [],
      ways: [],
      may: Effect.sync(() => {
        mays += 1;
        return May.fixed([]);
      }),
      system: [],
    });
    try {
      const context = yield* app.runtime.contextEffect;
      const snapshot = yield* registry(app);
      yield* registry(app);
      expect(Context.get(context, Runtime).permissions).toBe(catalogue);
      expect(catalogue).toEqual(["items:read"]);
      expect(snapshot.mounts[0]?.operations[0]).toBe(read);
      expect([builds, binds, mays]).toEqual([1, 1, 1]);
    } finally {
      yield* Effect.promise(() => app.dispose());
    }
  }),
);
it("rejects binders whose parameter contradicts the service shape", () => {
  const wrong = {
    service: Store,
    operations: [],
    bind: (service: number) => {
      service.toFixed();
      return [];
    },
  };
  const invalidRuntime = () =>
    Runtime.layer({
      // @ts-expect-error Store supplies { value: string }, not number.
      mounts: [wrong],
      features: [],
      ways: [],
    });
  const invalidPlan = () =>
    planLayer({
      // @ts-expect-error The raw-service path checks the same binder constraint.
      mounts: [{ ...wrong, layer: store }],
      layer: Layer.empty,
    });
  const invalidComposition = () =>
    composition({
      modules: {
        // @ts-expect-error Composition also rejects the malformed binder.
        mounts: [{ ...wrong, layer: store }],
        layer: StepTrace.layer(),
      },
      features: [],
      ways: [],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
  expect(
    [invalidRuntime, invalidPlan, invalidComposition].every((value) => typeof value === "function"),
  ).toBe(true);
});
it.effect("builds raw services and infrastructure with the same mount-derived catalogue", () =>
  Effect.gen(function* () {
    let catalogue: readonly string[] = [];
    const infrastructure = Layer.effect(
      Hook,
      Effect.gen(function* () {
        catalogue = yield* (yield* PermissionCatalogue).permissions();
        return "infrastructure";
      }),
    );
    const service = Layer.effect(
      Store,
      Effect.gen(function* () {
        expect(yield* Hook).toBe("infrastructure");
        expect(yield* (yield* PermissionCatalogue).permissions()).toBe(catalogue);
        return { value: "raw" };
      }),
    );
    const context = yield* Layer.build(
      planLayer({
        mounts: [{ ...mount, layer: service }],
        layer: infrastructure,
      }),
    );
    expect(Context.get(context, Store).value).toBe("raw");
    expect(yield* Context.get(context, PermissionCatalogue).permissions()).toBe(catalogue);
    expect(catalogue).toEqual(["items:read"]);
  }).pipe(Effect.scoped),
);
it("requires every mount layer to provide its service", () => {
  const invalid = () =>
    // @ts-expect-error Layer.empty does not provide Store.
    composition({
      modules: { mounts: [{ ...mount, layer: Layer.empty }], layer: StepTrace.layer() },
      features: [],
      ways: [],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
  expect(typeof invalid).toBe("function");
});
