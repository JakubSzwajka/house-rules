import { type Binding, bindOperation } from "@house-rules/application";
import type { ActorId, NoOpenUnit } from "@house-rules/domain";
import { Effect, type Option } from "effect";
import {
  type Binding as LoginBinding,
  type BindingInvalid,
  type BindingTaken,
  IdentityCallerDenied,
} from "./binding.js";
import type { IdentityStoreUnavailable } from "../storage.js";
import { IdentityOperations } from "./operations.js";
import type { TokenMethods } from "../api-token/tokens.js";
import type { SessionControl } from "../sessions/session-control.js";
import type { PasswordMethods } from "../passwords/accounts.js";
import type { PasswordIssuerService } from "../passwords/accounts-issuer.js";
import { bindPasswords } from "../passwords/bindings.js";
import { AccountId } from "../passwords/account.js";
import { AccountStoreUnavailable } from "../passwords/store-unavailable.js";

type Login = Readonly<{ issuer: string; subject: string }>;
type Service = PasswordMethods &
  TokenMethods & {
    readonly endSessions: SessionControl["Service"]["endAll"];
    readonly passwordIssuer: () => Effect.Effect<PasswordIssuerService | undefined>;
    readonly resolve: (
      login: Login,
    ) => Effect.Effect<Option.Option<ActorId>, IdentityStoreUnavailable>;
    readonly bind: (
      login: Login,
      actorId: ActorId,
    ) => Effect.Effect<void, BindingInvalid | BindingTaken | IdentityStoreUnavailable | NoOpenUnit>;
    readonly unbind: (
      actorId: ActorId,
      login: Login,
    ) => Effect.Effect<void, IdentityStoreUnavailable | NoOpenUnit>;
    readonly bindingsOf: (
      actorId: ActorId,
    ) => Effect.Effect<ReadonlyArray<LoginBinding>, IdentityStoreUnavailable>;
    readonly unbindAll: (
      actorId: ActorId,
    ) => Effect.Effect<void, IdentityStoreUnavailable | NoOpenUnit>;
  };

export const bindIdentity = (service: Service): readonly Binding[] => [
  bindOperation(IdentityOperations.issueToken, (input) => service.issueToken(input)),
  bindOperation(IdentityOperations.listTokens, ({ actorId }) => service.listTokens(actorId)),
  bindOperation(IdentityOperations.revokeToken, ({ id }) => service.revokeToken(id)),
  bindOperation(IdentityOperations.recordTokenUse, () => service.recordTokenUse()),
  bindOperation(IdentityOperations.endSessions, ({ actorId }) => service.endSessions(actorId)),
  ...bindPasswords(service, (actorId) =>
    Effect.gen(function* () {
      const issuer = yield* service.passwordIssuer();
      const bindings = yield* service.bindingsOf(actorId);
      const login = bindings.find((binding) => binding.issuer === issuer?.issuer);
      return login === undefined ? undefined : AccountId.make(login.subject);
    }).pipe(Effect.mapError((cause) => new AccountStoreUnavailable({ cause }))),
  ),
  bindOperation(IdentityOperations.bindLogin, ({ issuer, subject, personId }, { caller }) =>
    caller.kind === "system"
      ? service.bind({ issuer, subject }, personId).pipe(Effect.as(personId))
      : Effect.fail(new IdentityCallerDenied()),
  ),
];
