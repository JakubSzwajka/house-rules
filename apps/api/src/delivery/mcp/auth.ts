import { BookingPermissions } from "@hosti/bookings";
import { type Caller, CurrentActor, Grant, Refused } from "@house-rules/application";
import { CommentPermissions } from "@house-rules/comments";
import { Context, Effect, Option } from "effect";
import { TokenVerifier } from "../../composition/token-verifier.js";
import type { McpAuthConfig } from "./config.js";

const agentPermissions = [BookingPermissions.read, CommentPermissions.read];

const quoted = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const challenge = (config: McpAuthConfig, error?: "invalid_token") =>
  `Bearer ${[
    ...(error === undefined ? [] : [`error=${quoted(error)}`]),
    `resource_metadata=${quoted(config.metadataUrl)}`,
  ].join(", ")}`;

const bearerToken = (headers: Headers): string | undefined =>
  /^Bearer\s+(\S+)\s*$/iu.exec(headers.get("authorization") ?? "")?.[1];

export const bearerCaller =
  (config: McpAuthConfig | undefined): Caller<CurrentActor | Grant, TokenVerifier> =>
  (incoming) =>
    Effect.gen(function* bearerCallerOf() {
      if (config === undefined) {
        return yield* new Refused({
          status: 503,
          code: "not_configured",
          message: "MCP auth is not configured on this server.",
        });
      }
      const token = bearerToken(incoming.headers);
      if (token === undefined) {
        return yield* new Refused({
          status: 401,
          code: "token_missing",
          message: "Send a token as Authorization: Bearer <token>.",
          challenge: challenge(config),
        });
      }
      // The audience check: a token issued for another resource is refused.
      const verifier = yield* TokenVerifier;
      const actor = yield* verifier.verify(token, config.resource);
      if (Option.isNone(actor)) {
        return yield* new Refused({
          status: 401,
          code: "token_invalid",
          message: "The token is invalid, expired, or not issued for this server.",
          challenge: challenge(config, "invalid_token"),
        });
      }
      return Context.make(CurrentActor, actor.value).pipe(
        Context.add(Grant, Grant.fromPermissions(agentPermissions)),
      );
    });
