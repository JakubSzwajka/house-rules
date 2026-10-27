import { createServer, request as httpRequest } from "node:http";
import { expect, it } from "vitest";
import { createNodeRequestHandler, serve } from "../index.ts";

it("the listener-free bridge bounds draining even when a handler ignores abort", async () => {
  const arrived = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined;
  const bridge = createNodeRequestHandler(async (request) => {
    signal = request.signal;
    arrived.resolve();
    await release.promise;
    return new Response("late");
  });
  const server = createServer((incoming, outgoing) => {
    void bridge.handle(incoming, outgoing);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing address");
  const client = httpRequest(`http://127.0.0.1:${address.port}`);
  client.on("error", () => {});
  client.end();
  await arrived.promise;
  const start = performance.now();
  const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    const draining = bridge.drain(20);
    expect(bridge.drain(20)).toBe(draining);
    await draining;
    expect(performance.now() - start).toBeLessThan(500);
    expect(signal?.aborted).toBe(true);
  } finally {
    release.resolve();
    client.destroy();
    server.closeAllConnections();
    await stopped;
  }
});

it("Node Host also flushes idle parameterized SSE headers and cancels on disconnect", async () => {
  const cancelled = Promise.withResolvers<void>();
  const host = await serve(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled.resolve();
          },
        }),
        { headers: { "content-type": "Text/Event-Stream; charset=utf-8" } },
      ),
    { port: 0, hostname: "127.0.0.1" },
  );
  try {
    const response = await fetch(host.url);
    expect(response.status).toBe(200);
    await response.body?.cancel();
    await cancelled.promise;
  } finally {
    await host.close();
  }
});
