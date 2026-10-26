import type { Socket } from "node:net";
import { createNodeRequestHandler, type HealthOptions } from "@house-rules/node-host";
import express from "express";

export interface ServeOptions {
  port: number;
  hostname?: string;
  health?: HealthOptions;
  onClose?: () => Promise<void>;
  handleSignals?: boolean;
}

export interface Host {
  url: URL;
  close(): Promise<void>;
}

export const serve = async (
  handler: (request: Request) => Promise<Response>,
  options: ServeOptions,
): Promise<Host> => {
  const bridge = createNodeRequestHandler(handler, options);
  const app = express();
  app.disable("x-powered-by");
  app.disable("trust proxy");
  app.disable("query parser");
  app.disable("etag");
  let closing: Promise<void> | undefined;
  app.use((incoming, outgoing) => {
    void bridge.handle(incoming, outgoing).finally(() => {
      if (closing !== undefined) server.closeIdleConnections();
    });
  });
  // Express 5 reports listen failures through this callback, not a thrown exception.
  const listening = Promise.withResolvers<void>();
  const server = app.listen({ port: options.port, host: options.hostname }, (error?: Error) => {
    if (error !== undefined) listening.reject(error);
    else listening.resolve();
  });
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("connect", (_incoming, socket) => {
    socket.end(
      "HTTP/1.1 501 Not Implemented\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: 15\r\nconnection: close\r\n\r\nNot Implemented",
      () => socket.destroy(),
    );
  });
  try {
    await listening.promise;
  } catch (error) {
    server.close();
    throw error;
  }
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
      const expires = performance.now() + 5_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          // CONNECT sockets are detached from Node's HTTP connection list.
          for (const socket of sockets) socket.destroy();
          resolve(undefined);
        }, 5_000);
      });
      try {
        const stopped = new Promise<Error | undefined>((resolve) => {
          server.close((error) => resolve(error));
          server.closeIdleConnections();
        });
        await bridge.drain(Math.max(0, expires - performance.now()));
        const error = await Promise.race([stopped, deadline]);
        if (error !== undefined) throw error;
      } finally {
        clearTimeout(timer);
        try {
          await options.onClose?.();
        } finally {
          if (options.handleSignals === true) {
            process.off("SIGTERM", signal);
            process.off("SIGINT", signal);
          }
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
