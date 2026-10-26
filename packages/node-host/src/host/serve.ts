import { createServer } from "node:http";

import type { HealthOptions } from "./health.ts";
import { createNodeRequestHandler } from "./node-request-handler.ts";

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
  const bridge = createNodeRequestHandler(handler, options);
  let closing: Promise<void> | undefined;
  const server = createServer({ requireHostHeader: false }, (incoming, outgoing) => {
    void bridge.handle(incoming, outgoing).finally(() => {
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
      try {
        const stopped = new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeIdleConnections();
        });
        await bridge.drain(5_000);
        server.closeAllConnections();
        await stopped;
        await options.onClose?.();
      } finally {
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
