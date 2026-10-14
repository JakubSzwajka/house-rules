import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { staticFiles } from "../index.ts";

const temp = mkdtempSync(join(tmpdir(), "static-files-"));
const root = join(temp, "dist");
mkdirSync(join(root, "assets"), { recursive: true });
mkdirSync(join(root, "docs"));
writeFileSync(join(root, "index.html"), "<!doctype html><p>page</p>");
writeFileSync(join(root, "assets", "app-Bx12cd34.js"), "console.log(1);");
writeFileSync(join(root, "assets", "app-Bx12cd34.css"), "p{}");
writeFileSync(join(root, "logo.svg"), "<svg/>");
writeFileSync(join(root, "robots.txt"), "User-agent: *");
writeFileSync(join(root, ".env"), "SECRET=1");
writeFileSync(join(temp, "outside.txt"), "outside");
symlinkSync(join(temp, "outside.txt"), join(root, "escape.txt"));
writeFileSync(join(root, "assets", "plain.js"), "plain();");
writeFileSync(join(root, "assets", "my-component.js"), "component();");
mkdirSync(join(root, "sub"));
writeFileSync(join(root, "sub", "file.txt"), "inside sub");
mkdirSync(join(temp, "elsewhere"));
writeFileSync(join(temp, "elsewhere", "file.txt"), "OUTSIDE_RACE");
symlinkSync(join(root, "robots.txt"), join(root, "inside.txt"));
symlinkSync(join(root, ".env"), join(root, "alias.txt"));
symlinkSync(join(temp, "elsewhere"), join(root, "dirEscape"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const files = staticFiles({ root, exclude: ["/api", "/mcp", "/.well-known"] });

writeFileSync(join(root, "late.txt"), "added after construction");

const html = { accept: "text/html,application/xhtml+xml" };

const get = (path: string, init: RequestInit = {}) =>
  files(new Request(`http://app.example${path}`, init) as Request);

const textOf = async (response: Response | undefined) => {
  if (response === undefined) throw new Error("Expected a response");
  return { status: response.status, headers: response.headers, body: await response.text() };
};

describe("serving files", () => {
  it("serves a file with its content type and a validator", async () => {
    const r = await textOf(await get("/logo.svg"));
    expect(r.status).toBe(200);
    expect(r.body).toBe("<svg/>");
    expect(r.headers.get("content-type")).toBe("image/svg+xml");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("etag")).toMatch(/^W\/"/u);
    const again = await get("/logo.svg", {
      headers: { "if-none-match": r.headers.get("etag") ?? "" },
    });
    expect(again?.status).toBe(304);
  });

  it("If-None-Match uses the weak comparison, lists and *", async () => {
    const etag = (await get("/logo.svg"))?.headers.get("etag") ?? "";
    const strong = etag.replace(/^W\//u, "");
    for (const header of [strong, `"other", ${etag}`, `W/"other", ${strong}`, "*"]) {
      expect((await get("/logo.svg", { headers: { "if-none-match": header } }))?.status).toBe(304);
    }
    for (const header of ['"other"', 'W/"other"', ""]) {
      expect((await get("/logo.svg", { headers: { "if-none-match": header } }))?.status).toBe(200);
    }
  });

  it.each([
    ["/assets/app-Bx12cd34.js", "text/javascript; charset=utf-8"],
    ["/assets/app-Bx12cd34.css", "text/css; charset=utf-8"],
    ["/robots.txt", "text/plain; charset=utf-8"],
    ["/", "text/html; charset=utf-8"],
  ])("%s is %s", async (path, type) => {
    expect((await get(path))?.headers.get("content-type")).toBe(type);
  });

  it("hashed assets are immutable; the page and other files revalidate", async () => {
    expect((await get("/assets/app-Bx12cd34.js"))?.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    for (const path of [
      "/",
      "/index.html",
      "/robots.txt",
      "/assets/plain.js",
      "/assets/my-component.js",
    ]) {
      expect((await get(path))?.headers.get("cache-control")).toBe("no-cache");
    }
    expect((await get("/bookings/b-1", { headers: html }))?.headers.get("cache-control")).toBe(
      "no-cache",
    );
  });

  it("an immutable option replaces the hashed-asset rule", async () => {
    const own = staticFiles({ root, exclude: [], immutable: (path) => path.endsWith(".svg") });
    const at = (path: string) => own(new Request(`http://app.example${path}`) as Request);
    expect((await at("/logo.svg"))?.headers.get("cache-control")).toContain("immutable");
    expect((await at("/assets/app-Bx12cd34.js"))?.headers.get("cache-control")).toBe("no-cache");
  });

  it("HEAD answers the headers with no body", async () => {
    const r = await get("/assets/app-Bx12cd34.js", { method: "HEAD" });
    expect(r?.status).toBe(200);
    expect(r?.body).toBeNull();
    expect(r?.headers.get("content-length")).toBe("15");
    const page = await get("/bookings", { method: "HEAD", headers: html });
    expect(page?.status).toBe(200);
    expect(page?.body).toBeNull();
  });
});

describe("what is not ours", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "%s is left to the next handler",
    async (method) => {
      expect(await get("/index.html", { method })).toBeUndefined();
    },
  );

  it.each([
    "/api",
    "/api/bookings",
    "/mcp",
    "/.well-known/oauth-protected-resource",
    "/%61pi/bookings",
    "/api%2fbookings",
    "/API/bookings/b-1",
    "/Mcp",
    "//api/bookings",
    "/api;x/bookings",
  ])("reserved path %s is left to the next handler, even for a page", async (path) => {
    expect(await get(path, { headers: html })).toBeUndefined();
  });

  it("the static-first chain hands /API/bookings/b-1 to the API, as the router matches case", async () => {
    const seen: Array<string> = [];
    const api = (request: Request) => {
      seen.push(new URL(request.url).pathname);
      return Promise.resolve(new Response("API"));
    };
    const handle = async (request: Request) => (await files(request)) ?? api(request);
    const r = await handle(
      new Request("http://app.example/API/bookings/b-1", { headers: html }) as Request,
    );
    expect(await r.text()).toBe("API");
    expect(seen).toEqual(["/API/bookings/b-1"]);
  });

  it("a path that only starts with a reserved name is still ours", async () => {
    expect((await get("/apix", { headers: html }))?.status).toBe(200);
  });
});

describe("paths never leave root", () => {
  it.each([
    "/%2e%2e/outside.txt",
    "/assets/%2e%2e/%2e%2e/outside.txt",
    "/..%2foutside.txt",
    "/..%5coutside.txt",
    "/%5c..%5coutside.txt",
    "/robots.txt%00.js",
    "/escape.txt",
    "/inside.txt",
    "/alias.txt",
    "/dirEscape",
    "/dirEscape/",
    "/dirEscape/file.txt",
    "/.env",
    "/%2eenv",
    "/assets%2fapp-Bx12cd34.js",
    "/%E0%A4%A",
  ])("%s is a 404 and never the page", async (path) => {
    const r = await textOf(await get(path, { headers: html }));
    expect(r.status).toBe(404);
    expect(r.body).toBe("Not Found");
  });

  it("dot segments the URL parser resolves stay inside root", async () => {
    const r = await textOf(await get("/assets/../../outside.txt"));
    expect(r.status).toBe(404);
  });

  it("a parent folder swapped for a symlink after construction is a 404", async () => {
    const own = staticFiles({ root, exclude: [] });
    const at = (path: string) => own(new Request(`http://app.example${path}`) as Request);
    expect((await textOf(await at("/sub/file.txt"))).body).toBe("inside sub");
    renameSync(join(root, "sub"), join(temp, "sub-moved"));
    symlinkSync(join(temp, "elsewhere"), join(root, "sub"));
    try {
      const r = await textOf(await at("/sub/file.txt"));
      expect(r.status).toBe(404);
      expect(r.body).not.toContain("OUTSIDE");
    } finally {
      rmSync(join(root, "sub"));
      renameSync(join(temp, "sub-moved"), join(root, "sub"));
    }
  });

  it("a file added after construction is not served", async () => {
    expect((await get("/late.txt"))?.status).toBe(404);
  });
});

describe("page fallback", () => {
  it("a page route that accepts HTML gets index.html", async () => {
    const r = await textOf(await get("/bookings/b-1", { headers: html }));
    expect(r.status).toBe(200);
    expect(r.body).toContain("page");
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect((await get("/docs", { headers: html }))?.status).toBe(200);
    expect((await get("/docs/", { headers: html }))?.status).toBe(200);
  });

  it("a request that does not accept HTML gets a 404", async () => {
    expect((await get("/bookings/b-1", { headers: { accept: "application/json" } }))?.status).toBe(
      404,
    );
    expect((await get("/bookings/b-1"))?.status).toBe(404);
  });

  it.each([
    ["text/html", 200],
    ["*/*", 200],
    ["text/*;q=0.5", 200],
    ["application/json, */*;q=0.1", 200],
    ["TEXT/HTML ; Q=0.8", 200],
    ["text/html;q=0", 404],
    ["text/html;q=0, */*", 404],
    ["*/*;q=0", 404],
    ["text/html;charset=iso-8859-1;q=1, text/html;q=0", 404],
    ["text/html;q=0, text/html;charset=iso-8859-1;q=1", 404],
    ["text/html;level=1, */*;q=0", 404],
    ["text/html;charset=iso-8859-1;q=1, text/html;q=0.5", 200],
    ["text/html;charset=iso-8859-1, */*;q=0.1", 200],
    ["nottext/html", 404],
    ["application/json", 404],
  ])("Accept %j for a page route is a %i", async (accept, status) => {
    expect((await get("/bookings/b-1", { headers: { accept } }))?.status).toBe(status);
  });

  it("a missing file with an extension is a 404, not the page", async () => {
    expect((await get("/assets/gone-9z.js", { headers: html }))?.status).toBe(404);
    expect((await get("/favicon.ico", { headers: html }))?.status).toBe(404);
  });
});

describe("construction", () => {
  it("a missing root fails clearly", () => {
    expect(() => staticFiles({ root: join(temp, "nope"), exclude: [] })).toThrow(
      /root ".*nope" does not exist/u,
    );
  });

  it("a root that is a file, or holds no index, fails", () => {
    expect(() => staticFiles({ root: join(root, "robots.txt"), exclude: [] })).toThrow(
      /is not a directory/u,
    );
    expect(() => staticFiles({ root: join(root, "assets"), exclude: [] })).toThrow(
      /has no index\.html/u,
    );
  });

  it.each(["api", "/", "/api/", "/a/../b", "/a?b", "/a%2f", "/a//b"])(
    "exclude %s is refused",
    (prefix) => {
      expect(() => staticFiles({ root, exclude: [prefix as `/${string}`] })).toThrow(/exclude/u);
    },
  );

  it.each(["", "../index.html", "a/index.html", ".index"])("index %j is refused", (index) => {
    expect(() => staticFiles({ root, exclude: [], index })).toThrow(/index/u);
  });

  it("an index that is a symlink fails, inside or out of root", () => {
    const linked = join(temp, "linked");
    mkdirSync(linked);
    symlinkSync(join(temp, "outside.txt"), join(linked, "index.html"));
    expect(() => staticFiles({ root: linked, exclude: [] })).toThrow(/is not a regular file/u);
    expect(() => staticFiles({ root, exclude: [], index: "inside.txt" })).toThrow(
      /is not a regular file/u,
    );
  });
});
