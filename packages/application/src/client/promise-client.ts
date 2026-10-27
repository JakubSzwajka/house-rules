import { Cause, Clock, Effect, Exit, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import type { Api, ApiEndpoints } from "../contract/api.ts";
import type { AnyEntryPoint } from "../feature/feature.ts";
import type { Endpoint, Method } from "../contract/endpoint.ts";
import type { BodyOf, SessionRole } from "../contract/session.ts";
import { requestIdHeader, requestIdOf } from "../call/request-id-header.ts";
import { onBaseOrigin, type RequestBase, requestBaseOf } from "./base-origin.ts";
import { callOf, type ClientFailureCode, HttpFailure, type HttpFailureOf } from "./http-client.ts";

export type CallReport = Readonly<{
  name: string;
  method: Method;
  path: string;
  status: number;
  ms: number;
  code?: string;
  requestId?: string;
}>;

export type PromiseClientOptions = Readonly<{
  baseUrl?: string;
  token?: () => string | undefined | Promise<string | undefined>;
  onCall?: (feature: CallReport) => void;
  fetch?: typeof globalThis.fetch;
}>;

export type PromiseCall<E extends AnyEntryPoint, Session extends SessionRole = "none"> = (
  input: E["input"]["Type"],
) => Promise<BodyOf<E, Session>>;

export type PromiseClientOf<Endpoints extends ApiEndpoints> = {
  readonly [Key in keyof Endpoints]: PromiseCall<
    Endpoints[Key]["feature"],
    Endpoints[Key]["session"]
  >;
};

export type PromiseFailureOf<E extends Endpoint> = HttpFailureOf<
  ClientFailureCode<E["codes"][number]>
>;

const isHttpFailure = Schema.is(HttpFailure);

const promiseCallOf = (
  shape: Endpoint,
  prefix: "" | `/${string}`,
  options: PromiseClientOptions,
  base: () => RequestBase | undefined,
) => {
  const run = callOf(shape, { ...(prefix === "" ? {} : { prefix }), base });
  const { method } = shape;
  const sameOrigin = (url: string | URL): URL | undefined => onBaseOrigin(String(url), base());
  const name = shape.feature.name;
  return (input: unknown): Promise<unknown> => {
    const seen: { path: string; status: number; requestId?: string } = {
      path: `${prefix}${shape.path}`,
      status: 0,
    };
    const fetch = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const href = url instanceof Request ? url.url : String(url);
      const sent = sameOrigin(href);
      if (sent === undefined) {
        // Nothing is sent: the token and the request stay on the base origin.
        return Promise.reject(
          new TypeError(`request to ${JSON.stringify(href)} is not on the base origin`),
        );
      }
      seen.path = `${sent.pathname}${sent.search}`;
      // callOf asks for this too; never follow a redirect, which could carry the body to another origin.
      return (options.fetch ?? globalThis.fetch)(url, { ...init, redirect: "manual" }).then(
        (response) => {
          seen.status = response.status;
          // Only a plain id goes into the log: the header is the server's word, so it is checked like one.
          const requestId = requestIdOf(response.headers.get(requestIdHeader));
          if (requestId !== null) seen.requestId = requestId;
          return response;
        },
      );
    };
    const send = Effect.gen(function* sendCall() {
      const token = yield* Effect.promise(() => Promise.resolve(options.token?.()));
      return yield* run(input).pipe(
        Effect.updateService(HttpClient.HttpClient, (client) =>
          token === undefined
            ? client
            : HttpClient.mapRequest(client, (request) =>
                // Defense in depth: the fetch wrapper refuses a cross-origin URL too, but never attach the token to one.
                sameOrigin(request.url) === undefined
                  ? request
                  : HttpClientRequest.bearerToken(request, token),
              ),
        ),
      );
    }).pipe(
      // No answer, or an answer whose body could not be read: Unknown, with the status seen if any.
      Effect.mapError((error) =>
        isHttpFailure(error)
          ? error
          : new HttpFailure({ code: "Unknown", status: seen.status, body: error.message }),
      ),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch),
      // A page's trace ids lead nowhere, and traceparent or b3 would fail a cross-origin preflight.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    );
    const reported = Effect.gen(function* reportCall() {
      const started = yield* Clock.currentTimeMillis;
      const exit = yield* Effect.exit(send);
      const ended = yield* Clock.currentTimeMillis;
      const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      const code = Exit.isFailure(exit)
        ? isHttpFailure(failure)
          ? failure.code
          : "Unknown"
        : undefined;
      yield* Effect.sync(() =>
        options.onCall?.({
          name,
          method,
          path: seen.path,
          status: seen.status,
          ms: ended - started,
          ...(code === undefined ? {} : { code }),
          ...(seen.requestId === undefined ? {} : { requestId: seen.requestId }),
        }),
      );
      return yield* exit;
    });
    // The client edge: a browser calls a Promise, so the Effect runs here and nowhere above it.
    return Effect.runPromise(reported);
  };
};

export const toPromiseClient = <const Endpoints extends ApiEndpoints>(
  api: Api<Endpoints>,
  options: PromiseClientOptions = {},
): PromiseClientOf<Endpoints> => {
  const base = requestBaseOf("toPromiseClient", options.baseUrl);
  const client: Record<string, unknown> = {};
  for (const [key, shape] of Object.entries(api.endpoints)) {
    client[key] = promiseCallOf(shape, api.prefix, options, base);
  }
  return Object.freeze(client) as PromiseClientOf<Endpoints>;
};
