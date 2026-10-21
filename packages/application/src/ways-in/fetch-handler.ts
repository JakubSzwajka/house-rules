import { Effect, Layer, Result } from "effect";
import { FindMyWay, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { requestIdHeader, withRequestId } from "../call/request-id.ts";
import { failureCodeHeader } from "../contract/endpoint.ts";
import type { Incoming } from "./caller.ts";
import { type AnyWay, validateWays } from "./way-validation.ts";
import { makeMcpHandler } from "./mcp-handler.ts";
import { type Composition, serveIn } from "./composition.ts";
import { checkCors, preflightRoutes, withCors } from "./cors.ts";
import { csrfRefusal, isHttpOrigin } from "./csrf.ts";
import { arrayKeysOf } from "./input.ts";
import {
  closedFailure,
  invoke,
  layerFailure,
  logDefect,
  type Outcome,
  requestIdFor,
} from "./invoke.ts";
import type { Endpoint } from "../contract/endpoint.ts";
import { rawInput } from "./route-input.ts";
import { checkSession, clearedCookie, issueSession } from "./session-cookie.ts";
import { internalErrorView, safeViewOf, type View } from "./views.ts";

export const defaultMaxBodyBytes = 1024 * 1024;

import type { FetchHandler } from "./mount-check.ts";

const publicHeaders = (route: Endpoint, view: View): View["headers"] => {
  // Only a code the view opted in to and the endpoint declares goes out, never the error's tag.
  const headers = Object.entries(view.headers ?? {}).filter(
    ([name]) => name.toLowerCase() !== failureCodeHeader,
  );
  const { code } = view;
  const declared =
    code !== undefined && view.status >= 400 && view.status < 500 && route.codes.includes(code);
  return Object.fromEntries(declared ? [...headers, [failureCodeHeader, code]] : headers);
};

const respond = (
  status: number,
  body: unknown,
  requestId: string,
  headers: View["headers"] = {},
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "cache-control": "no-store", ...headers, [requestIdHeader]: requestId },
  });

const makeHttpHandler = <A, E>(
  app: Composition<A, E>,
  options: Extract<AnyWay<A>, { protocol: "http" }>,
): FetchHandler => {
  const prefix = options.path === "/" ? "" : options.path;
  const limit = options.maxBodyBytes ?? defaultMaxBodyBytes;
  for (const origin of options.origins ?? []) {
    if (!isHttpOrigin(origin)) {
      // Mount time, not a request: a bad origins list would refuse or admit the wrong writes.
      throw new TypeError(`origins: ${JSON.stringify(origin)} is not an http(s) origin`);
    }
  }
  const cors = checkCors(options.cors);
  const session = checkSession(options.session, options.endpoints);
  const serve = (route: Endpoint) => {
    const arrayKeys = arrayKeysOf(route.feature.input);
    return HttpRouter.add(route.method, `${prefix}${route.path}`, (request) =>
      Effect.gen(function* serveRoute() {
        const params = yield* HttpRouter.params;
        const requestId = yield* requestIdFor(request.headers[requestIdHeader] ?? null);
        const answer = Effect.gen(function* answerRequest() {
          const web = HttpServerRequest.toWebResult(request);
          if (Result.isFailure(web)) return yield* Effect.die(web.failure);
          const incoming: Incoming = { headers: web.success.headers, url: web.success.url };
          const refused = csrfRefusal(route, web.success, options.origins);
          if (refused !== undefined) {
            const view = yield* safeViewOf(options.overrides, refused, true);
            return respond(view.status, view.body, requestId, publicHeaders(route, view));
          }
          const outcome = yield* serveIn<A, Outcome<unknown, unknown>>(app, {
            ready: (context) =>
              invoke(app, context, route.feature, {
                way: options,
                incoming,
                input: rawInput(route, arrayKeys, request, web.success, params, limit),
                channel: "web",
                approval: options.mean.approval,
                // An issue route encodes after the token is taken out for the cookie.
                encodeOutput: route.session !== "issue",
              }).pipe(withRequestId(requestId)),
            failed: (cause) => layerFailure(options.overrides, cause),
            closed: closedFailure(options.overrides),
          });
          // A sign-out clears the cookie whatever the capability answered.
          const cleared =
            route.session === "clear" && session !== undefined
              ? { "set-cookie": clearedCookie(session, web.success) }
              : {};
          if (!outcome.ok) {
            const headers = { ...publicHeaders(route, outcome.view), ...cleared };
            return respond(outcome.view.status, outcome.view.body, requestId, headers);
          }
          if (route.session !== "issue") {
            return respond(route.status, outcome.value, requestId, cleared);
          }
          // checkSession refused this mount already; never fall back to a body with the token.
          if (session === undefined) return yield* Effect.die("session route without a cookie");
          const issued = yield* issueSession(session, route, web.success, outcome.value);
          return issued === undefined
            ? respond(internalErrorView.status, internalErrorView.body, requestId)
            : respond(route.status, issued.body, requestId, { "set-cookie": issued.setCookie });
        });
        // One boundary for the whole request: a defect anywhere is the fixed 500 with this request id.
        return yield* answer.pipe(
          Effect.catchCause((cause) =>
            logDefect(app, "Delivery failed", cause).pipe(
              Effect.as(respond(internalErrorView.status, internalErrorView.body, requestId)),
            ),
          ),
          withRequestId(requestId),
        );
      }),
    );
  };
  const routes = Layer.mergeAll(
    preflightRoutes(cors, options.endpoints, prefix),
    ...options.endpoints.map(serve),
  );
  // Each handler builds its own router. Sharing one would let this handler answer another's routes.
  const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
  const answer = (request: Request) =>
    cors === undefined
      ? handler(request)
      : handler(request).then((response) => withCors(cors, request, response));
  return Object.assign(answer, { dispose });
};

