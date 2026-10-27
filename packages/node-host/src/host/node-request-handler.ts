import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { healthHandler, type HealthOptions } from "./health.ts";

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
      // MCP opens idle SSE streams. Send their headers before waiting for an event.
      const mediaType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (mediaType === "text/event-stream") outgoing.flushHeaders();
      const body = Readable.fromWeb(response.body as unknown as NodeReadableStream, {
        signal: controller.signal,
      });
      try {
        // Ordinary streams retain a plain 500 if their first read fails.
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
    // Empty, HEAD and fixed-error responses must flush before leaving active tracking.
    await finished(outgoing, { cleanup: true }).catch(() => {});
    incoming.off("aborted", abort);
    outgoing.off("close", disconnected);
    if (!incoming.destroyed) incoming.resume();
  }
};

export interface NodeRequestHandler {
  handle(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void>;
  drain(timeoutMs: number): Promise<void>;
}

export const createNodeRequestHandler = (
  handler: (request: Request) => Promise<Response>,
  options?: { health?: HealthOptions },
): NodeRequestHandler => {
  const health = options?.health === undefined ? undefined : healthHandler(options.health);
  const active = new Map<
    Promise<void>,
    { controller: AbortController; outgoing: ServerResponse }
  >();
  let draining: Promise<void> | undefined;
  return {
    handle(incoming, outgoing) {
      if (draining !== undefined) {
        outgoing.writeHead(503, {
          connection: "close",
          "content-type": "text/plain; charset=utf-8",
        });
        outgoing.end("Service Unavailable");
        return finished(outgoing, { cleanup: true }).catch(() => {});
      }
      const controller = new AbortController();
      const task = respond(handler, incoming, outgoing, controller, health);
      active.set(task, { controller, outgoing });
      void task.finally(() => active.delete(task));
      return task;
    },
    drain(timeoutMs) {
      if (draining !== undefined) return draining;
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        return Promise.reject(new RangeError("Invalid drain timeout"));
      }
      draining = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.allSettled(active.keys()),
            new Promise<void>((resolve) => {
              timer = setTimeout(() => {
                for (const { controller, outgoing } of active.values()) {
                  controller.abort();
                  outgoing.destroy();
                }
                resolve();
              }, timeoutMs);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      })();
      return draining;
    },
  };
};
