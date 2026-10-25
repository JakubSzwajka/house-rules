import { UnitOfWork, type Actor } from "@house-rules/domain";
import { DateTime, Effect, Schema } from "effect";
import type { PushStore } from "../storage.js";
import {
  PushInputInvalid,
  PushSendFailed,
  PushTtl,
  type PushPayload,
  PushSubscriptionConflict,
  PushSubscriptionNotFound,
  type PushOwner,
  type PushSubscription,
} from "./push.js";
import type { PushSender } from "./sender.js";
const decodeTtl = Schema.decodeUnknownEffect(PushTtl);
const decodeInput = Schema.decodeUnknownEffect(
  Schema.Struct({
    endpoint: Schema.URLFromString.check(Schema.makeFilter((url) => url.protocol === "https:")),
    keys: Schema.Struct({ p256dh: Schema.NonEmptyString, auth: Schema.NonEmptyString }),
  }),
);
const sameOwner = (a: PushOwner, b: PushOwner) => a.kind === b.kind && a.id === b.id;
export const makePush = (
  store: PushStore["Service"],
  sender: PushSender["Service"],
  defaultTtlSeconds: number,
) => ({
  erase: (owner: PushOwner) => store.erase(owner),
  subscribe: Effect.fn("Push.subscribe")(function* (
    actor: Actor,
    input: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string },
  ) {
    yield* UnitOfWork.required;
    yield* decodeInput(input).pipe(
      Effect.mapError(
        () => new PushInputInvalid({ message: "Use an HTTPS endpoint and nonempty push keys." }),
      ),
    );
    const existing = yield* store.getIncludingExpired(input.endpoint);
    if (existing && !sameOwner(existing.owner, { kind: "person", id: actor.id }))
      return yield* new PushSubscriptionConflict({
        message: "This endpoint is registered to another owner.",
      });
    if (existing && existing.expiredAt === undefined) return { subscription: existing, events: [] };
    const subscription: PushSubscription = {
      endpoint: input.endpoint,
      owner: { kind: "person", id: actor.id },
      keys: { ...input.keys },
      ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
      createdAt: existing?.createdAt ?? DateTime.toEpochMillis(yield* DateTime.now),
    };
    yield* store.put(subscription);
    return {
      subscription,
      events: [
        { _tag: "Subscribed" as const, endpoint: input.endpoint, owner: subscription.owner },
      ],
    };
  }),
  unsubscribe: Effect.fn("Push.unsubscribe")(function* (actor: Actor, endpoint: string) {
    yield* UnitOfWork.required;
    const existing = yield* store.get(endpoint);
    if (!existing || !sameOwner(existing.owner, { kind: "person", id: actor.id }))
      return yield* new PushSubscriptionNotFound({ message: "Push subscription not found." });
    yield* store.remove(endpoint);
    return { events: [{ _tag: "Unsubscribed" as const, endpoint, owner: existing.owner }] };
  }),
  listMine: (actor: Actor) => store.listMine({ kind: "person", id: actor.id }),
  isSubscribed: Effect.fn("Push.isSubscribed")(function* (actor: Actor, endpoint: string) {
    const current = yield* store.get(endpoint);
    return current !== undefined && sameOwner(current.owner, { kind: "person", id: actor.id });
  }),
  subscriptionsFor: (owner: PushOwner) => store.listOwner(owner),
  deliver: Effect.fn("Push.deliver")(function* (
    owner: PushOwner,
    payload: PushPayload,
    idempotencyKey: string,
    ttl = defaultTtlSeconds,
  ) {
    yield* UnitOfWork.required;
    const seconds = yield* decodeTtl(ttl).pipe(
      Effect.mapError(
        () => new PushInputInvalid({ message: "Push TTL must be a positive integer." }),
      ),
    );
    const subscriptions = yield* store.listOwner(owner);
    let sent = 0;
    const events: { readonly _tag: "SubscriptionExpired"; readonly endpoint: string }[] = [];
    for (const subscription of subscriptions) {
      const result = yield* sender
        .send(subscription, payload, { ttl: seconds, idempotencyKey })
        .pipe(
          // A caller may recover in this unit, committing the earlier expiries.
          Effect.mapError(
            (error) => new PushSendFailed({ cause: error.cause, events: [...events] }),
          ),
        );
      if (result === "sent") sent++;
      else if (
        yield* store.expired(subscription.endpoint, DateTime.toEpochMillis(yield* DateTime.now))
      ) {
        events.push({ _tag: "SubscriptionExpired", endpoint: subscription.endpoint });
      }
    }
    return { sent, expired: events.length, events };
  }),
  forgetExpired: Effect.fn("Push.forgetExpired")(function* (endpoint: string) {
    yield* UnitOfWork.required;
    const at = DateTime.toEpochMillis(yield* DateTime.now);
    if (!(yield* store.expired(endpoint, at))) return { events: [] };
    return { events: [{ _tag: "SubscriptionExpired" as const, endpoint }] };
  }),
});
