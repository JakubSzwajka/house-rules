import { type Principal, TokenRejected } from "@house-rules/application";
import type { ActorId } from "@house-rules/domain";
import { Context, type Effect, type Option } from "effect";
import type { IdentityStoreUnavailable } from "../storage.js";

export type CredentialKind = "session" | "jwt" | "oauth_access" | "machine" | "api_token";
export type AcceptedKind = Exclude<CredentialKind, "machine">;
export type Credential =
  | Readonly<{ kind: "api_token"; principal: Principal; actorId: Option.Option<ActorId> }>
  | Readonly<{
      kind: Exclude<CredentialKind, "api_token">;
      principal: Principal;
      actorId: Option.Option<never>;
    }>;
export class Credentials extends Context.Service<
  Credentials,
  {
    verify: (
      token: string,
      options: Readonly<{ accept: ReadonlyArray<AcceptedKind>; audience?: string }>,
    ) => Effect.Effect<Credential, TokenRejected | IdentityStoreUnavailable>;
  }
>()("@house-rules/identity/Credentials") {}
