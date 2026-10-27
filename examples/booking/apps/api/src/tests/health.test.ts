import { assert, it } from "@effect/vitest";
import { toFetchHandler } from "@house-rules/application";
import { memoryAuditLog } from "@house-rules/call-audit";
import { SqlHealth } from "@house-rules/migrations";
import { healthRoutes, serve } from "@house-rules/node-host";
import { Context, Effect, Exit, Layer, Option } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { AuditTrail } from "../projections/audit-trail/index.ts";
import { createApp, modulePlan } from "../composition/app.ts";
import { databaseTesting } from "../composition/tests/database.ts";
import { webWay } from "../ways-in/web/way.ts";
import { bookingBuild, hostHealth } from "../composition/host-health.ts";

for (const backend of ["memory", "postgres"] as const) {
  it.effect(
    `${backend}: host probes bypass Who, router and audit; readiness uses the app SQL client`,
    () =>
      Effect.gen(function* () {
        if (webWay.protocol !== "http") return assert.fail("Expected HTTP way");
        const log = memoryAuditLog();
        const plan = modulePlan({ log });
        let whoCalls = 0;
        let routerCalls = 0;
        const app = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createApp(
              [
                {
                  ...webWay,
                  who: {
                    resolve: () => {
                      whoCalls++;
                      return Effect.die("Health must not resolve Who");
                    },
                  },
                },
              ],
              {
                modules: {
                  ...plan,
                  layer:
                    backend === "memory"
                      ? plan.layer
                      : plan.layer.pipe(Layer.provideMerge(databaseTesting)),
                },
              },
            ),
          ),
          (app) => Effect.promise(() => app.dispose()),
        );
        const context = yield* app.runtime.contextEffect;
        const audit = Context.get(context, AuditTrail);
        assert.deepStrictEqual(yield* audit.recent(), []);
        const check = SqlHealth.fromContext(context);
        assert.strictEqual(Option.isSome(check), backend === "postgres");
        const api = yield* Effect.acquireRelease(
          Effect.sync(() => toFetchHandler(app)),
          (api) => Effect.promise(() => api.dispose()),
        );
        const host = yield* Effect.acquireRelease(
          Effect.promise(() =>
            serve(
              (request) => {
                routerCalls++;
                return api(request);
              },
              {
                port: 0,
                hostname: "127.0.0.1",
                health: hostHealth(context, app.ways),
              },
            ),
          ),
          (host) => Effect.promise(() => host.close()),
        );
        const client = yield* HttpClient.HttpClient;
        for (const path of ["/healthz", "/readyz"]) {
          const url = new URL(path, host.url).href;
          const response = yield* client.get(url);
          assert.strictEqual(response.status, 200);
          assert.deepStrictEqual(
            yield* response.json,
            path === "/readyz" ? { status: "ok", version: bookingBuild } : { status: "ok" },
          );
          const head = yield* client.head(url);
          assert.strictEqual(head.status, 200);
          assert.strictEqual(yield* head.text, "");
          const post = yield* client.post(url);
          assert.strictEqual(post.status, 405);
        }
        assert.deepStrictEqual(yield* audit.recent(), []);
        assert.strictEqual(whoCalls, 0);
        assert.strictEqual(routerCalls, 0);
        assert.deepStrictEqual(log.rows(), []);
        assert.deepStrictEqual(log.entries(), []);
        if (backend === "postgres") {
          // Close the real pool, then exercise main's captured SQL runner, not a fake check.
          yield* Effect.promise(() => api.dispose());
          yield* Effect.promise(() => app.dispose());
          const failed = yield* client.get(new URL("/readyz", host.url).href);
          assert.strictEqual(failed.status, 503);
          assert.deepStrictEqual(yield* failed.json, {
            status: "unavailable",
            failed: ["sql"],
            version: bookingBuild,
          });
          const alive = yield* client.get(new URL("/healthz", host.url).href);
          assert.strictEqual(alive.status, 200);
          assert.deepStrictEqual(yield* alive.json, { status: "ok" });
          assert.strictEqual(routerCalls, 0);
          assert.strictEqual(whoCalls, 0);
          assert.deepStrictEqual(log.rows(), []);
        }
      }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
}

it.effect("probe failures and timeouts expose only names; collisions refuse host startup", () =>
  Effect.gen(function* () {
    const health = hostHealth(Context.empty(), [
      { protocol: "http", path: "/api" },
      { protocol: "mcp", path: "/mcp" },
      { protocol: "hook" },
      { protocol: "schedule" },
    ]);
    assert.deepStrictEqual(health.wayPaths, ["/api", "/mcp"]);
    assert.deepStrictEqual(health.checks, []);
    assert.strictEqual(health.version, bookingBuild);
    for (const [name, run] of [
      ["sql", () => Promise.reject(new Error("private connection details"))],
      ["slow", () => Promise.race<never>([])],
    ] as const) {
      const routes = healthRoutes({ wayPaths: ["/api"], checks: [{ name, timeoutMs: 10, run }] });
      const response = yield* Effect.promise(() =>
        routes.readyz.GET(new Request("http://localhost/readyz")),
      );
      assert.strictEqual(response.status, 503);
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
        status: "unavailable",
        failed: [name],
      });
      const head = yield* Effect.promise(() =>
        routes.readyz.HEAD(new Request("http://localhost/readyz", { method: "HEAD" })),
      );
      assert.strictEqual(head.status, 503);
      assert.strictEqual(yield* Effect.promise(() => head.text()), "");
    }
    const collision = yield* Effect.exit(
      Effect.promise(() =>
        serve(() => Promise.resolve(new Response()), {
          port: 0,
          health: hostHealth(Context.empty(), [{ protocol: "http", path: "/readyz" }]),
        }),
      ),
    );
    assert.isTrue(Exit.isFailure(collision));
  }),
);