export const toFetchHandler = <A, E>(app: Composition<A, E>): FetchHandler => {
  const invalid = validateWays(app.features, app.ways);
  const handlers = new Map<AnyWay<A>, FetchHandler>();
  const matcher = FindMyWay.make<AnyWay<A>>();
  if (invalid === undefined) {
    const preflights = new Set<string>();
    for (const way of app.ways) {
      if (way.protocol === "mcp") {
        matcher.all(way.path, way);
        continue;
      }
      for (const shape of way.endpoints) {
        const path = `${way.path === "/" ? "" : way.path}${shape.path}` as `/${string}`;
        matcher.on(shape.method, path, way);
        const key = path.toLowerCase().replace(/\/:[^/]+/gu, "/:");
        if (way.cors !== undefined && !preflights.has(key)) {
          matcher.on("OPTIONS", path, way);
          preflights.add(key);
        }
      }
    }
  }
  let closed = false;
  const serve = (request: Request): Promise<Response> => {
    if (closed)
      return Effect.runPromise(requestIdFor(request.headers.get(requestIdHeader))).then(
        (requestId) =>
          Response.json(
            { error: { code: "unavailable", message: "Try again shortly." } },
            {
              status: 503,
              headers: { "cache-control": "no-store", [requestIdHeader]: requestId },
            },
          ) as Response,
      );
    const path = new URL(request.url).pathname;
    const metadataWay = app.ways.find(
      (way) =>
        way.protocol === "mcp" &&
        way.resource.paths.some((each) => each.toLowerCase() === path.toLowerCase()),
    );
    if (metadataWay?.protocol === "mcp" && invalid === undefined)
      return metadataWay.resource.handler(request);
    const way =
      metadataWay ??
      matcher.find(request.method, path)?.handler ??
      [...app.ways]
        .sort((a, b) => b.path.length - a.path.length)
        .find(
          (candidate) =>
            (candidate.protocol === "http" || invalid !== undefined) &&
            (path.toLowerCase() === candidate.path.toLowerCase() ||
              path
                .toLowerCase()
                .startsWith(`${candidate.path === "/" ? "" : candidate.path.toLowerCase()}/`)),
        );
    if (way === undefined) return Promise.resolve(new Response(null, { status: 404 }) as Response);
    if (invalid !== undefined) {
      return Effect.runPromise(
        serveIn(app, {
          ready: () => Effect.succeed(internalErrorView),
          failed: (cause) =>
            Effect.map(layerFailure(way.overrides, cause), (failure) =>
              failure.ok ? internalErrorView : failure.view,
            ),
          closed: Effect.map(closedFailure(way.overrides), (failure) =>
            failure.ok ? internalErrorView : failure.view,
          ),
        }),
      ).then(
        (result) =>
          Response.json(result.body, {
            status: result.status,
            ...(result.headers === undefined ? {} : { headers: result.headers }),
          }) as Response,
      );
    }
    let handler = handlers.get(way);
    if (handler === undefined) {
      handler = way.protocol === "http" ? makeHttpHandler(app, way) : makeMcpHandler(app, way);
      handlers.set(way, handler);
    }
    return handler(request);
  };
  let disposing: Promise<void> | undefined;
  return Object.assign(serve, {
    dispose: () => {
      if (disposing === undefined) {
        closed = true;
        disposing = Promise.all([...handlers.values()].map((handler) => handler.dispose())).then(
          () => undefined,
        );
      }
      return disposing;
    },
  });
};
