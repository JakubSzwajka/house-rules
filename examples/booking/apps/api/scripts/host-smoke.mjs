import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { build as buildPage } from "vite";

await mkdir("dist", { recursive: true });
const useBuilt = process.argv.includes("--built");
const buildDirectory = useBuilt ? "dist" : await mkdtemp("dist/host-smoke-");
if (!useBuilt) {
  await buildPage({ build: { outDir: `${buildDirectory}/web` } });
  await build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["effect", "@effect/*"],
    outfile: `${buildDirectory}/main.js`,
    logLevel: "silent",
  });
}
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const address = socket.address();
assert(address && typeof address !== "string");
const port = address.port;
socket.close();
await once(socket, "close");
const start = (nodeEnv, signingKey = "") =>
  spawn(process.execPath, [`${buildDirectory}/main.js`], {
    env: {
      ...process.env,
      STORAGE: nodeEnv === "production" ? "memory" : (process.env.STORAGE ?? "memory"),
      ACCOUNTS_SIGNING_KEY: signingKey,
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      MCP_AUTH_ISSUER: "",
      NODE_ENV: nodeEnv,
      PORT: String(port),
      APP_ORIGIN: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
};
const child = start("development");
try {
  const deadline = Date.now() + 10000;
  let response;
  while (!response) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/mcp`, { signal: AbortSignal.timeout(1000) });
    } catch (error) {
      if (child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline)
        throw error;
      await delay(25);
    }
  }
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Booking example<\/title>/u);
  const api = await fetch(`http://127.0.0.1:${port}/api/my_profile`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` },
    body: "{}",
  });
  assert.equal(api.status, 401);
  assert.match(api.headers.get("content-type"), /json/u);
  console.log("built page: GET / -> HTML; POST /api/my_profile -> 401 JSON");
  assert.equal(response.status, 503);
  assert.match(await response.text(), /not_configured/u);
  console.log(`built Host (${process.env.STORAGE ?? "memory"}): GET /mcp -> 503 not_configured`);
} finally {
  await stop(child);
}
const production = start("production");
let output = "";
production.stderr.on("data", (chunk) => {
  output += String(chunk);
});
production.stdout.on("data", (chunk) => {
  output += String(chunk);
});
try {
  const [code] = await once(production, "exit");
  assert.notEqual(code, 0);
  assert.match(output, /IdentityProviderInvalid/u);
  assert.match(output, /ACCOUNTS_SIGNING_KEY is required in production/u);
  console.log("built production (memory): missing key -> IdentityProviderInvalid");
} finally {
  await stop(production);
}
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ready = start("production", JSON.stringify(privateKey.export({ format: "jwk" })));
try {
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  let page;
  while (!page) {
    try {
      page = await fetch(origin, { signal: AbortSignal.timeout(1000) });
    } catch (error) {
      if (ready.exitCode !== null || ready.signalCode !== null || Date.now() >= deadline)
        throw error;
      await delay(25);
    }
  }
  assert.equal(page.status, 200);
  const up = await fetch(`${origin}/api/sign_up`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      email: "production-smoke@example.test",
      password: "correct horse battery",
      displayName: "Production smoke",
    }),
  });
  assert.equal(up.status, 200);
  assert.match(up.headers.get("set-cookie") ?? "", /booking_session=/u);
  assert.equal(Object.hasOwn(await up.json(), "token"), false);
  console.log(
    `built production (memory, port ${port}): GET / -> 200; POST /api/sign_up -> 200; key never logged`,
  );
} finally {
  await stop(ready);
}
console.log("all Host children exited");
