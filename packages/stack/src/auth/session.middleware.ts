import * as Headers from "effect/http/Headers";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Schema from "effect/Schema";
import { CurrentActor } from "../actor/current-actor.context.ts";

export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
  "Unauthenticated",
  {},
  { httpApiStatus: 401 },
) {}

export const VIA_AGENT_HEADER = "x-house-rules-via";

export class Session extends RpcMiddleware.Service<Session, { provides: CurrentActor }>()(
  "HouseRules/Session",
  { error: Unauthenticated },
) {}

export const sessionClient = (token: string, via: "user" | "agent" = "user") =>
  RpcMiddleware.layerClient(Session, ({ request, next }) => {
    const headers = Headers.set(request.headers, "authorization", `Bearer ${token}`);
    return next({
      ...request,
      headers:
        via === "agent"
          ? Headers.set(headers, VIA_AGENT_HEADER, "agent")
          : Headers.remove(headers, VIA_AGENT_HEADER),
    });
  });
