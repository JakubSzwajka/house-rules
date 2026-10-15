import { AccountPermissions } from "@example/accounts";
import { ActivityPermissions } from "@example/activity";
import { BookingPermissions } from "@example/bookings";
import {
  Authenticator,
  type Caller,
  type CurrentActor,
  Grant,
  type ProtectedResource,
  Refused,
} from "@house-rules/application";
import { CommentPermissions } from "@house-rules/comments";
import {
  type ActorResolver,
  type FirstSignIn,
  Identity,
  type IdentityCaller,
} from "@house-rules/identity";
import { PartyPermissions } from "@house-rules/party";
import { Context, Effect } from "effect";
import { McpAuthenticator } from "./mcp-authenticator.js";

export const memberPermissions = [
  BookingPermissions.read,
  BookingPermissions.write,
  CommentPermissions.read,
  CommentPermissions.write,
  PartyPermissions.read,
  PartyPermissions.update,
  AccountPermissions.update,
  ActivityPermissions.read,
];

export const agentPermissions = [BookingPermissions.read, CommentPermissions.read];

export const visitorCaller = () => Effect.succeed(Context.empty());

export const sessionCookie = "booking_session";

export const memberCaller: IdentityCaller = Identity.caller({
  token: ["bearer", { cookie: sessionCookie }],
  grant: () => Grant.fromPermissions(memberPermissions),
});

export type AgentCaller = Caller<
  CurrentActor | Grant,
  McpAuthenticator | ActorResolver | FirstSignIn
>;

const notConfigured: AgentCaller = () =>
  Effect.fail(
    new Refused({
      status: 503,
      code: "not_configured",
      message: "MCP auth is not configured on this server.",
    }),
  );

export const mcpCaller = (
  resource: ProtectedResource,
  permissions: ReadonlyArray<`${string}:${string}`>,
): AgentCaller => {
  if (!resource.configured) return notConfigured;
  const caller = Identity.caller({
    token: "bearer",
    audience: resource.metadata.resource,
    grant: () => Grant.fromPermissions(permissions),
    challenge: resource.challenge,
  });
  // The MCP server's own Authenticator replaces the web one for this call only.
  return (incoming) =>
    Effect.gen(function* agentCallerOf() {
      const mcp = yield* McpAuthenticator;
      return yield* caller(incoming).pipe(Effect.provideService(Authenticator, mcp));
    });
};

export const agentCaller = (resource: ProtectedResource): AgentCaller =>
  mcpCaller(resource, agentPermissions);
