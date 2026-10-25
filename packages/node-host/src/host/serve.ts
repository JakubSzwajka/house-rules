import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { healthHandler, type HealthOptions } from "./health.ts";

const drainTimeoutMs = 5_000;

const requestOf = (incoming: IncomingMessage, signal: AbortSignal): Request => {
  const host = incoming.headers.host;
  if (host === undefined || !/^(?:[a-zA-Z0-9._-]+|\[[a-fA-F0-9:.]+\])(?::[0-9]+)?$/.test(host)) {
    throw new TypeError("Invalid Host");
  }
  const origin = new URL(`http://${host}`).origin;
  const target = incoming.url ?? "";
  if (!target.startsWith("/") || target.includes("#")) {
    throw new TypeError("Invalid request target");
  }
  const url = `${origin}${target}`;
  const headers = new Headers();
  for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
    const key = incoming.rawHeaders[i];
    const value = incoming.rawHeaders[i + 1];
    if (key === undefined || value === undefined) continue;
    if (key.toLowerCase() === "cookie" && headers.has(key)) {
      headers.set(key, `${headers.get(key)}; ${value}`);
    } else {
      headers.append(key, value);
    }
  }
  const method = incoming.method === "TRACE" ? "GET" : (incoming.method ?? "GET");
  const init: RequestInit & { duplex?: "half" } = { method, headers, signal };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  return new Request(url, init) as Request;
};

const rejectRequest = (outgoing: ServerResponse, status: 400 | 501): void => {
  const message = status === 400 ? "Bad Request" : "Not Implemented";
  outgoing.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(message),
  });
  outgoing.end(message);
};

const respond = async (
  handler: (request: Request) => Promise<Response>,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  controller: AbortController,
  health: ReturnType<typeof healthHandler> | undefined,
): Promise<void> => {
  const abort = () => controller.abort();
  const disconnected = () => {
    // IncomingMessage's close also fires after a normal upload; the response tracks the peer.
    if (!outgoing.writableFinished) abort();
  };
  incoming.once("aborted", abort);
  outgoing.once("close", disconnected);
  try {
    if (incoming.method === "CONNECT" || (incoming.method === "OPTIONS" && incoming.url === "*")) {
      rejectRequest(outgoing, 501);
      return;
    }
    let request: Request;
    try {
      request = requestOf(incoming, controller.signal as AbortSignal);
    } catch {
      rejectRequest(outgoing, 400);
      return;
    }
    const probe = await health?.(request, incoming.method);
    if (probe === undefined && incoming.method === "TRACE") {
      rejectRequest(outgoing, 501);
      return;
    }
    const response = probe ?? (await handler(request));
    if (outgoing.destroyed) {
      await response.body?.cancel();
      return;
    }
    outgoing.statusCode = response.status;
    for (const [key, value] of response.headers) {
      if (key !== "set-cookie") outgoing.setHeader(key, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
    if (incoming.method === "HEAD" || response.body === null) {
      await response.body?.cancel();
      outgoing.end();
    } else {
      // Read once before pipeline: it destroys the socket on even a pre-header stream failure.
      const body = Readable.fromWeb(response.body as unknown as NodeReadableStream, {
        signal: controller.signal,
      });
      try {
        const chunks = body[Symbol.asyncIterator]();
        const first = await chunks.next();
        if (first.done) {
          outgoing.end();
        } else {
          await pipeline(
            Readable.from(
              (async function* () {
                yield first.value;
                yield* chunks;
              })(),
            ),
            outgoing,
            { signal: controller.signal },
          );
        }
      } finally {
        body.destroy();
      }
    }
  } catch {
    if (outgoing.destroyed) return;
    if (outgoing.headersSent) {
      outgoing.destroy();
      return;
    }
    for (const key of outgoing.getHeaderNames()) outgoing.removeHeader(key);
    outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    outgoing.end("Internal Server Error");
  } finally {
    incoming.off("aborted", abort);
    outgoing.off("close", disconnected);
    if (!incoming.destroyed) incoming.resume();
  }
};

export const serve = async (
  handler: (request: Request) => Promise<Response>,
  options: {
    port: number;
    hostname?: string;
    onClose?: () => Promise<void>;
    handleSignals?: boolean;
    health?: HealthOptions;
  },
): Promise<{ url: URL; close(): Promise<void> }> => {
  const health = options.health === undefined ? undefined : healthHandler(options.health);
  const active = new Map<Promise<void>, AbortController>();
  let closing: Promise<void> | undefined;
  const server = createServer({ requireHostHeader: false }, (incoming, outgoing) => {
    const controller = new AbortController();
    const task = respond(handler, incoming, outgoing, controller, health);
    active.set(task, controller);
    void task.finally(() => {
      active.delete(task);
      if (closing !== undefined) server.closeIdleConnections();
    });
  });
  server.on("connect", (_incoming, socket) => {
    socket.end(
      "HTTP/1.1 501 Not Implemented\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: 15\r\nconnection: close\r\n\r\nNot Implemented",
    );
  });
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    server.once("error", failed);
    server.listen(options.port, options.hostname, () => {
      server.off("error", failed);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No TCP address");
  const hostname =
    address.address === "::"
      ? "[::1]"
      : address.address === "0.0.0.0"
        ? "127.0.0.1"
        : address.family === "IPv6"
          ? `[${address.address}]`
          : address.address;
  const url = new URL(`http://${hostname}:${address.port}/`);
  const signal = () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  };
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    closing = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const drained = new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeIdleConnections();
        }).then(async () => {
          await Promise.allSettled(active.keys());
        });
        const deadline = new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            for (const controller of active.values()) controller.abort();
            server.closeAllConnections();
            resolve();
          }, drainTimeoutMs);
        });
        await Promise.race([drained, deadline]);
        clearTimeout(timer);
        await options.onClose?.();
      } finally {
        clearTimeout(timer);
        if (options.handleSignals === true) {
          process.off("SIGTERM", signal);
          process.off("SIGINT", signal);
        }
      }
    })();
    return closing;
  };
  if (options.handleSignals === true) {
    process.on("SIGTERM", signal);
    process.on("SIGINT", signal);
  }
  return { url, close };
};
