import { readFile } from "node:fs/promises";
import path from "node:path";

const [protocol, directory, person, name, input = "{}"] = process.argv.slice(2);
if (!["http", "mcp"].includes(protocol) || !directory || !person || !name)
  throw new Error(
    "Usage: node scripts/prove.mjs http|mcp <run-directory> alice|bob|none <name|--list> [json]",
  );
if (!["alice", "bob", "none"].includes(person)) throw new Error("Unknown fixture person.");
const { origin } = JSON.parse(await readFile(path.join(directory, "run.json"), "utf8"));
const target = new URL(origin);
if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.origin !== origin)
  throw new Error("Proof requests must stay on the fixture's loopback origin.");
const headers = {
  "content-type": "application/json",
  ...(protocol === "http" ? { origin } : {}),
};
if (person !== "none") {
  const credentials = JSON.parse(await readFile(path.join(directory, "credentials.json"), "utf8"));
  headers.authorization = `Bearer ${credentials[person]}`;
}
const send = async (endpoint, body, extra = {}) => {
  const response = await fetch(`${origin}${endpoint}`, {
    method: "POST",
    headers: { ...headers, ...extra },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  const text = await response.text();
  return { response, text };
};
const print = ({ response, text }) => {
  console.log(`HTTP ${response.status}`);
  for (const key of ["content-type", "x-request-id", "www-authenticate"])
    if (response.headers.has(key)) console.log(`${key}: ${response.headers.get(key)}`);
  console.log(text);
};
if (protocol === "http") {
  print(await send(`/api/${encodeURIComponent(name)}`, JSON.parse(input)));
} else {
  const extra = { accept: "application/json, text/event-stream" };
  const initialized = await send(
    "/mcp",
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "booking-proof", version: "1" },
      },
    },
    extra,
  );
  if (initialized.response.status !== 200) {
    print(initialized);
  } else {
    const session = {
      ...extra,
      "mcp-session-id": initialized.response.headers.get("mcp-session-id") ?? "",
      "mcp-protocol-version": "2025-11-25",
    };
    await send("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, session);
    print(
      await send(
        "/mcp",
        {
          jsonrpc: "2.0",
          id: 2,
          method: name === "--list" ? "tools/list" : "tools/call",
          params: name === "--list" ? {} : { name, arguments: JSON.parse(input) },
        },
        session,
      ),
    );
  }
}
