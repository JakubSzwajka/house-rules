import { Effect, Layer, Result } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { requestIdHeader, withRequestId } from "../call/request-id.ts";
import { failureCodeHeader } from "../contract/endpoint.ts";
import { Approval } from "../gates/approval.ts";
import { checkPrefixOwner } from "./api-prefix.ts";
import type { Caller, Incoming } from "./caller.ts";
import { type Composition, serveIn } from "./composition.ts";
import { checkCors, type CorsOptions, preflightRoutes, withCors } from "./cors.ts";
import { csrfRefusal, isHttpOrigin } from "./csrf.ts";
import { arrayKeysOf } from "./input.ts";
import {
  type ApprovalOption,
  closedFailure,
  invoke,
  layerFailure,
  logDefect,
  type Outcome,
  requestIdFor,
} from "./invoke.ts";
import type { MountCheck } from "./mount-check.ts";
import type { Route } from "./route.ts";
import { rawInput } from "./route-input.ts";
import {
  checkSession,
  clearedCookie,
  issueSession,
  type SessionOptions,
} from "./session-cookie.ts";
import { defaultViews, internalErrorView, safeViewOf, type View, type ViewTable } from "./views.ts";

export const defaultMaxBodyBytes = 1024 * 1024;

export type FetchHandler = ((request: Request) => Promise<Response>) &
  Readonly<{ dispose: () => Promise<void> }>;

export type FetchHandlerOptions<A, CA, Routes, AdapterViews> = Readonly<{
  routes: Routes;
  prefix?: `/${string}`;
  caller?: Caller<CA, A>;
  views?: AdapterViews;
  approval?: ApprovalOption;
  origins?: ReadonlyArray<string>;
  cors?: CorsOptions;
  maxBodyBytes?: number;
  session?: SessionOptions;
}>;

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
  checkPrefixOwner(options.routes, options.prefix);
  for (const origin of options.origins ?? []) {
    if (!isHttpOrigin(origin)) {
      // Mount time, not a request: a bad origins list would refuse or admit the wrong writes.
      throw new TypeError(`origins: ${JSON.stringify(origin)} is not an http(s) origin`);
    }
  }
  const cors = checkCors(options.cors);
  const session = checkSession(options.session, options.routes);
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
                // An issue route encodes after the token is taken out for the cookie.
                encodeOutput: route.session !== "issue",
              }).pipe(withRequestId(requestId)),
            failed: (cause) => layerFailure(views, cause),
            closed: closedFailure(views),
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
    preflightRoutes(cors, options.routes, options.prefix ?? ""),
    ...options.routes.map(serve),
  );
  // Each handler builds its own router. Sharing one would let this handler answer another's routes.
  const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
  const answer = (request: Request) =>
    cors === undefined
      ? handler(request)
      : handler(request).then((response) => withCors(cors, request, response));
  return Object.assign(answer, { dispose });
};
