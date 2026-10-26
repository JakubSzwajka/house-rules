import { mkdtempSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { serve, staticFiles } from "../index.ts";

it("reuses static exclusions and sanitized bounded probes before the router", async () => {
  const root = mkdtempSync(join(tmpdir(), "express-static-"));
  writeFileSync(join(root, "index.html"), "<h1>page</h1>");
  const site = staticFiles({
    root,
    exclude: ["/api", "/mcp", "/.well-known", "/healthz", "/readyz"],
  });
  let calls = 0;
  const local = { port: 0, hostname: "127.0.0.1" };
  const host = await serve(
    async (request) => (await site(request)) ?? (calls++, new Response("router", { status: 404 })),
    {
      ...local,
      health: {
        wayPaths: ["/api", "/mcp"],
        checks: [
          {
            name: "sql",
            timeoutMs: 10,
            run: async () => {
              throw new Error("secret driver text");
            },
          },
        ],
      },
    },
  );
  try {
    expect(
      await (await fetch(new URL("/page", host.url), { headers: { accept: "text/html" } })).text(),
    ).toBe("<h1>page</h1>");
    for (const path of [
      "/api/missing",
      "/%61pi/missing",
      "/API;v=1/missing",
      "/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      expect(
        await (await fetch(new URL(path, host.url), { headers: { accept: "text/html" } })).text(),
      ).toBe("router");
    }
    const before = calls;
    expect(await (await fetch(new URL("/healthz", host.url))).json()).toEqual({ status: "ok" });
    const ready = await fetch(new URL("/readyz", host.url));
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: "unavailable", failed: ["sql"] });
    const trace = await new Promise<number | undefined>((resolve, reject) => {
      const client = httpRequest(new URL("/healthz", host.url), { method: "TRACE" }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      client.on("error", reject);
      client.end();
    });
    expect(trace).toBe(405);
    expect(calls).toBe(before);
  } finally {
    await host.close();
  }
  await expect(
    serve(async () => new Response(), { ...local, health: { wayPaths: ["/healthz"] } }),
  ).rejects.toThrow();
});
