import { Effect } from "effect";
import type { HttpServerRequest } from "effect/http";
import { writeMethods } from "../contract/endpoint.ts";
import type { Refused } from "./caller.ts";
import { fieldName, InputFault, pathParamAsJson } from "./input.ts";
import type { RawInput } from "./invoke.ts";
import { givenTwice, parseObject, readCapped } from "./request-body.ts";
import type { Route } from "./route.ts";

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

export const rawInput = (
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
