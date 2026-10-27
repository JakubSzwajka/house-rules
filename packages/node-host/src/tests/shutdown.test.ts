import { once } from "node:events";
import { Agent, request, Server } from "node:http";
import { createConnection } from "node:net";
import { expect, it, vi } from "vitest";
import { serve } from "../index.ts";

const local = { port: 0, hostname: "127.0.0.1" };

it("closes a half-open CONNECT client after its complete 501 and disposes once", async () => {
  let closes = 0;
  const host = await serve(async () => new Response("unused"), {
    ...local,
    onClose: async () => {
      closes++;
    },
  });
  const client = createConnection({
    port: Number(host.url.port),
    host: "127.0.0.1",
    allowHalfOpen: true,
  });
  let response = "";
  client.on("data", (chunk) => {
    response += chunk;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ended = once(client, "end");
    client.write("CONNECT good.com:443 HTTP/1.1\r\nHost: good.com:443\r\n\r\n");
    await ended;
    expect(response).toMatch(/^HTTP\/1\.1 501 Not Implemented\r\n/);
    expect(response.endsWith("\r\n\r\nNot Implemented")).toBe(true);
    expect(client.writableEnded).toBe(false);
    const start = performance.now();
    const closing = host.close();
    expect(host.close()).toBe(closing);
    await Promise.race([
      closing,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Unbounded CONNECT shutdown")), 6_000);
      }),
    ]);
    expect(performance.now() - start).toBeLessThan(6_000);
    expect(closes).toBe(1);
  } finally {
    clearTimeout(timer);
    client.destroy();
    await host.close();
  }
}, 8_000);

it("uses one shutdown deadline for a raw idle socket and a stuck request", async () => {
  const arrived = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined;
  let closes = 0;
  const host = await serve(
    async (incoming) => {
      signal = incoming.signal;
      arrived.resolve();
      await release.promise;
      return new Response("late");
    },
    {
      ...local,
      onClose: async () => {
        closes++;
      },
    },
  );
  const idle = createConnection({ port: Number(host.url.port), host: "127.0.0.1" });
  const response = fetch(host.url).catch(() => undefined);
  try {
    await once(idle, "connect");
    await arrived.promise;
    const start = performance.now();
    await host.close();
    expect(performance.now() - start).toBeLessThan(6_000);
    expect(signal?.aborted).toBe(true);
    expect(closes).toBe(1);
    await response;
  } finally {
    idle.destroy();
    release.resolve();
    await host.close();
  }
}, 8_000);

it.each(["HEAD", "empty", "204"])(
  "flushes a graceful %s keep-alive response during close",
  async (kind) => {
    const arrived = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const agent = new Agent({ keepAlive: true });
    let closes = 0;
    const host = await serve(
      async () => {
        arrived.resolve();
        await release.promise;
        if (kind === "204")
          return new Response(null, { status: 204, headers: { "x-complete": "yes" } });
        return new Response(kind === "HEAD" ? "omitted" : "", { headers: { "x-complete": "yes" } });
      },
      {
        ...local,
        onClose: async () => {
          closes++;
        },
      },
    );
    const response = new Promise<{
      status: number | undefined;
      complete: boolean;
      header: string | string[] | undefined;
      body: string;
    }>((resolve, reject) => {
      const client = request(
        host.url,
        { agent, method: kind === "HEAD" ? "HEAD" : "GET" },
        async (incoming) => {
          try {
            let body = "";
            for await (const chunk of incoming) body += chunk;
            resolve({
              status: incoming.statusCode,
              complete: incoming.complete,
              header: incoming.headers["x-complete"],
              body,
            });
          } catch (error) {
            reject(error);
          }
        },
      );
      client.on("error", reject);
      client.end();
    });
    try {
      await arrived.promise;
      const start = performance.now();
      const closing = host.close();
      release.resolve();
      expect(await response).toEqual({
        status: kind === "204" ? 204 : 200,
        complete: true,
        header: "yes",
        body: "",
      });
      await closing;
      expect(performance.now() - start).toBeLessThan(1_000);
      expect(closes).toBe(1);
    } finally {
      release.resolve();
      agent.destroy();
      await host.close();
    }
  },
);

it("still disposes once when the listener close callback reports an error", async () => {
  const failure = new Error("listener close failed");
  const original = Server.prototype.close;
  let closes = 0;
  const host = await serve(async () => new Response(), {
    ...local,
    onClose: async () => {
      closes++;
    },
  });
  const close = vi.spyOn(Server.prototype, "close").mockImplementationOnce(function (
    this: Server,
    callback,
  ) {
    return original.call(this, () => callback?.(failure));
  });
  try {
    await expect(host.close()).rejects.toThrow("listener close failed");
    await expect(host.close()).rejects.toThrow("listener close failed");
    expect(closes).toBe(1);
  } finally {
    close.mockRestore();
  }
});
