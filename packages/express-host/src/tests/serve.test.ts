import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { expect, it } from "vitest";
import { serve } from "../index.ts";

const local = { port: 0, hostname: "127.0.0.1" };
const exchange = async (url: URL, request: string): Promise<string> => {
  const socket = connect(Number(url.port), "127.0.0.1");
  let wire = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    wire += chunk;
  });
  const closed = once(socket, "close");
  socket.end(`${request}Connection: close\r\n\r\n`);
  await closed;
  return wire;
};

it.each([
  ["GET / HTTP/1.1\r\n", 400],
  ["GET / HTTP/1.0\r\n", 400],
  ["GET / HTTP/1.1\r\nHost: a@evil.com\r\n", 400],
  ["GET http://good.com/x HTTP/1.1\r\nHost: good.com\r\n", 400],
  ["GET /x#fragment HTTP/1.1\r\nHost: good.com\r\n", 400],
  ["GET path HTTP/1.1\r\nHost: good.com\r\n", 400],
  ["GET / HTTP/1.1\r\nHost: [:::1]\r\n", 400],
  ["GET / HTTP/1.1\r\nHost: good.com:65536\r\n", 400],
  ["OPTIONS * HTTP/1.1\r\nHost: good.com\r\n", 501],
  ["TRACE / HTTP/1.1\r\nHost: good.com\r\n", 501],
  ["CONNECT good.com:443 HTTP/1.1\r\nHost: good.com\r\n", 501],
])("rejects raw traffic %s with %s before dispatch", async (request, status) => {
  let calls = 0;
  const host = await serve(async () => {
    calls++;
    return new Response("unexpected");
  }, local);
  try {
    expect(await exchange(host.url, request)).toContain(`HTTP/1.1 ${status} `);
    expect(calls).toBe(0);
  } finally {
    await host.close();
  }
});

it("preserves IPv6 authority, raw target and credential/header pairs without Express rewriting", async () => {
  const host = await serve(async (request) => {
    expect(request.url).toBe("http://[::1]:8080//raw%2Fpath?q=a%2Bb");
    expect(request.headers.get("cookie")).toBe("a=1; b=2");
    expect(request.headers.get("authorization")).toBe("Bearer fixture");
    expect(request.headers.get("x-repeat")).toBe("one, two");
    const headers = new Headers({ "x-request-id": "fixture", "cache-control": "no-store" });
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT");
    return new Response("ok", { status: 201, headers });
  }, local);
  try {
    const wire = await exchange(
      host.url,
      "GET //raw%2Fpath?q=a%2Bb HTTP/1.1\r\nHost: [::1]:8080\r\nCookie: a=1\r\nCookie: b=2\r\nAuthorization: Bearer fixture\r\nX-Repeat: one\r\nX-Repeat: two\r\nX-Forwarded-Host: evil.com\r\nX-Forwarded-Proto: https\r\n",
    );
    expect(wire).toContain("HTTP/1.1 201 ");
    expect(wire.match(/set-cookie:/g)).toHaveLength(2);
    expect(wire).toContain("x-request-id: fixture");
    expect(wire).not.toMatch(/x-powered-by|etag:/i);
  } finally {
    await host.close();
  }
});

it("streams binary uploads before completion and keeps their response signal live", async () => {
  const first = Promise.withResolvers<void>();
  const host = await serve(async (request) => {
    const reader = request.body?.getReader();
    if (reader === undefined) throw new Error("Missing body");
    expect(Array.from((await reader.read()).value ?? [])).toEqual([0, 255, 128]);
    first.resolve();
    expect(Array.from((await reader.read()).value ?? [])).toEqual([1, 254]);
    expect((await reader.read()).done).toBe(true);
    expect(request.signal.aborted).toBe(false);
    return new Response(new Uint8Array([0, 255, 1]));
  }, local);
  try {
    const response = Promise.withResolvers<import("node:http").IncomingMessage>();
    const client = httpRequest(host.url, { method: "POST" }, response.resolve);
    client.write(Buffer.from([0, 255, 128]));
    await first.promise;
    client.end(Buffer.from([1, 254]));
    const chunks: Buffer[] = [];
    for await (const chunk of await response.promise) chunks.push(chunk);
    expect(Array.from(Buffer.concat(chunks))).toEqual([0, 255, 1]);
  } finally {
    await host.close();
  }
});

