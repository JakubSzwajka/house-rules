import * as Effect from "effect/Effect";
import * as Headers from "effect/http/Headers";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as Option from "effect/Option";
import { VIA_AGENT_HEADER } from "./session.middleware.ts";

export const viaAgent = <R = never>(
  token?: Effect.Effect<string, never, R>,
): Effect.Effect<Headers.Headers, never, R> =>
  Effect.gen(function* () {
    const request = yield* Effect.serviceOption(HttpServerRequest);
    const incoming = Option.match(request, {
      onNone: () => Headers.empty,
      onSome: ({ headers }) => headers,
    });
    const headers =
      token === undefined
        ? incoming
        : Headers.set(incoming, "authorization", `Bearer ${yield* token}`);
    return Headers.set(headers, VIA_AGENT_HEADER, "agent");
  });
