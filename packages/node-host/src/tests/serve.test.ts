import { spawn } from "node:child_process";
import { once } from "node:events";
import { Agent, request as httpRequest } from "node:http";
import { expect, it } from "vitest";
import { serve } from "../index.ts";

const local = { port: 0, hostname: "127.0.0.1" };

it("GET carries the method, Host URL and headers; response carries status and separate cookies", async () => {
  const host = await serve(async (request) => {
    expect(request.method).toBe("GET");
    expect(request.url).toBe("http://public.example:8080/a?b=c");
    expect(request.headers.get("x-test")).toBe("one, two");
    expect(request.signal.aborted).toBe(false);
    const headers = new Headers({ "x-answer": "yes" });
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT");
    return new Response("hello", { status: 201, headers });
  }, local);
  try {
    const response = await new Promise<import("node:http").IncomingMessage>((resolve) => {
      httpRequest(
        new URL("/a?b=c", host.url),
        {
          headers: { host: "public.example:8080", "x-test": ["one", "two"] },
        },
        resolve,
      ).end();
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["x-answer"]).toBe("yes");
    expect(response.headers["set-cookie"]).toEqual([
      "a=1; Path=/",
      "b=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT",
    ]);
    let body = "";
    for await (const chunk of response) body += chunk;
    expect(body).toBe("hello");
  } finally {
    await host.close();
  }
});

it("POST streams an upload to the handler before the client sends its tail", async () => {
  const first = Promise.withResolvers<void>();
  const host = await serve(async (request) => {
    expect(request.method).toBe("POST");
    if (request.body === null) throw new Error("Expected an upload");
    const reader = request.body.getReader();
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toBe("first");
    first.resolve();
    let tail = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      tail += new TextDecoder().decode(chunk.value);
    }
    expect(request.signal.aborted).toBe(false);
    return new Response(tail);
  }, local);
  try {
    const response = Promise.withResolvers<import("node:http").IncomingMessage>();
    const client = httpRequest(host.url, { method: "POST" }, response.resolve);
    client.write("first");
    await first.promise;
    client.end("tail");
    let body = "";
    for await (const chunk of await response.promise) body += chunk;
    expect(body).toBe("tail");
  } finally {
    await host.close();
  }
});

it("streams a response chunk before its body finishes", async () => {
  const finish = Promise.withResolvers<void>();
  const host = await serve(
    async () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("first"));
            await finish.promise;
            controller.enqueue(new TextEncoder().encode("tail"));
            controller.close();
          },
        }),
      ),
    local,
  );
  try {
    const response = await fetch(host.url);
    if (response.body === null) throw new Error("Expected a response stream");
    const reader = response.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
    finish.resolve();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("tail");
    expect((await reader.read()).done).toBe(true);
  } finally {
    finish.resolve();
    await host.close();
  }
});

it.each(["GET", "POST"])(
  "aborts the Request signal when a %s client disconnects",
  async (method) => {
    const arrived = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const host = await serve(async (request) => {
      request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      arrived.resolve();
      await aborted.promise;
      return new Response("too late");
    }, local);
    try {
      const client = httpRequest(host.url, { method });
      client.on("error", () => {});
      if (method === "POST") client.write("partial");
      else client.end();
      await arrived.promise;
      client.destroy();
      await aborted.promise;
    } finally {
      await host.close();
    }
  },
);

it("a handler throw answers a plain 500 without details", async () => {
  const host = await serve(async () => {
    throw new Error("private detail");
  }, local);
  try {
    const response = await fetch(host.url);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("Internal Server Error");
  } finally {
    await host.close();
  }
});

it.each([false, true])(
  "close drops idle keep-alive sockets after a 200 ms request (in flight: %s)",
  async (inflight) => {
    const arrived = Promise.withResolvers<void>();
    const agent = new Agent({ keepAlive: true });
    const host = await serve(async () => {
      arrived.resolve();
      await new Promise((resolve) => setTimeout(resolve, 200));
      return new Response("ok");
    }, local);
    const response = new Promise<string>((resolve, reject) => {
      const client = httpRequest(host.url, { agent }, async (incoming) => {
        let body = "";
        for await (const chunk of incoming) body += chunk;
        resolve(body);
      });
      client.on("error", reject);
      client.end();
    });
    try {
      await arrived.promise;
      if (!inflight) await response;
      const start = performance.now();
      await host.close();
      expect(performance.now() - start).toBeLessThan(800);
      expect(await response).toBe("ok");
    } finally {
      agent.destroy();
      await host.close();
    }
  },
);

it("close stops accepting, drains the response and awaits onClose exactly once", async () => {
  const arrived = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const disposing = Promise.withResolvers<void>();
  const disposed = Promise.withResolvers<void>();
  const events: string[] = [];
  const host = await serve(
    async () => {
      arrived.resolve();
      await finish.promise;
      events.push("response");
      return new Response("done");
    },
    {
      ...local,
      onClose: async () => {
        events.push("onClose");
        disposing.resolve();
        await disposed.promise;
      },
    },
  );
  const response = fetch(host.url);
  await arrived.promise;
  const closing = host.close();
  expect(host.close()).toBe(closing);
  expect(events).toEqual([]);
  await expect(fetch(host.url)).rejects.toThrow();
  finish.resolve();
  expect(await (await response).text()).toBe("done");
  await disposing.promise;
  expect(events).toEqual(["response", "onClose"]);
  disposed.resolve();
  await closing;
  await host.close();
  expect(events).toEqual(["response", "onClose"]);
});

it("close bounds drain time and aborts a stuck request before onClose", async () => {
  const arrived = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined;
  let disposed = false;
  const host = await serve(
    async (request) => {
      signal = request.signal;
      arrived.resolve();
      await release.promise;
      return new Response("late");
    },
    {
      ...local,
      onClose: async () => {
        disposed = true;
      },
    },
  );
  const response = fetch(host.url).catch(() => undefined);
  await arrived.promise;
  try {
    await host.close();
    await response;
    expect(signal?.aborted).toBe(true);
    expect(disposed).toBe(true);
  } finally {
    release.resolve();
    await host.close();
  }
}, 10_000);

it("real SIGTERM and SIGINT share one shutdown and remove their listeners", async () => {
  const entry = new URL("../index.ts", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { serve } from ${JSON.stringify(entry)};
    const host = await serve(async () => new Response("ok"), {
      port: 0, hostname: "127.0.0.1", handleSignals: true,
      onClose: async () => {
        process.send("closing");
        await new Promise(resolve => process.once("message", resolve));
      }
    });
    process.send(host.url.href);
    process.once("disconnect", () => {});
  `,
    ],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  const exit = once(child, "exit");
  let closes = 0;
  child.on("message", (message) => {
    if (message === "closing") closes++;
  });
  try {
    const [url] = await once(child, "message");
    expect(await (await fetch(String(url))).text()).toBe("ok");
    const closing = once(child, "message");
    child.kill("SIGTERM");
    await closing;
    child.kill("SIGINT");
    child.send("finish");
    child.disconnect();
    expect(await exit).toEqual([0, null]);
    expect(closes).toBe(1);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exit;
    }
  }
});

it("manual close removes signal listeners and the default host installs none", async () => {
  const counts = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")] as const;
  const host = await serve(async () => new Response(), { ...local, handleSignals: true });
  expect(process.listenerCount("SIGTERM")).toBe(counts[0] + 1);
  expect(process.listenerCount("SIGINT")).toBe(counts[1] + 1);
  await host.close();
  const plain = await serve(async () => new Response(), local);
  expect([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")]).toEqual(counts);
  await plain.close();
});
