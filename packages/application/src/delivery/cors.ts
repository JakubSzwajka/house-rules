import { Effect, Layer } from "effect";
import { FindMyWay, HttpRouter, HttpServerResponse } from "effect/http";
import { requestIdHeader } from "../call/request-id.ts";
import { failureCodeHeader, type Method } from "../contract/endpoint.ts";
import { isHttpOrigin } from "./csrf.ts";
import type { Route } from "./route.ts";

export type CorsOptions = Readonly<{ origins: ReadonlyArray<string>; maxAge?: number }>;

export type Cors = Readonly<{ origins: ReadonlySet<string>; maxAge: number }>;

export const defaultCorsMaxAge = 600;

export const corsAllowedHeaders = ["authorization", "content-type", requestIdHeader] as const;

export const corsExposedHeaders = [failureCodeHeader, requestIdHeader] as const;

export const checkCors = (options: CorsOptions | undefined): Cors | undefined => {
  if (options === undefined) return undefined;
  // Mount time, not a request: a bad allow-list would open the API to the wrong pages.
  if (options.origins.length === 0) {
    throw new TypeError("cors: origins is empty; name the web app's origin or drop cors");
  }
  for (const origin of options.origins) {
    if (!isHttpOrigin(origin)) {
      throw new TypeError(`cors: ${JSON.stringify(origin)} is not an http(s) origin`);
    }
  }
  const maxAge = options.maxAge ?? defaultCorsMaxAge;
  if (!Number.isSafeInteger(maxAge) || maxAge < 0) {
    throw new TypeError(`cors: maxAge ${String(maxAge)} is not a whole number of seconds`);
  }
  return { origins: new Set(options.origins), maxAge };
};

const preflightKey = (path: string): `/${string}` =>
  // Two routes may name one place with different parameter names; the router takes one OPTIONS route there.
  path.replace(/:[A-Za-z_][A-Za-z0-9_]*/gu, ":param") as `/${string}`;

export const preflightRoutes = (
  cors: Cors | undefined,
  routes: ReadonlyArray<Route>,
  prefix: string,
): Layer.Layer<never, never, HttpRouter.HttpRouter> => {
  if (cors === undefined) return Layer.empty;
  const keys = new Set<`/${string}`>();
  const methods = new Set<Method>();
  // The same matcher and defaults as the router, so case and slashes match the same way.
  const matcher = FindMyWay.make<Method>();
  for (const each of routes) {
    keys.add(preflightKey(`${prefix}${each.path}`));
    methods.add(each.method);
    matcher.on(each.method, `${prefix}${each.path}` as `/${string}`, each.method);
  }
  // A concrete path may match a literal route and a parameterized one; the preflight names both.
  const allowedAt = (url: string): ReadonlyArray<Method> =>
    [...methods].filter((method) => matcher.find(method, url) !== undefined);
  const layers = [...keys].map((path) =>
    HttpRouter.add("OPTIONS", path, (request) =>
      Effect.sync(() => {
        const origin = request.headers.origin;
        // An unlisted page learns nothing: no CORS headers, so its browser refuses the call.
        if (origin === undefined || !cors.origins.has(origin)) {
          return HttpServerResponse.empty({ status: 403 });
        }
        return HttpServerResponse.empty({
          status: 204,
          headers: {
            "access-control-allow-methods": allowedAt(request.url).join(", "),
            "access-control-allow-headers": corsAllowedHeaders.join(", "),
            "access-control-max-age": String(cors.maxAge),
          },
        });
      }),
    ),
  );
  const [first, ...rest] = layers;
  return first === undefined ? Layer.empty : Layer.mergeAll(first, ...rest);
};

export const withCors = (cors: Cors, request: Request, response: Response): Response => {
  const headers = new Headers(response.headers);
  // A cache must not hand one origin's answer to another.
  headers.append("vary", "Origin");
  const origin = request.headers.get("origin");
  if (origin !== null && cors.origins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-expose-headers", corsExposedHeaders.join(", "));
  }
  // This workspace loads two @types/node versions, so tsc sees the Response constructor and the Response type differ.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }) as Response;
};
