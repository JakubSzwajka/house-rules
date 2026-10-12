import { Effect, Layer, Result } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { requestIdHeader, withRequestId } from "../call/request-id.ts";
import {
  type Endpoint,
  type EndpointShape,
  failureCodeHeader,
  type Method,
  parseAt,
  writeMethods,
} from "../contract/endpoint.ts";
import { Approval } from "../gates/approval.ts";
import { type Caller, type Incoming, Refused } from "./caller.ts";
import { type Composition, serveIn } from "./composition.ts";
import { arrayKeysOf, fieldName, InputFault, pathParamAsJson } from "./input.ts";
import {
  type ApprovalOption,
  closedFailure,
  invoke,
  layerFailure,
  logDefect,
  type Mountable,
  type Outcome,
  type RawInput,
  requestIdFor,
} from "./invoke.ts";
import type { MountCheck } from "./mount-check.ts";
import { givenTwice, parseObject, readCapped } from "./request-body.ts";
import { defaultViews, internalErrorView, safeViewOf, type View, type ViewTable } from "./views.ts";

export type CsrfOptOut = Readonly<{ skip: true; reason: string }>;

export type RouteOptions = Readonly<{ status?: number; csrf?: CsrfOptOut }>;

export type Route<Cap extends Mountable = Mountable> = EndpointShape<Cap["contract"]> &
  Readonly<{
    _tag: "Route";
    capability: Cap;
    csrf: "check" | CsrfOptOut;
  }>;

export const defaultMaxBodyBytes = 1024 * 1024;

const placeOf = (
  capability: Mountable,
  at: `${Method} /${string}` | Endpoint | undefined,
  status: number | undefined,
): Readonly<{
  method: Method;
  path: `/${string}`;
  status: number;
  codes: ReadonlyArray<string>;
}> => {
  if (typeof at !== "object")
    return { ...parseAt(capability.contract.name, at), status: status ?? 200, codes: [] };
  // Mount time, not a request: an endpoint shared with a client must describe this very capability.
  if (at.contract !== capability.contract) {
    throw new TypeError(
      `route ${at.method} ${at.path} names ${at.contract.name}, not ${capability.contract.name}`,
    );
  }
  if (status !== undefined) {
    throw new TypeError(`route ${at.method} ${at.path} takes its status from the endpoint`);
  }
  return { method: at.method, path: at.path, status: at.status, codes: at.codes };
};

export const route = <Cap extends Mountable>(
  capability: Cap,
  at?: `${Method} /${string}` | Endpoint<Cap["contract"]>,
  options: RouteOptions = {},
): Route<Cap> => {
  const { method, path, status, codes } = placeOf(capability, at, options.status);
  if (options.csrf !== undefined && options.csrf.reason.trim() === "") {
    // Mount time, not a request: a route that skips the Origin check must say why.
    throw new TypeError(`route ${method} ${path} skips the CSRF check without a reason`);
  }
  return {
    _tag: "Route",
    capability,
    contract: capability.contract,
    method,
    path,
    status,
    codes,
    csrf: options.csrf ?? "check",
  };
};

export type FetchHandler = ((request: Request) => Promise<Response>) &
  Readonly<{ dispose: () => Promise<void> }>;

export type FetchHandlerOptions<A, CA, Routes, AdapterViews> = Readonly<{
  routes: Routes;
  prefix?: `/${string}`;
  caller?: Caller<CA, A>;
  views?: AdapterViews;
  approval?: ApprovalOption;
  origins?: ReadonlyArray<string>;
  maxBodyBytes?: number;
}>;

const notAField = (key: string): InputFault =>
  new InputFault({
    field: fieldName(key),
    issue: "unexpected",
    message: `${fieldName(key)} is not a field here.`,
  });

type QueryValue = string | Array<string>;

const queryInput = (
  query: URLSearchParams,
  pathKeys: ReadonlyArray<readonly [string, string]>,
  arrayKeys: ReadonlySet<string>,
): Effect.Effect<RawInput, InputFault> =>
  Effect.gen(function* queryInputOf() {
    // No prototype, so a key such as __proto__ is an own field the decoder sees and refuses.
    const strings = Object.create(null) as Record<string, QueryValue>;
    for (const [key, value] of query) {
      const held = strings[key];
      // An array field takes the key once per item, in order; one key is a one-item list.
      if (arrayKeys.has(key)) {
        if (Array.isArray(held)) held.push(value);
        else strings[key] = [value];
        continue;
      }
      if (held !== undefined) return yield* givenTwice(key);
      strings[key] = value;
    }
    for (const [key, value] of pathKeys) {
      if (Object.hasOwn(strings, key)) return yield* givenTwice(key);
      strings[key] = value;
    }
    return { value: strings, source: "strings" as const };
  });