it("HEAD cancels a supplied body and empty responses remain empty", async () => {
  let cancelled = false;
  const host = await serve(
    async (request) =>
      request.method === "HEAD"
        ? new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { "x-head": "yes" } },
          )
        : new Response(null, { status: 204 }),
    local,
  );
  try {
    const response = await fetch(host.url, { method: "HEAD" });
    expect(response.headers.get("x-head")).toBe("yes");
    expect(await response.text()).toBe("");
    expect(cancelled).toBe(true);
    expect((await fetch(host.url)).status).toBe(204);
  } finally {
    await host.close();
  }
});

it.each(["handler", "stream"])("returns fixed pre-header 500 for %s failure", async (failure) => {
  const host = await serve(async () => {
    if (failure === "handler") throw new Error("private detail");
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("private"));
        },
      }),
      { headers: { "x-private": "remove" } },
    );
  }, local);
  try {
    const response = await fetch(host.url);
    expect(response.status).toBe(500);
    expect(response.headers.get("x-private")).toBeNull();
    expect(await response.text()).toBe("Internal Server Error");
  } finally {
    await host.close();
  }
});

it("flushes parameterized mixed-case SSE headers before events and cancels on disconnect", async () => {
  const aborted = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const host = await serve(async (request) => {
    request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled.resolve();
        },
      }),
      {
        headers: {
          "content-type": "Text/Event-Stream; charset=utf-8",
          "mcp-session-id": "fixture",
        },
      },
    );
  }, local);
  try {
    const response = await fetch(host.url);
    expect(response.headers.get("mcp-session-id")).toBe("fixture");
    await response.body?.cancel();
    await aborted.promise;
    await cancelled.promise;
  } finally {
    await host.close();
  }
});

it("closes a failed stream after flushing SSE headers, without an Express error page", async () => {
  const fail = Promise.withResolvers<void>();
  const host = await serve(
    async () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            await fail.promise;
            controller.error(new Error("private"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    local,
  );
  try {
    const response = await fetch(host.url);
    expect(response.status).toBe(200);
    fail.resolve();
    await expect(response.text()).rejects.toThrow();
  } finally {
    fail.resolve();
    await host.close();
  }
});

it("bounds an idle SSE drain to five seconds and disposes once", async () => {
  let signal: AbortSignal | undefined;
  let disposals = 0;
  const host = await serve(
    async (request) => {
      signal = request.signal;
      return new Response(new ReadableStream(), {
        headers: { "content-type": "text/event-stream" },
      });
    },
    {
      ...local,
      onClose: async () => {
        disposals++;
      },
    },
  );
  const response = await fetch(host.url);
  const body = response.text().catch(() => "closed");
  const start = performance.now();
  const closing = host.close();
  expect(host.close()).toBe(closing);
  await closing;
  expect(performance.now() - start).toBeGreaterThanOrEqual(4_900);
  expect(performance.now() - start).toBeLessThan(6_500);
  expect(signal?.aborted).toBe(true);
  expect(disposals).toBe(1);
  await body;
  await expect(fetch(host.url)).rejects.toThrow();
}, 10_000);

it("rejects listen failures without installing signal hooks or disposing an app it did not start", async () => {
  const original = await serve(async () => new Response("owner"), local);
  const counts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  let disposals = 0;
  try {
    await expect(
      serve(async () => new Response(), {
        port: Number(original.url.port),
        hostname: "127.0.0.1",
        handleSignals: true,
        onClose: async () => {
          disposals++;
        },
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(counts);
    expect(disposals).toBe(0);
    expect(await (await fetch(original.url)).text()).toBe("owner");
  } finally {
    await original.close();
  }
});

it("removes signal hooks even when disposal fails and returns the same rejected close", async () => {
  const counts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const host = await serve(async () => new Response(), {
    ...local,
    handleSignals: true,
    onClose: async () => {
      throw new Error("dispose failed");
    },
  });
  const closing = host.close();
  await expect(closing).rejects.toThrow("dispose failed");
  expect(host.close()).toBe(closing);
  expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(counts);
});
