import { BookingPermissions } from "@example/bookings";
import { Grant, type ProtectedResource, Refused } from "@house-rules/application";
import { CommentPermissions } from "@house-rules/comments";
import { Identity, type IdentityCaller } from "@house-rules/identity";
import { PartyPermissions } from "@house-rules/party";
import { Context, Effect } from "effect";

export const memberPermissions = [
  BookingPermissions.read,
  BookingPermissions.write,
  CommentPermissions.read,
  CommentPermissions.write,
  PartyPermissions.read,
];

export const agentPermissions = [BookingPermissions.read, CommentPermissions.read];

export const visitorCaller = () => Effect.succeed(Context.empty());

export const memberCaller: IdentityCaller = Identity.caller({
  token: "bearer",
  grant: () => Grant.fromPermissions(memberPermissions),
});

const notConfigured: IdentityCaller = () =>
  Effect.fail(
    new Refused({
      status: 503,
      code: "not_configured",
      message: "MCP auth is not configured on this server.",
    }),
  );

export const agentCaller = (resource: ProtectedResource): IdentityCaller =>
  resource.configured
    ? Identity.caller({
        token: "bearer",
        audience: resource.metadata.resource,
        grant: () => Grant.fromPermissions(agentPermissions),
        challenge: resource.challenge,
      })
    : notConfigured;
