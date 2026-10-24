import { request as httpRequest } from "node:http";
import { expect, it } from "vitest";
import { healthHandler, healthRoutes, serve } from "../index.ts";

it("standalone health dispatch is alive without checks and ready with named checks", async () => {
  let calls = 0;
  const dispatch = healthHandler({
    wayPaths: ["/api"],
    version: "build-abc123",
    checks: [
      {
        name: "sql",
        timeoutMs: 100,
        run: async () => {
          calls++;
        },
      },
    ],
  });
  const alive = await dispatch(new Request("http://localhost/healthz"));
  expect(alive?.status).toBe(200);
  expect(await alive?.json()).toEqual({ status: "ok" });
  expect(calls).toBe(0);
  const ready = await dispatch(new Request("http://localhost/readyz"));
  expect(ready?.status).toBe(200);
  expect(await ready?.json()).toEqual({ status: "ok", version: "build-abc123" });
  expect(calls).toBe(1);
  expect(await dispatch(new Request("http://localhost/other"))).toBeUndefined();
});

it("reports only failed names, including thrown errors and deadlines, and aborts timed-out work", async () => {
  let aborted = false;
  const routes = healthRoutes({
    wayPaths: [],
    version: "build-abc123",
    checks: [
      { name: "good", timeoutMs: 100, run: async () => {} },
      {
        name: "sql",
        timeoutMs: 100,
        run: async () => {
          throw new Error("private driver credentials");
        },
      },
      {
        name: "slow",
        timeoutMs: 10,
        run: (signal) =>
          new Promise(() => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
              },
              { once: true },
            );
          }),
      },
    ],
  });
  const response = await routes.readyz.GET(new Request("http://localhost/readyz"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: "unavailable",
    failed: ["sql", "slow"],
    version: "build-abc123",
  });
  expect(aborted).toBe(true);
  const head = await routes.readyz.HEAD(new Request("http://localhost/readyz", { method: "HEAD" }));
  expect(head.status).toBe(503);
  expect(await head.text()).toBe("");
  const alive = await routes.healthz.GET(new Request("http://localhost/healthz"));
  expect(await alive.json()).toEqual({ status: "ok" });
  expect((await routes.healthz.GET(new Request("http://localhost/elsewhere"))).status).toBe(404);
});

it("host intercepts GET/HEAD and rejects other methods before the router", async () => {
  let routerCalls = 0;
  const host = await serve(
    async () => {
      routerCalls++;
      return new Response("router");
    },
    {
      port: 0,
      hostname: "127.0.0.1",
      health: { wayPaths: ["/api"] },
    },
  );
  try {
    for (const path of ["/healthz", "/readyz"]) {
      const get = await fetch(new URL(path, host.url));
      expect(get.status).toBe(200);
      expect(await get.json()).toEqual({ status: "ok" });
      const head = await fetch(new URL(path, host.url), { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
        const response = await fetch(new URL(path, host.url), { method });
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, HEAD");
      }
    }
    for (const method of ["TRACE"]) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(new URL("/healthz", host.url), { method }, (response) => {
          response.resume();
          resolve(response.statusCode);
        });
        request.on("error", reject);
        request.end();
      });
      expect(status, method).toBe(405);
    }
    expect(routerCalls).toBe(0);
    expect(await (await fetch(new URL("/api", host.url))).text()).toBe("router");
    expect(routerCalls).toBe(1);
  } finally {
    await host.close();
  }
});

it("leaves probe paths to the router unless health is explicitly enabled", async () => {
  const host = await serve(async () => new Response("router", { status: 418 }), {
    port: 0,
    hostname: "127.0.0.1",
  });
  try {
    for (const path of ["/healthz", "/readyz"]) {
      const response = await fetch(new URL(path, host.url));
      expect(response.status).toBe(418);
      expect(await response.text()).toBe("router");
    }
  } finally {
    await host.close();
  }
});

it("refuses enabling probes without an explicit way-path list", async () => {
  await expect(
    serve(async () => new Response(), {
      port: 0,
      // @ts-expect-error A caller must supply way paths even when there are none.
      health: {},
    }),
  ).rejects.toThrow("require a wayPaths list");
});

it("captures configured paths at startup and fails before listening on way collisions", async () => {
  for (const way of ["/healthz", "/readyz/feature", "/HEALTHZ", "/%68ealthz", "//healthz/", "/"]) {
    await expect(
      serve(async () => new Response(), {
        port: 0,
        health: { wayPaths: [way] },
      }),
    ).rejects.toThrow("collide");
  }
  expect(() => healthHandler({ wayPaths: ["/api"], readyPath: "/api/ready" })).toThrow("collide");
  expect(() => healthHandler({ wayPaths: [], readyPath: "/healthz" })).toThrow("collide");
  const options = {
    wayPaths: [],
    alivePath: "/alive",
    readyPath: "/ready",
    checks: [],
    version: "original",
  };
  const dispatch = healthHandler(options);
  options.alivePath = "/moved";
  options.version = "changed";
  const ready = await dispatch(new Request("http://localhost/ready"));
  expect(await ready?.json()).toEqual({ status: "ok", version: "original" });
  expect((await dispatch(new Request("http://localhost/alive")))?.status).toBe(200);
  expect(await dispatch(new Request("http://localhost/moved"))).toBeUndefined();
  expect(await dispatch(new Request("http://localhost/healthz"))).toBeUndefined();
});

it("rejects unsafe names, duplicate checks, paths and invalid timeouts at construction", () => {
  const run = async () => {};
  for (const timeoutMs of [0, -1, Number.NaN, Infinity, 0.5, 2_147_483_648]) {
    expect(() =>
      healthHandler({ wayPaths: [], checks: [{ name: "sql", timeoutMs, run }] }),
    ).toThrow("timeoutMs");
  }
  for (const name of ["", "driver text\n", "sql.password"]) {
    expect(() => healthHandler({ wayPaths: [], checks: [{ name, timeoutMs: 1, run }] })).toThrow(
      "names",
    );
  }
  expect(() =>
    healthHandler({ wayPaths: [], checks: Array(2).fill({ name: "sql", timeoutMs: 1, run }) }),
  ).toThrow("names");
  expect(() => healthHandler({ wayPaths: [], alivePath: "/alive?secret" })).toThrow("paths");
});
