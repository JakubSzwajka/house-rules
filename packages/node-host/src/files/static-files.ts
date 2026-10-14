import {
  type BigIntStats,
  constants,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";

export type StaticFilesOptions = Readonly<{
  root: string;
  exclude: ReadonlyArray<`/${string}`>;
  index?: string;
  immutable?: (path: string) => boolean;
}>;

export type StaticFiles = (request: Request) => Promise<Response | undefined>;

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

const immutableCache = "public, max-age=31536000, immutable";

const viteHashedName = /-(?=[A-Za-z0-9_-]*[A-Z0-9])[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9]+)+$/u;

const defaultImmutable = (path: string): boolean =>
  path.startsWith("/assets/") && viteHashedName.test(path.slice(path.lastIndexOf("/") + 1));

const encodedSeparator = /%(?:2f|5c|00)/iu;

const excludeShape = /^\/[^?#%\\]*[^/?#%\\]$/u;

const refuse = (why: string): TypeError => new TypeError(`staticFiles: ${why}`);

type FileId = Readonly<{ dev: bigint; ino: bigint }>;

type Tree = Readonly<{ files: ReadonlyMap<string, FileId>; refused: ReadonlySet<string> }>;

const directoryOf = (root: string): string => {
  try {
    if (!statSync(root).isDirectory())
      throw refuse(`root ${JSON.stringify(root)} is not a directory`);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw refuse(`root ${JSON.stringify(root)} does not exist; build the web app first`);
  }
  return root;
};

const walk = (root: string): Tree => {
  const files = new Map<string, FileId>();
  const refused = new Set<string>();
  const visit = (folder: string, at: string): void => {
    for (const name of readdirSync(folder)) {
      const path = `${at}/${name}`;
      // lstat, so a symlink is seen as one and never followed.
      const stats = lstatSync(join(folder, name), { bigint: true });
      if (name.startsWith(".") || stats.isSymbolicLink()) refused.add(path);
      else if (stats.isDirectory()) visit(join(folder, name), path);
      else if (stats.isFile()) files.set(path, { dev: stats.dev, ino: stats.ino });
      else refused.add(path);
    }
  };
  visit(root, "");
  return { files, refused };
};

const checkedOptions = (options: StaticFilesOptions) => {
  const index = options.index ?? "index.html";
  if (index === "" || index.startsWith(".") || /[/\\\0]/u.test(index)) {
    throw refuse(`index ${JSON.stringify(index)} must be a plain file name in root`);
  }
  for (const prefix of options.exclude) {
    const segments = prefix.split("/").slice(1);
    if (!excludeShape.test(prefix) || segments.some((each) => each === "" || each === "..")) {
      throw refuse(`exclude ${JSON.stringify(prefix)} must be a plain path such as "/api"`);
    }
  }
  const root = realpathSync(directoryOf(resolve(options.root)));
  const tree = walk(root);
  if (tree.refused.has(`/${index}`)) {
    throw refuse(`${index} in ${JSON.stringify(root)} is not a regular file`);
  }
  if (!tree.files.has(`/${index}`)) throw refuse(`root ${JSON.stringify(root)} has no ${index}`);
  // The API router ignores case and repeated slashes, so the reserved check does too.
  return { root, index, tree, exclude: options.exclude.map((each) => each.toLowerCase()) };
};

const routerSpelling = (path: string): string =>
  // The router also ends the path at the first `;`.
  (path.split(";", 1)[0] ?? path).replace(/\/{2,}/gu, "/").toLowerCase();

const reserved = (exclude: ReadonlyArray<string>, path: string): boolean => {
  const spelled = routerSpelling(path);
  return exclude.some((prefix) => spelled === prefix || spelled.startsWith(`${prefix}/`));
};

const decodedOnce = (path: string): string | undefined => {
  try {
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
};

const safeSegments = (path: string): boolean =>
  // Dot segments, dotfiles, NUL and backslashes never name a file the site serves.
  !/[\0\\]/u.test(path) &&
  path
    .split("/")
    .slice(1)
    .every((segment, at, all) =>
      segment === "" ? at === all.length - 1 : !segment.startsWith("."),
    );

const underRefused = (refused: ReadonlySet<string>, path: string): boolean => {
  let at = "";
  for (const segment of path.split("/").slice(1)) {
    if (segment === "") break;
    at = `${at}/${segment}`;
    if (refused.has(at)) return true;
  }
  return false;
};

const plain = (status: 404, method: string): Response =>
  new Response(method === "HEAD" ? null : "Not Found", {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });

const etagOf = (stats: BigIntStats): string =>
  `W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;

const opaqueTag = (tag: string): string => tag.trim().replace(/^W\//u, "");

const fresh = (request: Request, etag: string): boolean => {
  // If-None-Match uses the weak comparison: W/"x" and "x" match.
  const header = request.headers.get("if-none-match");
  if (header === null) return false;
  const ours = opaqueTag(etag);
  return header.split(",").some((each) => each.trim() === "*" || opaqueTag(each) === ours);
};

const send = async (
  request: Request,
  handle: FileHandle,
  stats: BigIntStats,
  file: string,
  cache: string,
): Promise<Response> => {
  const etag = etagOf(stats);
  const headers = new Headers({
    "content-type": contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": cache,
    etag,
    "last-modified": stats.mtime.toUTCString(),
    "x-content-type-options": "nosniff",
  });
  if (fresh(request, etag)) {
    await handle.close();
    return new Response(null, { status: 304, headers });
  }
  headers.set("content-length", stats.size.toString());
  if (request.method === "HEAD") {
    await handle.close();
    return new Response(null, { status: 200, headers });
  }
  const body = Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;
  return new Response(body, { status: 200, headers });
};

const openListed = async (
  root: string,
  id: FileId,
  path: string,
): Promise<{ handle: FileHandle; stats: BigIntStats } | undefined> => {
  let handle: FileHandle;
  try {
    handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return undefined;
  }
  // A parent swapped for a symlink after the walk opens some other file; its identity gives it away.
  const stats = await handle.stat({ bigint: true });
  if (stats.isFile() && stats.dev === id.dev && stats.ino === id.ino) return { handle, stats };
  await handle.close();
  return undefined;
};

const qParam = /^q\s*=/u;

const htmlQuality = (accept: string): number => {
  // The most specific range that covers text/html decides: text/html, then text/*, then */*.
  let rank = -1;
  let quality = 0;
  for (const range of accept.split(",")) {
    const [type = "", ...params] = range.split(";").map((each) => each.trim().toLowerCase());
    const at = ["*/*", "text/*", "text/html"].indexOf(type);
    if (at < 0 || at < rank) continue;
    // A range with parameters before q needs a match; our UTF-8 HTML has none to offer.
    if (params.length > 0 && !qParam.test(params[0] ?? "")) continue;
    const q = params.flatMap((each) => /^q\s*=\s*([0-9.]+)$/u.exec(each)?.[1] ?? [])[0];
    const value = q === undefined ? 1 : Number(q);
    quality = at > rank ? value : Math.max(quality, value);
    rank = at;
  }
  return Number.isFinite(quality) ? quality : 0;
};

const wantsPage = (request: Request, path: string): boolean =>
  extname(path.slice(path.lastIndexOf("/") + 1)) === "" &&
  htmlQuality(request.headers.get("accept") ?? "") > 0;

export const staticFiles = (options: StaticFilesOptions): StaticFiles => {
  const { root, index, tree, exclude } = checkedOptions(options);
  const immutable = options.immutable ?? defaultImmutable;
  const indexPath = `/${index}`;
  const serve = async (request: Request, name: string, cache: string) => {
    const id = tree.files.get(name);
    const found = id === undefined ? undefined : await openListed(root, id, name);
    return found === undefined
      ? plain(404, request.method)
      : send(request, found.handle, found.stats, name, cache);
  };
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return undefined;
    const raw = new URL(request.url).pathname;
    const spelled = decodedOnce(raw);
    // The caller's reserved paths are never ours, however they are spelled.
    if (reserved(exclude, raw) || (spelled !== undefined && reserved(exclude, spelled))) {
      return undefined;
    }
    // An encoded slash, backslash or NUL would change which file the decoded path names.
    const path = encodedSeparator.test(raw) ? undefined : spelled;
    if (path === undefined || !safeSegments(path)) return plain(404, request.method);
    // A symlink or other refused entry is a 404, never the page: it is not a missing file.
    if (underRefused(tree.refused, path)) return plain(404, request.method);
    const name = path === "/" ? indexPath : path;
    if (tree.files.has(name)) {
      const cache = name !== indexPath && immutable(name) ? immutableCache : "no-cache";
      return serve(request, name, cache);
    }
    if (!wantsPage(request, path)) return plain(404, request.method);
    return serve(request, indexPath, "no-cache");
  };
};
