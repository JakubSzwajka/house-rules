import { type ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Option, Schema } from "effect";
import type { BindingStore } from "../storage.js";
import { BindingInvalid, BindingKey, BindingTaken } from "./binding.js";

const decodeKey = Schema.decodeUnknownOption(BindingKey);

const keyOf = (principal: { readonly issuer: string; readonly subject: string }) =>
  decodeKey({ issuer: principal.issuer, subject: principal.subject });

export const makeIdentity = (store: BindingStore["Service"]) => ({
  resolve: (principal: { readonly issuer: string; readonly subject: string }) =>
    Option.match(keyOf(principal), {
      onNone: () => Effect.succeedNone,
      onSome: (key) => store.find(key).pipe(Effect.map(Option.fromUndefinedOr)),
    }),
  bind: Effect.fn("Identity.bind")(function* (
    principal: { readonly issuer: string; readonly subject: string },
    actorId: ActorId,
  ) {
    const key = keyOf(principal);
    if (Option.isNone(key))
      return yield* new BindingInvalid({
        message: "A binding needs a non-empty issuer and subject.",
      });
    const holder = yield* store.claim(key.value, actorId);
    if (holder !== actorId) return yield* new BindingTaken(key.value);
  }),
  unbind: (actorId: ActorId, principal: { readonly issuer: string; readonly subject: string }) =>
    Option.match(keyOf(principal), {
      onNone: () => UnitOfWork.required,
      onSome: (key) => store.remove(actorId, key),
    }),
  bindingsOf: (actorId: ActorId) => store.list(actorId),
  unbindAll: (actorId: ActorId) => store.removeAll(actorId),
});
