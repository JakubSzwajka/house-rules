import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import { serve } from "../index.ts";

it("drains an in-flight response before once-only application disposal", async () => {
  const arrived = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const events: string[] = [];
  const host = await serve(
    async () => {
      arrived.resolve();
      await release.promise;
      events.push("response");
      return new Response("done");
    },
    {
      port: 0,
      hostname: "127.0.0.1",
      onClose: async () => {
        events.push("disposed");
      },
    },
  );
  const response = fetch(host.url);
  await arrived.promise;
  const closing = host.close();
  expect(host.close()).toBe(closing);
  try {
    await expect(fetch(host.url)).rejects.toThrow();
    expect(events).toEqual([]);
    release.resolve();
    expect(await (await response).text()).toBe("done");
    await closing;
    expect(events).toEqual(["response", "disposed"]);
  } finally {
    release.resolve();
    await host.close();
  }
});

it("real repeated SIGTERM/SIGINT share shutdown until disposal ends", async () => {
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
