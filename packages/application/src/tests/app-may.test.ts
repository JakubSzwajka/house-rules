import { expect, it } from "@effect/vitest";
import { defineOperation, NoInput, type PersonCaller } from "@house-rules/domain";
import { Context, Effect, Layer, Logger, Schema } from "effect";
import {
  bindOperation,
  call,
  composition,
  defineFeature,
  defineWay,
  endpoint,
  May,
  type MaySocket,
  Mean,
  renderRegistry,
  Runtime,
  runFeature,
  StepTrace,
  systemStart,
  toFetchHandler,
} from "../index.ts";
import { testActor } from "./execution-fixtures.ts";
import { webRequest } from "./delivery-fixtures.ts";

const base = {
  description: "Read an item.",
  input: NoInput,
  output: Schema.String,
  failure: Schema.Never,
} as const;
const read = defineOperation("items_read", { ...base, permission: "items:read", readOnly: true });
const duplicate = defineOperation("items_duplicate", {
  ...base,
  permission: "items:read",
  readOnly: true,
});
const unused = defineOperation("items_unused", {
  ...base,
  permission: "items:other",
  readOnly: true,
});
const open = defineOperation("items_open", { ...base, permission: null, readOnly: true });
const visible = defineFeature("show_item", {
  ...base,
  permission: "app:open",
  edges: [read],
  flags: { readOnly: true },
  handler: (input, { call }) => call(read, input),
});
const hidden = defineFeature("hidden_item", {
  ...base,
  permission: null,
  edges: [read],
  flags: { readOnly: true },
  handler: (input, { call }) => call(read, input),
});
const job = defineFeature("scheduled_item", {
  ...base,
  permission: null,
  edges: [read],
  flags: { readOnly: true },
  start: systemStart("scheduled refresh"),
  handler: (input, { call, caller }) => call(read, input).pipe(Effect.map(() => caller.kind)),
});
const features = [visible, hidden, job] as const;
const operations = [read, duplicate, unused, open];
const ways = ["web", "partner"].map((name) =>
  defineWay({
    name,
    path: `/${name}`,
    protocol: "http",
    features: [visible],
    endpoints: [endpoint(visible, "GET /item")],
    who: { resolve: () => Effect.succeed(testActor) },
    mean: Mean.no,
  }),
);
class Items extends Context.Service<Items, { readonly value: string }>()("test/items") {}
const itemsMount = {
  service: Items,
  operations,
  bind: () => operations.map((operation) => bindOperation(operation, () => Effect.succeed("item"))),
};
const makeApp = <E>(may: MaySocket<E>, logs: unknown[] = []) => {
  const modules = {
    mounts: [{ ...itemsMount, layer: Layer.succeed(Items, { value: "item" }) }] as const,
    layer: Layer.merge(
      StepTrace.layer(),
      Logger.layer([Logger.make(({ message }) => logs.push(message))]),
    ),
  };
  return composition({ modules, features, ways, may: Effect.succeed(may), system: ["items:read"] });
};

it.effect("one app-level May serves several ways and receives each resolved caller once", () =>
  Effect.gen(function* () {
    const callers: PersonCaller[] = [];
    const app = makeApp({
      permissionsOf: (caller) =>
        Effect.sync(() => {
          callers.push(caller);
          return ["items:read", "app:open"] as const;
        }),
    });
    try {
      for (const way of ways) {
        const result = yield* Effect.promise(() =>
          call(
            app,
            visible,
            {},
            { headers: new Headers(), url: `https://app.example/${way.name}` },
            { way: way.name },
          ),
        );
        expect(result).toEqual({ ok: true, value: "item" });
      }
      expect(callers).toEqual(
        ways.map((way) => ({ kind: "person", actor: testActor, via: way.name })),
      );
      expect(ways.every((way) => !("may" in way))).toBe(true);
    } finally {
      yield* Effect.promise(app.dispose);
    }
  }),
);

it.effect("permissions do not expose an unlisted feature", () =>
  Effect.gen(function* () {
    const app = makeApp(May.fixed(["items:read", "app:open"]));
    try {
      const result = yield* Effect.promise(() =>
        call(
          app,
          hidden,
          {},
          { headers: new Headers(), url: "https://app.example/web" },
          { way: "web" },
        ),
      );
      expect(result).toMatchObject({ ok: false, error: { _tag: "CallInvalid" } });
    } finally {
      yield* Effect.promise(app.dispose);
    }
  }),
);

class LookupFailed extends Schema.TaggedError<LookupFailed>()("LookupFailed", {
  message: Schema.String,
}) {}

it.effect("a May failure returns fixed 503 text and logs its private cause", () =>
  Effect.gen(function* () {
    const detail = "private permission database detail";
    const logs: unknown[] = [];
    let lookups = 0;
    const app = makeApp(
      {
        permissionsOf: () =>
          Effect.suspend(() => {
            lookups += 1;
            return Effect.fail(new LookupFailed({ message: detail }));
          }),
      },
      logs,
    );
    const router = toFetchHandler(app);
    try {
      const response = yield* Effect.promise(() =>
        router(webRequest("https://app.example/web/item")),
      );
      expect(response.status).toBe(503);
      expect(yield* Effect.promise(() => response.json())).toEqual({
        error: { code: "unavailable", message: "Try again shortly." },
      });
      expect(lookups).toBe(1);
      expect(JSON.stringify(logs)).toContain(detail);
    } finally {
      yield* Effect.promise(() => router.dispose().then(app.dispose));
    }
  }),
);

it.effect("a system start uses composition permissions and ignores the person May", () =>
  Effect.gen(function* () {
    let lookups = 0;
    const app = makeApp({
      permissionsOf: () =>
        Effect.suspend(() => {
          lookups += 1;
          return Effect.fail(new LookupFailed({ message: "must not run" }));
        }),
    });
    try {
      const context = yield* app.runtime.contextEffect;
      // A hook gets the app's system list, never a person's list or another Who call.
      const result = yield* runFeature(job, {}).pipe(
        Effect.provideContext(context),
        Effect.provideContext(
          May.context(yield* app.may.pipe(Effect.provideContext(context)), {
            features: [job],
            system: app.system,
            via: "schedule",
          }),
        ),
      );
      expect(result).toBe("system");
      expect(lookups).toBe(0);
      const denied = yield* Effect.flip(
        runFeature(job, {}).pipe(
          Effect.provideContext(context),
          Effect.provideContext(May.system([job], { system: [], via: "schedule" })),
        ),
      );
      expect(denied).toMatchObject({
        _tag: "Forbidden",
        permission: "items:read",
        caller: "system",
      });
    } finally {
      yield* Effect.promise(app.dispose);
    }
  }),
);

it.effect("the catalogue contains exactly the registered operations' unique permissions", () =>
  Effect.gen(function* () {
    const runtime = yield* Runtime.make({
      features,
      ways,
      bindings: operations.map((operation) =>
        bindOperation(operation, () => Effect.succeed("item")),
      ),
    });
    expect(runtime.permissions).toEqual(["items:other", "items:read"]);
    expect(Object.isFrozen(runtime.permissions)).toBe(true);
    const registry = renderRegistry({ mounts: [{ service: "items", operations }], features, ways });
    expect(registry).toContain("## Permissions\n\n- items:other\n- items:read\n\n## Operations");
  }),
);
