import { request as httpRequest } from "node:http";
import { expect, it } from "vitest";
import { serve } from "../index.ts";

it("a paused real socket backpressures the Web body instead of buffering it all", async () => {
  const aborted = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  let pulls = 0;
  const host = await serve(
    async (request) => {
      request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      return new Response(
        new ReadableStream({
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(64 * 1024));
            if (pulls === 512) controller.close();
          },
          cancel() {
            cancelled.resolve();
          },
        }),
      );
    },
    { port: 0, hostname: "127.0.0.1" },
  );
  const client = httpRequest(host.url);
  client.on("error", () => {});
  try {
    const response = Promise.withResolvers<import("node:http").IncomingMessage>();
    client.once("response", (incoming) => {
      incoming.pause();
      response.resolve(incoming);
    });
    client.end();
    const incoming = await response.promise;
    // Give the producer time to fill transport buffers while the peer remains paused.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(pulls).toBeGreaterThan(0);
    expect(pulls).toBeLessThan(512);
    incoming.destroy();
    client.destroy();
    await aborted.promise;
    await cancelled.promise;
  } finally {
    client.destroy();
    await host.close();
  }
});