const rawInput = (
  route: Route,
  arrayKeys: ReadonlySet<string>,
  server: HttpServerRequest.HttpServerRequest,
  request: Request,
  params: Readonly<Record<string, string | undefined>>,
  limit: number,
): Effect.Effect<RawInput, InputFault | Refused> =>
  Effect.gen(function* rawInputOf() {
    const query = new URL(request.url).searchParams;
    const pathKeys = Object.entries(params).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value] as const],
    );
    if (!writeMethods.has(route.method)) return yield* queryInput(query, pathKeys, arrayKeys);
    for (const [key] of query) return yield* notAField(key);
    const body = yield* parseObject(yield* readCapped(server, request, limit));
    for (const [key, value] of pathKeys) {
      if (Object.hasOwn(body, key)) return yield* givenTwice(key);
      body[key] = yield* pathParamAsJson(route.capability.contract.input, key, value);
    }
    return { value: body, source: "json" as const };
  });

const crossOrigin = new Refused({
  status: 403,
  code: "cross_origin",
  message: "A write must come from the app's own origin.",
});

const isHttpOrigin = (origin: string): boolean =>
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

const csrfRefusal = (
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

const publicHeaders = (route: Route, view: View): View["headers"] => {
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

export const toFetchHandler = <
  A,
  C,
  Views extends ViewTable<C>,
  const Routes extends ReadonlyArray<Route>,
  CA = C,
  const AdapterViews extends ViewTable<CA> = Record<never, never>,
  E = never,
>(
  app: Composition<A, C, Views, E>,
  options: FetchHandlerOptions<A, CA, Routes, AdapterViews> &
    MountCheck<Routes[number]["capability"], A, CA, Views & AdapterViews, E>,
): FetchHandler => {
  const views = { ...defaultViews, ...app.views, ...options.views };
  const caller = (options.caller ?? app.caller) as Caller<never, A>;
  const limit = options.maxBodyBytes ?? defaultMaxBodyBytes;
  for (const origin of options.origins ?? []) {
    if (!isHttpOrigin(origin)) {
      // Mount time, not a request: a bad origins list would refuse or admit the wrong writes.
      throw new TypeError(`origins: ${JSON.stringify(origin)} is not an http(s) origin`);
    }
  }
  const serve = (route: Route) => {
    const arrayKeys = arrayKeysOf(route.capability.contract.input);
    return HttpRouter.add(route.method, `${options.prefix ?? ""}${route.path}`, (request) =>
      Effect.gen(function* serveRoute() {
        const params = yield* HttpRouter.params;
        const requestId = yield* requestIdFor(request.headers[requestIdHeader] ?? null);
        const answer = Effect.gen(function* answerRequest() {
          const web = HttpServerRequest.toWebResult(request);
          if (Result.isFailure(web)) return yield* Effect.die(web.failure);
          const incoming: Incoming = { headers: web.success.headers, url: web.success.url };
          const refused = csrfRefusal(route, web.success, options.origins);
          if (refused !== undefined) {
            const view = yield* safeViewOf(views, refused, undefined);
            return respond(view.status, view.body, requestId, publicHeaders(route, view));
          }
          const outcome = yield* serveIn<A, Outcome<unknown, unknown>>(app, {
            ready: (context) =>
              invoke(context, route.capability, {
                incoming,
                input: rawInput(route, arrayKeys, request, web.success, params, limit),
                channel: "web",
                caller,
                approval: options.approval,
                // Plain HTTP has no way to ask the human, so approval fails closed.
                defaultApproval: Approval.denyAll,
                views,
                encodeOutput: true,
              }).pipe(withRequestId(requestId)),
            failed: (cause) => layerFailure(views, cause),
            closed: closedFailure(views),
          });
          return outcome.ok
            ? respond(route.status, outcome.value, requestId)
            : respond(
                outcome.view.status,
                outcome.view.body,
                requestId,
                publicHeaders(route, outcome.view),
              );
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
  const [first, ...rest] = options.routes.map(serve);
  const routes = first === undefined ? Layer.empty : Layer.mergeAll(first, ...rest);
  // Each handler builds its own router. Sharing one would let this handler answer another's routes.
  const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
  return Object.assign((request: Request) => handler(request), { dispose });
};
