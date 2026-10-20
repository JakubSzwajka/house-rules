import { type Binding, bindNode } from "@house-rules/application";
import type { ActorId, NoOpenUnit } from "@house-rules/domain";
import { Effect, type Option } from "effect";
import {
  type Binding as LoginBinding,
  type BindingInvalid,
  type BindingTaken,
  IdentityCallerDenied,
  type IdentityStoreUnavailable,
} from "./binding.js";
import { bindLogin } from "./nodes.js";

type Login = Readonly<{ issuer: string; subject: string }>;
type Service = {
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
  bindNode(bindLogin, ({ issuer, subject, personId }, { caller }) =>
    caller.kind === "system"
      ? service.bind({ issuer, subject }, personId).pipe(Effect.as(personId))
      : Effect.fail(new IdentityCallerDenied()),
  ),
];
