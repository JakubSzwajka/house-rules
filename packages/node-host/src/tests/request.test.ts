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
  socket.write(`${request}Connection: close\r\n\r\n`);
  await closed;
  return wire;
};

it.each([
  ["missing Host", "GET / HTTP/1.1\r\n", 400],
  ["missing HTTP/1.0 Host", "GET / HTTP/1.0\r\n", 400],
  ["empty Host", "GET / HTTP/1.1\r\nHost:\r\n", 400],
  ["spaces in Host", "GET / HTTP/1.1\r\nHost: a b\r\n", 400],
  ["userinfo in Host", "GET / HTTP/1.1\r\nHost: a@evil.com\r\n", 400],
  ["path in Host", "GET / HTTP/1.1\r\nHost: evil.com/x\r\n", 400],
  ["query in Host", "GET / HTTP/1.1\r\nHost: evil.com?x\r\n", 400],
  ["path and query in Host", "GET / HTTP/1.1\r\nHost: evil.com/x?y\r\n", 400],
  ["invalid IPv6 Host", "GET / HTTP/1.1\r\nHost: [:::1]\r\n", 400],
  ["port out of range", "GET / HTTP/1.1\r\nHost: evil.com:65536\r\n", 400],
  ["non-numeric port", "GET / HTTP/1.1\r\nHost: evil.com:abc\r\n", 400],
  ["mismatched absolute target", "GET http://evil.com/x HTTP/1.1\r\nHost: good.com\r\n", 400],
  ["matching absolute target", "GET http://good.com/x HTTP/1.1\r\nHost: good.com\r\n", 400],

  ["fragment target", "GET /path#fragment HTTP/1.1\r\nHost: good.com\r\n", 400],
  ["asterisk target", "OPTIONS * HTTP/1.1\r\nHost: good.com\r\n", 501],
  ["TRACE", "TRACE / HTTP/1.1\r\nHost: good.com\r\n", 501],
  ["CONNECT", "CONNECT good.com:443 HTTP/1.1\r\nHost: good.com:443\r\n", 501],
])("rejects %s before calling the handler", async (_name, request, status) => {
  let calls = 0;
  const host = await serve(async () => {
    calls++;
    return new Response("should not run");
  }, local);
  try {
    const wire = await exchange(host.url, request);
    const message = status === 400 ? "Bad Request" : "Not Implemented";
    expect(wire).toContain(`HTTP/1.1 ${status} ${message}\r\n`);
    expect(wire).toContain("content-type: text/plain; charset=utf-8\r\n");
    expect(wire.split("\r\n\r\n")[1]).toBe(message);
    expect(calls).toBe(0);
  } finally {
    await host.close();
  }
});

it.each([
  ["[::1]:8080", "/ipv6", "http://[::1]:8080/ipv6"],
  ["good.com:8080", "/path?x=1", "http://good.com:8080/path?x=1"],
  ["good.com", "//evil.com/path", "http://good.com//evil.com/path"],
])("preserves a valid Host %s and request target %s", async (authority, target, url) => {
  const host = await serve(async (request) => new Response(request.url), local);
  try {
    const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
      const client = httpRequest(host.url, { path: target, headers: { host: authority } }, resolve);
      client.on("error", reject);
      client.end();
    });
    let body = "";
    for await (const chunk of response) body += chunk;
    expect(response.statusCode).toBe(200);
    expect(body).toBe(url);
  } finally {
    await host.close();
  }
});

it("Node rejects a relative target with 400 and no details before the handler", async () => {
  let calls = 0;
  const host = await serve(async () => {
    calls++;
    return new Response("should not run");
  }, local);
  try {
    const wire = await exchange(host.url, "GET path HTTP/1.1\r\nHost: good.com\r\n");
    expect(wire).toContain("HTTP/1.1 400 Bad Request\r\n");
    expect(wire.split("\r\n\r\n")[1]).toBe("");
    expect(calls).toBe(0);
  } finally {
    await host.close();
  }
});

it("joins repeated Cookie headers with semicolons, not commas", async () => {
  const host = await serve(async (request) => {
    expect(request.headers.get("cookie")).toBe("a=1; b=2; c=3");
    return new Response(null, { status: 204 });
  }, local);
  try {
    const wire = await exchange(
      host.url,
      "GET / HTTP/1.1\r\nHost: good.com\r\nCookie: a=1\r\ncookie: b=2\r\nCookie: c=3\r\n",
    );
    expect(wire).toContain("HTTP/1.1 204 No Content\r\n");
  } finally {
    await host.close();
  }
});

it("a stream failure before the first byte answers a plain 500", async () => {
  const host = await serve(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("private stream detail"));
          },
        }),
        { status: 201, headers: { "x-private": "must be removed" } },
      ),
    local,
  );
  try {
    const response = await fetch(host.url);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-private")).toBeNull();
    expect(await response.text()).toBe("Internal Server Error");
  } finally {
    await host.close();
  }
});
