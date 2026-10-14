import { writeMethods } from "../contract/endpoint.ts";
import { Refused } from "./caller.ts";
import type { Route } from "./route.ts";

const crossOrigin = new Refused({
  status: 403,
  code: "cross_origin",
  message: "A write must come from the app's own origin.",
});

export const isHttpOrigin = (origin: string): boolean =>
  URL.canParse(origin) &&
  ["http:", "https:"].includes(new URL(origin).protocol) &&
  new URL(origin).origin === origin;

const sourceOrigin = (request: Request): string | null => {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin;
  const referer = request.headers.get("referer");
  if (referer === null) return null;
  return URL.canParse(referer) ? new URL(referer).origin : null;
};

export const csrfRefusal = (
  route: Route,
  request: Request,
  origins: ReadonlyArray<string> | undefined,
): Refused | undefined => {
  if (route.csrf !== "check" || !writeMethods.has(route.method)) return undefined;
  // A browser attaches cookies to a cross-site write by itself, whoever the caller is.
  if (!request.headers.has("cookie")) return undefined;
  const allowed = origins ?? [new URL(request.url).origin];
  const source = sourceOrigin(request);
  // An opaque source, such as a sandboxed frame or a data: URL, is never the app's own.
  return source !== null && source !== "null" && allowed.includes(source) ? undefined : crossOrigin;
};
