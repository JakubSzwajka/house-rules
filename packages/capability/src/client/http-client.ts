import { Effect, Schema } from "effect";
import {
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";
import type { AnyContract } from "../contract/contract.ts";
import {
  type EndpointShape,
  failureCodeHeader,
  pathParamNames,
  writeMethods,
} from "../contract/endpoint.ts";

export type ClientFailureCode<Code extends string> = Code | "Unknown";

export class HttpFailure extends Schema.TaggedError<HttpFailure>()("HttpFailure", {
  code: Schema.String,
  status: Schema.Int,
  body: Schema.Unknown,
}) {}

export type HttpFailureOf<Code extends string> = HttpFailure & { readonly code: Code };

export type ClientCall<C extends AnyContract, Code extends string = never> = (
  input: C["input"]["Type"],
) => Effect.Effect<
  C["output"]["Type"],
  HttpFailureOf<ClientFailureCode<Code>> | HttpClientError.HttpClientError,
  HttpClient.HttpClient
>;

export type HttpClientOf<Endpoints extends ReadonlyArray<EndpointShape>> = {
  readonly [E in Endpoints[number] as E["contract"]["name"]]: ClientCall<
    E["contract"],
    E["codes"][number]
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

const callOf = (shape: EndpointShape, options: HttpClientOptions) => {
  const { contract, method, path, status, codes } = shape;
  const params = pathParamNames(shape);
  const json = Schema.toCodecJson(contract.input) as unknown as Codec;
  const strings = Schema.toCodecStringTree(contract.input) as unknown as Codec;
  const output = Schema.toCodecJson(contract.output) as unknown as Codec;
  const write = writeMethods.has(method);
  return (input: unknown) =>
    Effect.gen(function* callEndpoint() {
      const tree = yield* encodedRecord(strings, input);
      const segments = yield* Effect.forEach(path.split("/"), (segment) => {
        const param = params.find((name) => segment === `:${name}`);
        return param === undefined
          ? Effect.succeed(segment)
          : Effect.map(oneString(contract.name, param, tree[param]), encodeURIComponent);
      });
      const url = `${options.baseUrl ?? ""}${options.prefix ?? ""}${segments.join("/")}`;
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
      // The browser sends same-origin cookies and an Origin header on a write; the CSRF check reads it.
      const response = yield* (yield* HttpClient.HttpClient).execute(request);
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

export const toHttpClient = <const Endpoints extends ReadonlyArray<EndpointShape>>(
  endpoints: Endpoints,
  options: HttpClientOptions = {},
): HttpClientOf<Endpoints> => {
  const client: Record<string, unknown> = {};
  for (const shape of endpoints) {
    if (Object.hasOwn(client, shape.contract.name)) {
      // Build time, not a call: two endpoints under one name would make one of them unreachable.
      throw new TypeError(`toHttpClient: ${shape.contract.name} is listed twice`);
    }
    client[shape.contract.name] = callOf(shape, options);
  }
  return client as HttpClientOf<Endpoints>;
};
