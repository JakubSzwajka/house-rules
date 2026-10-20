import { Effect, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import type { AnyEntry } from "../entry/entry.ts";
import {
  type Endpoint,
  failureCodeHeader,
  pathParamNames,
  writeMethods,
} from "../contract/endpoint.ts";
import { type BodyOf, bodySchemaOf, type SessionRole } from "../contract/session.ts";
import { onBaseOrigin, pathStaysOn, type RequestBase, requestBaseOf } from "./base-origin.ts";

export type ClientFailureCode<Code extends string> = Code | "Unknown";

export class HttpFailure extends Schema.TaggedError<HttpFailure>()("HttpFailure", {
  code: Schema.String,
  status: Schema.Int,
  body: Schema.Unknown,
}) {}

export type HttpFailureOf<Code extends string> = HttpFailure & { readonly code: Code };

export type ClientCall<
  E extends AnyEntry,
  Code extends string = never,
  Session extends SessionRole = "none",
> = (
  input: E["node"]["input"]["Type"],
) => Effect.Effect<
  BodyOf<E, Session>,
  HttpFailureOf<ClientFailureCode<Code>> | HttpClientError.HttpClientError,
  HttpClient.HttpClient
>;

export type HttpClientOf<Endpoints extends ReadonlyArray<Endpoint>> = {
  readonly [E in Endpoints[number] as E["entry"]["node"]["name"]]: ClientCall<
    E["entry"],
    E["codes"][number],
    E["session"]
  >;
};

export type HttpClientOptions = Readonly<{
  prefix?: `/${string}`;
  baseUrl?: string;
}>;

type Codec = Schema.Codec<unknown, unknown>;

const encodedRecord = (codec: Codec, input: unknown) =>
  Schema.encodeUnknownEffect(codec)(input).pipe(
    Effect.map((encoded) => encoded as Readonly<Record<string, unknown>>),
    // The input type matched the contract, so a value that will not encode is a bug, not a failure.
    Effect.orDie,
  );

const oneString = (name: string, key: string, value: unknown): Effect.Effect<string> =>
  typeof value === "string"
    ? Effect.succeed(value)
    : // A path value, or a GET field that is not a list, must be one plain string, as the fetch handler reads it.
      Effect.die(`${name}: ${key} does not encode to one string`);

const queryStrings = (name: string, key: string, value: unknown) =>
  // A list goes out as one key per item, the repeated keys the fetch handler gathers back.
  Array.isArray(value)
    ? Effect.forEach(value, (item: unknown) => oneString(name, key, item))
    : Effect.map(oneString(name, key, value), (text) => [text]);

const bodyOf = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.flatMap(response.text, (text) =>
    text === ""
      ? Effect.succeed<unknown>(undefined)
      : Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
          Effect.orElseSucceed((): unknown => text),
        ),
  );

export type CallOptions = Readonly<{
  prefix?: `/${string}`;
  base: () => RequestBase | undefined;
}>;

export const callOf = (shape: Endpoint, options: CallOptions) => {
  const { entry, method, path, status, codes } = shape;
  const contract = entry.node;
  const params = pathParamNames(shape);
  const json = Schema.toCodecJson(contract.input) as unknown as Codec;
  const strings = Schema.toCodecStringTree(contract.input) as unknown as Codec;
  // A session issue route answers without the token, which went into the cookie.
  const output = Schema.toCodecJson(bodySchemaOf(entry, shape.session)) as unknown as Codec;
  const write = writeMethods.has(method);
  // Nothing went out: the same status 0 a network failure has.
  const unsent = (reason: string) =>
    new HttpFailure({ code: "Unknown", status: 0, body: `${contract.name}: ${reason}` });
  return (input: unknown) =>
    Effect.gen(function* callEndpoint() {
      const tree = yield* encodedRecord(strings, input);
      const segments = yield* Effect.forEach(path.split("/"), (segment) => {
        const param = params.find((name) => segment === `:${name}`);
        return param === undefined
          ? Effect.succeed(segment)
          : Effect.flatMap(oneString(contract.name, param, tree[param]), (value) =>
              // A URL parser folds `.` and `..` into the path above, and an empty value joins two slashes into `//host`.
              value === "" || value === "." || value === ".."
                ? Effect.fail(unsent(`${param} cannot be empty, "." or ".."`))
                : Effect.succeed(encodeURIComponent(value)),
            );
      });
      const base = options.base();
      if (base === undefined) {
        return yield* unsent("no base origin: give baseUrl, or call from an http or https page");
      }
      // Absolute, so the transport has nothing left to resolve it against.
      const target = `${options.prefix ?? ""}${segments.join("/")}`;
      const url = `${base.href}${target}`;
      let request = HttpClientRequest.make(method)(url).pipe(
        HttpClientRequest.setHeader("accept", "application/json"),
      );
      if (write) {
        // Path values travel in the path only: the fetch handler refuses a key given twice.
        const body = yield* encodedRecord(json, input);
        const rest = Object.entries(body).filter(([key]) => !params.includes(key));
        request = HttpClientRequest.bodyJsonUnsafe(request, Object.fromEntries(rest));
      } else {
        for (const [key, value] of Object.entries(tree)) {
          if (params.includes(key) || value === undefined) continue;
          for (const text of yield* queryStrings(contract.name, key, value)) {
            request = HttpClientRequest.appendUrlParam(request, key, text);
          }
        }
      }
      // The last word before sending: a raw endpoint path such as `//host` or `/\t/host` cannot leave the base origin.
      if (!pathStaysOn(target, base) || onBaseOrigin(url, base) === undefined) {
        return yield* unsent(`${JSON.stringify(url)} is not on the base origin`);
      }
      const fetch = yield* FetchHttpClient.Fetch;
      const manual: typeof globalThis.fetch = (input, init) =>
        // The transport hands over its whole init, any FetchHttpClient.RequestInit merged in; only the redirect mode changes.
        fetch(input, { ...init, redirect: "manual" });
      // The browser sends same-origin cookies and an Origin header on a write; the CSRF check reads it.
      const response = yield* (yield* HttpClient.HttpClient).execute(request).pipe(
        // fetch follows a redirect to any origin, body included; "manual" hands back the 3xx, which fails below.
        Effect.provideService(FetchHttpClient.Fetch, manual),
      );
      const body = yield* bodyOf(response);
      if (response.status === status) {
        return yield* Schema.decodeUnknownEffect(output)(body).pipe(
          Effect.mapError(() => new HttpFailure({ code: "Unknown", status, body })),
        );
      }
      // Views shape the body, so only a declared code on a 4xx ties a failure back to the endpoint.
      const code = response.headers[failureCodeHeader];
      const known =
        response.status >= 400 &&
        response.status < 500 &&
        code !== undefined &&
        codes.includes(code);
      return yield* new HttpFailure({
        code: known ? code : "Unknown",
        status: response.status,
        body,
      });
    });
};

export const toHttpClient = <const Endpoints extends ReadonlyArray<Endpoint>>(
  endpoints: Endpoints,
  options: HttpClientOptions = {},
): HttpClientOf<Endpoints> => {
  const base = requestBaseOf("toHttpClient", options.baseUrl);
  const client: Record<string, unknown> = {};
  for (const shape of endpoints) {
    if (Object.hasOwn(client, shape.entry.node.name)) {
      // Build time, not a call: two endpoints under one name would make one of them unreachable.
      throw new TypeError(`toHttpClient: ${shape.entry.node.name} is listed twice`);
    }
    client[shape.entry.node.name] = callOf(shape, {
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
      base,
    });
  }
  return client as HttpClientOf<Endpoints>;
};
